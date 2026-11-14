import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { createProjectSource, environments, threads } from "@bb/db";
import { listEvents } from "@bb/db/testing";
import { jsonValueSchema, turnScope, type ThreadEvent } from "@bb/domain";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  groupHostDaemonEvents,
  hostDaemonOnlineRpcResponseMessageSchema,
  hostDaemonRpcCommandSchema,
  hostDaemonServerWsMessageSchema,
  type HostDaemonRpcCommand,
} from "@bb/host-daemon-contract";
import { createBbSdk } from "@bb/sdk/core";
import { createHttpTransport } from "@bb/sdk/node";
import type {
  BbPluginApi,
  ExperimentalHostSignals,
  PluginRpcContract,
} from "@get-bb/plugin-sdk";
import type { ExperimentalHostEntry } from "@get-bb/plugin-sdk/host";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  experimental_createHostEntryHarness,
  type ExperimentalHostEntryHarness,
} from "@get-bb/plugin-sdk/testing/host";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { handleDaemonSocketClosed } from "../../src/internal/session-owner-side-effects.js";
import {
  setPluginEnvironmentProviderBridge,
  type PluginEnvironmentProviderRecord,
} from "../../src/services/plugins/plugin-environment-provider-registry.js";
import { invokePluginInline } from "../../src/services/plugins/plugin-hook-registry.js";
import { callPluginHostRpc } from "../../src/services/plugins/plugin-host-rpc.js";
import { runPeriodicSweeps } from "../../src/services/system/periodic-sweeps.js";
import { clearAllThreadProvisionSchedules } from "../../src/services/threads/thread-startup-store.js";
import { onDaemonSocketOpen } from "../../src/ws/daemon-protocol.js";
import {
  internalAuthHeaders,
  registerTestHostRpcCapture,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const execFileAsync = promisify(execFile);
const WORKTREE_PLUGIN_ID = "environment-git-worktree";
const CHECKOUT_PLUGIN_ID = "environment-project-checkout";
const WORKTREE_PROVIDER_ID = "git-worktree";
const MINUTE_MS = 60_000;
const RETIRE_GRACE_PASSED_MS = 6 * MINUTE_MS;
const PLUGIN_HOST_CALL_TIMEOUT_MS = 15 * MINUTE_MS;
const SETTLE_MAX_TICKS = 16;
const ORDERING_TIMEOUT_MS = 60_000;
const GIT_ENV = {
  GIT_AUTHOR_NAME: "bb",
  GIT_AUTHOR_EMAIL: "bb@example.com",
  GIT_COMMITTER_NAME: "bb",
  GIT_COMMITTER_EMAIL: "bb@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

type HostHarness = ExperimentalHostEntryHarness<
  PluginRpcContract,
  ExperimentalHostSignals
>;
type ProviderRemoveContext = Parameters<
  PluginEnvironmentProviderRecord["provider"]["remove"]
>[0];
type MachineName = "a" | "b";
type CheckoutInput = "path" | "default";
type ViolationKind =
  | "removed-in-use"
  | "work-lost"
  | "create-raced"
  | "refused"
  | "thread-failed"
  | "unsettled-thread"
  | "unsettled-environment"
  | "orphaned-row"
  | "orphaned-claim"
  | "orphaned-worktree"
  | "orphaned-branch";

interface Violation {
  key: string;
  text: string;
}

interface RecordedWork {
  kind: "uncommitted" | "commit" | "worktree-ref";
  thread: string;
  path: string;
  detail: string;
}

interface EnvironmentSnapshot {
  id: string;
  hostId: string | null;
  status: string;
  path: string | null;
  claimPath: string | null;
  ownerThreadId: string | null;
  teardownStatus: string | null;
  teardownMessage: string | null;
  retireAt: number | null;
  branchName: string | null;
  environmentProviderId: string | null;
  environmentProviderInstanceKey: string | null;
}

interface ThreadSnapshot {
  id: string;
  status: string;
  archivedAt: number | null;
  deletedAt: number | null;
  environmentId: string | null;
}

const pluginModuleSchema = z.object({
  default: z.custom<(bb: BbPluginApi) => Promise<void>>(
    (value) => typeof value === "function",
  ),
});
const hostModuleSchema = z.object({
  default: z.custom<
    ExperimentalHostEntry<PluginRpcContract, ExperimentalHostSignals>
  >((value) => typeof value === "object" && value !== null),
});
const contractModuleSchema = (name: string) =>
  z
    .object({ [name]: z.custom<PluginRpcContract>() })
    .transform((module) => module[name]!);
const threadIdSchema = z.object({ id: z.string() });
const sessionOpenSchema = z.object({ sessionId: z.string() });
const restorableSchema = z.object({ canRestoreEnvironment: z.boolean() });
const errorEventSchema = z.object({
  message: z.string(),
  detail: z.string().optional(),
});

function importPluginFile(plugin: string, file: string): Promise<unknown> {
  return import(
    new URL(`../../../../plugins/${plugin}/${file}`, import.meta.url).href
  );
}

const plugins = [
  {
    pluginId: CHECKOUT_PLUGIN_ID,
    providerId: "project-checkout",
    server: importPluginFile(CHECKOUT_PLUGIN_ID, "server.ts").then(
      (module) => pluginModuleSchema.parse(module).default,
    ),
    host: importPluginFile(CHECKOUT_PLUGIN_ID, "host.ts").then(
      (module) => hostModuleSchema.parse(module).default,
    ),
    contract: importPluginFile(CHECKOUT_PLUGIN_ID, "contract.ts").then(
      (module) => contractModuleSchema("checkoutHostContract").parse(module),
    ),
  },
  {
    pluginId: WORKTREE_PLUGIN_ID,
    providerId: WORKTREE_PROVIDER_ID,
    server: importPluginFile(WORKTREE_PLUGIN_ID, "server.ts").then(
      (module) => pluginModuleSchema.parse(module).default,
    ),
    host: importPluginFile(WORKTREE_PLUGIN_ID, "host.ts").then(
      (module) => hostModuleSchema.parse(module).default,
    ),
    contract: importPluginFile(WORKTREE_PLUGIN_ID, "contract.ts").then(
      (module) => contractModuleSchema("worktreeHostContract").parse(module),
    ),
  },
];

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, ...GIT_ENV },
  });
  return result.stdout.trim();
}

async function gitSucceeds(cwd: string, ...args: string[]): Promise<boolean> {
  return git(cwd, ...args).then(
    () => true,
    () => false,
  );
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let clockOffsetMs = 0;

function advanceClock(ms: number): void {
  clockOffsetMs += ms;
  vi.setSystemTime(Date.now() + ms);
}

interface Hold {
  key: string;
  reached: ReturnType<typeof deferred>;
  release: ReturnType<typeof deferred>;
}

class Machine {
  sessionId = "";
  readonly instanceId = "instance-1";
  inFlight = 0;
  heldOperations = 0;
  readonly hostId: string;
  readonly root: string;
  readonly repo: string;
  readonly hostDataDir: string;
  readonly worktreesRoot: string;
  readonly failures: string[] = [];
  readonly hostEntries = new Map<string, HostHarness>();
  private readonly holds: Hold[] = [];
  private readonly pendingSetups = new Map<string, () => void>();
  private turnCount = 0;

  constructor(
    private readonly world: World,
    readonly name: MachineName,
  ) {
    this.hostId = `host-orderings-${name}`;
    this.root = join(world.root, `machine-${name}`);
    this.repo = join(this.root, "repo");
    this.hostDataDir = join(this.root, "host-data");
    this.worktreesRoot = join(
      this.hostDataDir,
      "plugins",
      WORKTREE_PLUGIN_ID,
      "host-data",
      "worktrees",
    );
  }

  async init(): Promise<string> {
    const origin = join(this.root, "origin.git");
    await mkdir(this.repo, { recursive: true });
    await git(this.root, "init", "--bare", "--initial-branch=main", origin);
    await git(this.repo, "init", "--initial-branch=main");
    await writeFile(join(this.repo, "README.md"), "hello\n");
    await git(this.repo, "add", ".");
    await git(this.repo, "commit", "-m", "initial");
    await git(this.repo, "remote", "add", "origin", origin);
    await git(this.repo, "push", "-u", "origin", "main");
    for (const plugin of plugins) {
      this.hostEntries.set(
        plugin.pluginId,
        experimental_createHostEntryHarness(await plugin.host, {
          experimental_paths: {
            dataDir: join(
              this.hostDataDir,
              "plugins",
              plugin.pluginId,
              "host-data",
            ),
            tempDir: join(this.root, "tmp"),
          },
        }),
      );
    }
    const { session } = seedHostSession(this.world.harness.deps, {
      id: this.hostId,
    });
    this.sessionId = session.id;
    this.world.harness.hub.registerDaemon(
      this.sessionId,
      this.hostId,
      this.socket(this.sessionId),
    );
    return this.repo;
  }

  async dispose(): Promise<void> {
    for (const entry of this.hostEntries.values())
      await entry.experimental_dispose();
  }

  hold(key: string): { reached: Promise<void>; release: () => void } {
    const hold: Hold = { key, reached: deferred(), release: deferred() };
    this.holds.push(hold);
    return {
      reached: hold.reached.promise,
      release: () => hold.release.resolve(),
    };
  }

  private async passHold(
    key: string,
    interrupt?: Promise<void>,
  ): Promise<void> {
    const index = this.holds.findIndex((hold) => hold.key === key);
    if (index < 0) return;
    const [hold] = this.holds.splice(index, 1);
    this.heldOperations += 1;
    hold!.reached.resolve();
    await (interrupt === undefined
      ? hold!.release.promise
      : Promise.race([hold!.release.promise, interrupt]));
    this.heldOperations -= 1;
  }

  private async track<T>(
    key: string,
    run: () => Promise<T>,
    interrupt?: Promise<void>,
  ): Promise<T> {
    await this.passHold(key, interrupt);
    this.inFlight += 1;
    try {
      const failure = this.failures.indexOf(key);
      if (failure >= 0) {
        this.failures.splice(failure, 1);
        throw new Error(`${key} failed on the machine`);
      }
      return await run();
    } finally {
      this.inFlight -= 1;
    }
  }

  private socket(sessionId: string) {
    const harness = this.world.harness;
    const capture = registerTestHostRpcCapture(harness, {
      hostId: this.hostId,
      sessionId,
      onPluginHostCall: (command) =>
        this.track(`${command.pluginId}.${command.method}`, async () => {
          const entry = this.hostEntries.get(command.pluginId);
          if (entry === undefined)
            throw new Error(`No host entry for ${command.pluginId}`);
          return {
            output: jsonValueSchema.parse(
              await entry.experimental_call(command.method, command.input),
            ),
          };
        }),
      onEnvironmentHook: (command) =>
        this.track(`hook.${command.kind}`, async () => undefined),
    });
    return {
      close: () => capture.close(),
      send: (data: string) => {
        const message = hostDaemonServerWsMessageSchema.parse(JSON.parse(data));
        if (message.type !== "host-rpc.request") return capture.send(data);
        const command = hostDaemonRpcCommandSchema.parse(message.command);
        const requestId = message.requestId;
        if (command.type === "environment.attach") {
          void this.runSetup(sessionId, requestId, command);
          return;
        }
        if (command.type === "thread.start") {
          void this.runTurn(sessionId, requestId, command);
          return;
        }
        if (command.type === "environment.attach.cancel") {
          const cancel = this.pendingSetups.get(command.environmentId);
          cancel?.();
          this.respond(sessionId, requestId, command, {
            aborted: cancel !== undefined,
          });
          return;
        }
        if (command.type === "environment.inspect_cleanup") {
          this.respond(sessionId, requestId, command, {
            supported: true,
            active: false,
            pids: [],
            unreadablePids: [],
          });
          return;
        }
        capture.send(data);
      },
    };
  }

  private respond(
    sessionId: string,
    requestId: string,
    command: HostDaemonRpcCommand,
    result: unknown,
  ): void {
    this.world.harness.hub.recordHostOnlineRpcResponse({
      message: hostDaemonOnlineRpcResponseMessageSchema.parse({
        type: "host-rpc.response",
        requestId,
        commandType: command.type,
        ok: true,
        result,
      }),
      sessionId,
    });
  }

  private reject(
    sessionId: string,
    requestId: string,
    command: HostDaemonRpcCommand,
    errorCode: string,
    errorMessage: string,
  ): void {
    this.world.harness.hub.recordHostOnlineRpcResponse({
      message: hostDaemonOnlineRpcResponseMessageSchema.parse({
        type: "host-rpc.response",
        requestId,
        commandType: command.type,
        ok: false,
        errorCode,
        errorMessage,
      }),
      sessionId,
    });
  }

  private async runSetup(
    sessionId: string,
    requestId: string,
    command: Extract<HostDaemonRpcCommand, { type: "environment.attach" }>,
  ): Promise<void> {
    const interrupted = deferred();
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      interrupted.resolve();
    };
    this.pendingSetups.set(command.environmentId, cancel);
    const outcome = await this.track(
      "setup",
      async () => {
        if (sessionId !== this.sessionId) return null;
        if (cancelled) return "cancelled" as const;
        const isGitRepo = await gitSucceeds(
          command.path,
          "rev-parse",
          "--git-dir",
        );
        if (!isGitRepo)
          return {
            path: command.path,
            isGitRepo: false,
            isWorktree: false,
            branchName: null,
            defaultBranch: null,
            transcript: [],
          };
        const gitDir = await git(
          command.path,
          "rev-parse",
          "--absolute-git-dir",
        );
        const commonDir = await git(
          command.path,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        );
        const branchName = await git(
          command.path,
          "symbolic-ref",
          "--short",
          "-q",
          "HEAD",
        ).catch(() => "");
        return {
          path: command.path,
          isGitRepo: true,
          isWorktree: gitDir !== commonDir,
          branchName: branchName === "" ? null : branchName,
          defaultBranch: "main",
          transcript: [],
        };
      },
      interrupted.promise,
    )
      .catch((error: unknown) =>
        error instanceof Error ? error.message : String(error),
      )
      .finally(() => {
        if (this.pendingSetups.get(command.environmentId) === cancel)
          this.pendingSetups.delete(command.environmentId);
      });
    if (outcome === null || sessionId !== this.sessionId) return;
    if (outcome === "cancelled") {
      this.reject(
        sessionId,
        requestId,
        command,
        "provision_cancelled",
        "Environment provisioning was cancelled",
      );
      return;
    }
    if (typeof outcome === "string") {
      this.reject(
        sessionId,
        requestId,
        command,
        "setup_script_failed",
        outcome,
      );
      return;
    }
    this.respond(sessionId, requestId, command, outcome);
  }

  private async runTurn(
    sessionId: string,
    requestId: string,
    command: Extract<HostDaemonRpcCommand, { type: "thread.start" }>,
  ): Promise<void> {
    const threadId = command.threadId;
    const providerThreadId = `provider-${threadId}`;
    this.turnCount += 1;
    const scope = turnScope(`turn-${this.turnCount}`);
    this.respond(sessionId, requestId, command, { providerThreadId });
    await this.postEvents(sessionId, [
      { type: "turn/started", threadId, providerThreadId, scope },
      {
        type: "turn/completed",
        threadId,
        providerThreadId,
        scope,
        status: "completed",
      },
    ]);
  }

  private async postEvents(
    sessionId: string,
    events: ThreadEvent[],
  ): Promise<void> {
    const harness = this.world.harness;
    const response = await harness.app.request("/internal/session/events", {
      method: "POST",
      headers: internalAuthHeaders(harness, { hostId: this.hostId }),
      body: JSON.stringify({
        sessionId,
        eventGroups: groupHostDaemonEvents(
          events.map((event) => ({ threadId: event.threadId, event })),
        ),
      }),
    });
    if (response.status !== 200)
      throw new Error(
        `Posting daemon events failed: ${response.status} ${await response.text()}`,
      );
  }

  disconnect(): void {
    handleDaemonSocketClosed(this.world.harness.deps, {
      sessionId: this.sessionId,
    });
    this.sessionId = "";
  }

  async reconnect(): Promise<void> {
    const harness = this.world.harness;
    const response = await harness.app.request("/internal/session/open", {
      method: "POST",
      headers: internalAuthHeaders(harness, { hostId: this.hostId }),
      body: JSON.stringify({
        hostId: this.hostId,
        instanceId: this.instanceId,
        hostName: "Test Host",
        hasMachineCredential: false,
        platform: "darwin",
        dataDir: this.hostDataDir,
        localApiPort: null,
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        activeThreads: [],
        openThreadWork: [],
      }),
    });
    if (response.status !== 201)
      throw new Error(
        `Daemon reconnect failed: ${response.status} ${await response.text()}`,
      );
    this.sessionId = sessionOpenSchema.parse(await response.json()).sessionId;
    onDaemonSocketOpen(harness.deps, {
      hostId: this.hostId,
      sessionId: this.sessionId,
      socket: this.socket(this.sessionId),
    });
  }
}

class World {
  readonly violations: Violation[] = [];
  readonly work: RecordedWork[] = [];
  readonly expectedThreadErrors = new Set<string>();
  readonly machines = new Map<MachineName, Machine>();
  root = "";
  projectId = "";
  private stepLabel = "setup";
  private readonly threadLabels = new Map<string, string>();
  private readonly threadIds = new Map<string, string>();
  private readonly environmentLabels = new Map<string, string>();

  constructor(readonly harness: TestAppHarness) {}

  static async create(
    harness: TestAppHarness,
    machineNames: MachineName[],
    cleanup: (fn: () => Promise<void>) => void,
  ): Promise<World> {
    const world = new World(harness);
    world.root = await realpath(
      await mkdtemp(join(tmpdir(), "bb-env-orderings-")),
    );
    cleanup(() => rm(world.root, { recursive: true, force: true }));
    for (const name of machineNames) {
      const machine = new Machine(world, name);
      world.machines.set(name, machine);
      cleanup(() => machine.dispose());
      const repo = await machine.init();
      if (world.projectId === "") {
        world.projectId = seedProjectWithSource(harness.deps, {
          hostId: machine.hostId,
          path: repo,
        }).project.id;
      } else {
        createProjectSource(harness.db, harness.hub, {
          projectId: world.projectId,
          type: "local_path",
          hostId: machine.hostId,
          path: repo,
        });
      }
    }
    await world.installProviders();
    return world;
  }

  private async installProviders(): Promise<void> {
    const harness = this.harness;
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://localhost",
        runtime: "node",
        fetch: async (input, init) =>
          harness.app.fetch(new Request(input, init)),
      }),
    });
    const records: PluginEnvironmentProviderRecord[] = [];
    for (const plugin of plugins) {
      const contract = await plugin.contract;
      const fake = createFakePluginHost({
        pluginId: plugin.pluginId,
        sdk: {
          environments: { list: (filters) => sdk.environments.list(filters) },
          threads: { list: (filters) => sdk.threads.list(filters) },
        },
        experimental_callHostRpc: (call) =>
          callPluginHostRpc(harness.deps, {
            pluginId: plugin.pluginId,
            contract,
            method: call.method,
            input: call.input,
            hostId: call.hostId,
            ...(call.signal === undefined ? {} : { signal: call.signal }),
            timeoutMs: PLUGIN_HOST_CALL_TIMEOUT_MS,
            artifact: {
              path: join(this.root, `${plugin.pluginId}.js`),
              byteLength: 1,
              digest: "0".repeat(64),
              generation: "test",
            },
          }),
      });
      await (
        await plugin.server
      )(fake.bb);
      const provider = fake.harness.registrations.environmentProviders.get(
        plugin.providerId,
      );
      if (provider === undefined)
        throw new Error(`${plugin.pluginId} registered no provider`);
      const remove = provider.remove;
      records.push({
        pluginId: plugin.pluginId,
        provider: {
          ...provider,
          remove: (context) => {
            this.checkRemoval(context);
            return remove(context);
          },
        },
      });
    }
    setPluginEnvironmentProviderBridge({
      listEnvironmentCompositions: () => [],
      listEnvironmentProviders: () => records,
      getEnvironmentProvider: (id) =>
        records.find((record) => record.provider.id === id),
      invokeProvider: (_pluginId, _label, run) => invokePluginInline(run),
      decisionTimeoutMs: 10_000,
    });
  }

  machine(name: MachineName = "a"): Machine {
    const machine = this.machines.get(name);
    if (machine === undefined) throw new Error(`No machine ${name}`);
    return machine;
  }

  threadId(label: string): string {
    const id = this.threadIds.get(label);
    if (id === undefined) throw new Error(`No thread ${label}`);
    return id;
  }

  environmentOf(label: string): EnvironmentSnapshot {
    const thread = this.threadRows().find(
      (row) => row.id === this.threadId(label),
    );
    const row = this.environmentRows().find(
      (environment) => environment.id === thread?.environmentId,
    );
    if (row === undefined)
      throw new Error(`Thread ${label} has no environment\n${this.dump()}`);
    return row;
  }

  expectThreadError(label: string): void {
    this.expectedThreadErrors.add(label);
  }

  private threadRows(): ThreadSnapshot[] {
    return this.harness.db
      .select({
        id: threads.id,
        status: threads.status,
        archivedAt: threads.archivedAt,
        deletedAt: threads.deletedAt,
        environmentId: threads.environmentId,
      })
      .from(threads)
      .where(eq(threads.projectId, this.projectId))
      .all();
  }

  private environmentRows(): EnvironmentSnapshot[] {
    return this.harness.db
      .select({
        id: environments.id,
        hostId: environments.hostId,
        status: environments.status,
        path: environments.path,
        claimPath: environments.claimPath,
        ownerThreadId: environments.ownerThreadId,
        teardownStatus: environments.teardownStatus,
        teardownMessage: environments.teardownMessage,
        retireAt: environments.retireAt,
        branchName: environments.branchName,
        environmentProviderId: environments.environmentProviderId,
        environmentProviderInstanceKey:
          environments.environmentProviderInstanceKey,
      })
      .from(environments)
      .where(eq(environments.projectId, this.projectId))
      .all();
  }

  private threadLabel(id: string): string {
    return this.threadLabels.get(id) ?? id;
  }

  private labelEnvironments(): void {
    const rows = this.environmentRows();
    for (const thread of this.threadRows()) {
      const label = this.threadLabels.get(thread.id);
      if (label === undefined) continue;
      for (const row of rows) {
        if (this.environmentLabels.has(row.id)) continue;
        if (row.id !== thread.environmentId && row.ownerThreadId !== thread.id)
          continue;
        const taken = [...this.environmentLabels.values()].filter(
          (name) =>
            name === `env(${label})` || name.startsWith(`env(${label})#`),
        ).length;
        this.environmentLabels.set(
          row.id,
          taken === 0 ? `env(${label})` : `env(${label})#${taken + 1}`,
        );
      }
    }
  }

  private environmentLabel(id: string): string {
    this.labelEnvironments();
    return this.environmentLabels.get(id) ?? id;
  }

  private liveUsers(environmentIds: string[]): string[] {
    if (environmentIds.length === 0) return [];
    return this.harness.db
      .select({ id: threads.id })
      .from(threads)
      .where(
        and(
          inArray(threads.environmentId, environmentIds),
          isNull(threads.deletedAt),
          or(
            isNull(threads.archivedAt),
            inArray(threads.status, ["active", "stopping"]),
          ),
        ),
      )
      .all()
      .map((row) => this.threadLabel(row.id));
  }

  private checkRemoval(context: ProviderRemoveContext): void {
    const rows = this.environmentRows().filter(
      (row) =>
        row.status !== "destroyed" &&
        row.hostId === context.hostId &&
        (row.id === context.environment?.id ||
          (row.environmentProviderInstanceKey ?? row.id) === context.pathKey),
    );
    const joining = this.threadRows()
      .filter((thread) =>
        rows.some(
          (row) =>
            row.status === "ready" &&
            row.ownerThreadId === thread.id &&
            thread.archivedAt === null &&
            thread.deletedAt === null,
        ),
      )
      .map((thread) => this.threadLabel(thread.id));
    const holders = [
      ...new Set([...this.liveUsers(rows.map((row) => row.id)), ...joining]),
    ].sort();
    for (const row of rows)
      if (holders.length > 0)
        this.violation(
          "removed-in-use",
          this.environmentLabel(row.id),
          `removed while ${holders.join(", ")} still used it`,
        );
  }

  private violation(kind: ViolationKind, subject: string, detail: string) {
    const key = `${kind}: ${subject}`;
    if (this.violations.some((entry) => entry.key === key)) return;
    this.violations.push({
      key,
      text: `${key} (${this.stepLabel}: ${detail})`,
    });
  }

  dump(): string {
    return JSON.stringify(
      {
        threads: this.threadRows(),
        environments: this.environmentRows(),
        events: this.threadRows().map((thread) =>
          listEvents(this.harness.db, { threadId: thread.id }).map(
            (event) => `${event.type} ${event.data.slice(0, 300)}`,
          ),
        ),
      },
      null,
      2,
    );
  }

  private signature(): string {
    return JSON.stringify([this.environmentRows(), this.threadRows()]);
  }

  private inFlight(): boolean {
    return [...this.machines.values()].some((machine) => machine.inFlight > 0);
  }

  private pending(): boolean {
    if (
      [...this.machines.values()].some((machine) => machine.heldOperations > 0)
    )
      return false;
    return (
      this.threadRows().some(
        (thread) =>
          thread.status === "starting" || thread.status === "stopping",
      ) ||
      this.environmentRows().some(
        (row) =>
          row.status === "creating" ||
          row.status === "provisioning" ||
          row.teardownStatus === "running",
      )
    );
  }

  async quiesce(options: { untilIdle: boolean }): Promise<void> {
    let stable = 0;
    let last = "";
    const startedAt = performance.now();
    while (stable < 4 && performance.now() - startedAt < 15_000) {
      await delay(20);
      const signature = this.signature();
      const busy = this.inFlight();
      const waiting =
        options.untilIdle &&
        this.pending() &&
        performance.now() - startedAt < 1_000;
      stable = signature === last && !busy && !waiting ? stable + 1 : 0;
      last = signature;
    }
  }

  private async tick(): Promise<void> {
    void runPeriodicSweeps({
      ...this.harness.deps,
      pluginSchedules: this.harness.pluginService,
      plugins: this.harness.pluginService,
    });
    await this.quiesce({ untilIdle: false });
  }

  async step(label: string, run: () => Promise<void>): Promise<void> {
    this.stepLabel = label;
    await run();
    await this.quiesce({ untilIdle: true });
    this.labelEnvironments();
    await this.checkWork();
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const response = await this.harness.app.request(`/api/v1${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text === "" ? null : JSON.parse(text),
    };
  }

  private async createThread(
    label: string,
    environment: unknown,
  ): Promise<boolean> {
    const response = await this.request("POST", "/threads", {
      projectId: this.projectId,
      origin: "app",
      providerId: "codex",
      model: "requested-model",
      input: textInput(`ordering thread ${label}`),
      environment,
    });
    if (response.status !== 201) {
      this.violation(
        response.status === 409 ? "create-raced" : "refused",
        `create ${label}`,
        `${response.status} ${JSON.stringify(response.body)}`,
      );
      return false;
    }
    const id = threadIdSchema.parse(response.body).id;
    this.threadIds.set(label, id);
    this.threadLabels.set(id, label);
    return true;
  }

  private worktreeRequest(machine: MachineName) {
    return {
      type: "host",
      hostId: this.machine(machine).hostId,
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    };
  }

  private checkoutRequest(machine: MachineName, input: CheckoutInput): unknown {
    const hostId = this.machine(machine).hostId;
    if (input === "path")
      return {
        type: "host",
        hostId,
        workspace: { type: "unmanaged", path: this.machine(machine).repo },
      };
    return {
      type: "provider",
      environmentProviderId: "project-checkout",
      machine: { type: "existing", hostId },
      inputs: {},
    };
  }

  createWorktreeThread(label: string, machine: MachineName = "a") {
    return this.step(`create worktree ${label}`, async () => {
      await this.createThread(label, this.worktreeRequest(machine));
    });
  }

  createCheckoutThread(label: string, input: CheckoutInput = "path") {
    return this.step(`create checkout ${label} (${input})`, async () => {
      await this.createThread(label, this.checkoutRequest("a", input));
    });
  }

  createCheckoutThreadsTogether(first: string, second: string, third: string) {
    return this.step(
      `create checkout ${first}, ${second} and ${third} together`,
      async () => {
        const attach = `${CHECKOUT_PLUGIN_ID}.attach`;
        const firstAttach = this.machine().hold(attach);
        const creating = [
          this.createThread(first, this.checkoutRequest("a", "path")),
        ];
        await firstAttach.reached;
        const secondAttach = this.machine().hold(attach);
        creating.push(
          this.createThread(second, this.checkoutRequest("a", "path")),
        );
        firstAttach.release();
        await secondAttach.reached;
        creating.push(
          this.createThread(third, this.checkoutRequest("a", "path")),
        );
        await delay(100);
        secondAttach.release();
        await Promise.all(creating);
      },
    );
  }

  private async action(what: string, method: string, path: string) {
    const response = await this.request(method, path);
    if (response.status !== 200)
      this.violation(
        "refused",
        what,
        `${response.status} ${JSON.stringify(response.body)}`,
      );
    return response;
  }

  archive(label: string) {
    return this.step(`archive ${label}`, async () => {
      await this.action(
        `archive ${label}`,
        "POST",
        `/threads/${this.threadId(label)}/archive-all`,
      );
    });
  }

  unarchive(label: string) {
    return this.step(`unarchive ${label}`, async () => {
      await this.action(
        `unarchive ${label}`,
        "POST",
        `/threads/${this.threadId(label)}/unarchive`,
      );
    });
  }

  restoreIfDestroyed(label: string) {
    return this.step(`restore ${label} if its workspace is gone`, async () => {
      const thread = await this.request(
        "GET",
        `/threads/${this.threadId(label)}`,
      );
      if (!restorableSchema.parse(thread.body).canRestoreEnvironment) return;
      await this.action(
        `restore ${label}`,
        "POST",
        `/threads/${this.threadId(label)}/restore-environment`,
      );
    });
  }

  removeEnvironment(label: string) {
    return this.step(`remove env(${label})`, async () => {
      await this.action(
        `remove env(${label})`,
        "DELETE",
        `/environments/${this.environmentOf(label).id}`,
      );
    });
  }

  failNextCheckoutAttach() {
    this.machine().failures.push(`${CHECKOUT_PLUGIN_ID}.attach`);
  }

  recoverIfNeeded(label: string) {
    return this.step(`recover env(${label}) if it needs recovery`, async () => {
      const environment = this.environmentOf(label);
      if (environment.teardownMessage?.startsWith("Needs recovery:") !== true)
        return;
      await this.action(
        `recover env(${label})`,
        "POST",
        `/environments/${environment.id}/cleanup?recover=true`,
      );
    });
  }

  passTime(ms: number) {
    return this.step(`pass ${ms / MINUTE_MS} min`, async () => {
      advanceClock(MINUTE_MS);
      await this.tick();
      advanceClock(ms - MINUTE_MS);
      await this.tick();
      await this.tick();
    });
  }

  release(what: string, hold: { release: () => void }) {
    return this.step(what, async () => {
      hold.release();
    });
  }

  disconnect(machine: MachineName = "a") {
    return this.step(`disconnect machine ${machine}`, async () => {
      this.machine(machine).disconnect();
    });
  }

  reconnect(machine: MachineName = "a") {
    return this.step(`reconnect machine ${machine}`, async () => {
      await this.machine(machine).reconnect();
    });
  }

  async writeWork(label: string, kind: RecordedWork["kind"]): Promise<void> {
    await this.step(`write ${kind} in ${label}`, async () => {
      const path = this.environmentOf(label).path;
      if (path === null) throw new Error(`${label} has no workspace path`);
      const name = `${kind}-${this.work.length}`;
      if (kind === "worktree-ref") {
        await git(path, "update-ref", `refs/worktree/${name}`, "HEAD");
        this.work.push({
          kind,
          thread: label,
          path,
          detail: `refs/worktree/${name}`,
        });
        return;
      }
      await writeFile(join(path, `${name}.txt`), `${name}\n`);
      if (kind === "uncommitted") {
        this.work.push({ kind, thread: label, path, detail: name });
        return;
      }
      await git(path, "add", `${name}.txt`);
      await git(path, "commit", "-m", name);
      const sha = await git(path, "rev-parse", "HEAD");
      this.work.push({ kind, thread: label, path, detail: sha });
    });
  }

  async dropWorktreeRefs(label: string): Promise<void> {
    await this.step(`drop worktree refs in ${label}`, async () => {
      for (const entry of this.work.splice(0)) {
        if (entry.kind === "worktree-ref" && entry.thread === label) {
          if (existsSync(entry.path))
            await git(entry.path, "update-ref", "-d", entry.detail);
          continue;
        }
        this.work.push(entry);
      }
    });
  }

  private async checkWork(): Promise<void> {
    for (const entry of this.work) {
      const subject = `${entry.kind} in ${entry.thread}`;
      if (entry.kind === "commit") {
        const reachable = await Promise.all(
          [...this.machines.values()].map((machine) =>
            git(
              machine.repo,
              "for-each-ref",
              "--contains",
              entry.detail,
              "--format=%(refname)",
            ).catch(() => ""),
          ),
        );
        if (reachable.every((refs) => refs === ""))
          this.violation("work-lost", subject, "no ref contains the commit");
        continue;
      }
      if (!existsSync(entry.path)) {
        if (entry.kind === "worktree-ref")
          this.violation(
            "work-lost",
            subject,
            "the worktree was removed with its private ref",
          );
        continue;
      }
      const intact =
        entry.kind === "uncommitted"
          ? await readFile(
              join(entry.path, `${entry.detail}.txt`),
              "utf8",
            ).then(
              (content) => content === `${entry.detail}\n`,
              () => false,
            )
          : await gitSucceeds(
              entry.path,
              "rev-parse",
              "--verify",
              entry.detail,
            );
      if (!intact)
        this.violation(
          "work-lost",
          subject,
          "vanished from a worktree that remains",
        );
    }
  }

  async settle(): Promise<void> {
    this.stepLabel = "settle";
    let stableTicks = 0;
    let last = "";
    for (let tick = 0; tick < SETTLE_MAX_TICKS && stableTicks < 2; tick += 1) {
      advanceClock(RETIRE_GRACE_PASSED_MS);
      await this.tick();
      const signature = this.signature();
      stableTicks = signature === last ? stableTicks + 1 : 0;
      last = signature;
    }
    this.labelEnvironments();
    await this.checkWork();
  }

  async settledNow(): Promise<void> {
    await this.settle();
    this.checkEnvironmentsSettled();
  }

  expectRemoved(label: string): void {
    const environment = this.environmentOf(label);
    if (environment.status !== "destroyed")
      this.violation(
        "unsettled-environment",
        this.environmentLabel(environment.id),
        `still ${environment.status} after its grace passed`,
      );
  }

  async finish(): Promise<Violation[]> {
    await this.settle();
    this.checkThreadsSettled();
    this.checkEnvironmentsSettled();
    for (const machine of this.machines.values())
      await this.checkMachineOrphans(machine);
    return this.violations;
  }

  private checkThreadsSettled(): void {
    for (const thread of this.threadRows()) {
      const label = this.threadLabel(thread.id);
      if (!this.threadIds.has(label)) continue;
      if (thread.status === "starting" || thread.status === "stopping")
        this.violation("unsettled-thread", label, `left ${thread.status}`);
      if (thread.status !== "error" || this.expectedThreadErrors.has(label))
        continue;
      const reason = listEvents(this.harness.db, { threadId: thread.id })
        .filter((event) => event.type === "system/error")
        .map((event) => {
          const parsed = errorEventSchema.safeParse(JSON.parse(event.data));
          return parsed.success
            ? `${parsed.data.message}${parsed.data.detail === undefined ? "" : `: ${parsed.data.detail}`}`
            : event.data;
        })
        .at(-1);
      this.violation("thread-failed", label, reason ?? "no error event");
    }
  }

  private checkEnvironmentsSettled(): void {
    const threadRows = this.threadRows();
    for (const row of this.environmentRows()) {
      const label = this.environmentLabel(row.id);
      const owner = threadRows.find(
        (thread) => thread.id === row.ownerThreadId,
      );
      if (row.claimPath !== null)
        this.violation(
          "orphaned-claim",
          label,
          `${owner === undefined ? "no thread" : this.threadLabel(owner.id)} still claims ${row.claimPath}`,
        );
      else if (
        row.ownerThreadId !== null &&
        (owner === undefined ||
          owner.archivedAt !== null ||
          owner.deletedAt !== null)
      )
        this.violation(
          "orphaned-claim",
          label,
          "still reserved for a thread that is gone",
        );
      if (row.status === "destroyed") {
        if (row.path !== null)
          this.violation(
            "orphaned-row",
            label,
            "destroyed but records its path",
          );
        continue;
      }
      if (row.teardownStatus === "removed") {
        this.violation(
          "orphaned-row",
          label,
          `workspace removed but row left ${row.status} with its path`,
        );
        continue;
      }
      const unsettled =
        row.teardownStatus === "running"
          ? "removal never finished"
          : row.teardownStatus === "failed" &&
              (row.retireAt !== null ||
                row.teardownMessage?.startsWith("Needs recovery:") !== true)
            ? `keeps retrying a failed removal: ${row.teardownMessage ?? "no message"}`
            : row.status === "creating" || row.status === "provisioning"
              ? `setup never finished (${row.status})`
              : row.teardownStatus === null &&
                  row.environmentProviderId === WORKTREE_PROVIDER_ID &&
                  this.liveUsers([row.id]).length === 0
                ? `never retired after its threads left (${row.status})`
                : null;
      if (unsettled !== null)
        this.violation("unsettled-environment", label, unsettled);
      if (row.status === "ready" && row.path !== null && !existsSync(row.path))
        this.violation(
          "orphaned-row",
          label,
          "ready but its workspace is gone",
        );
    }
  }

  private async checkMachineOrphans(machine: Machine): Promise<void> {
    const rows = this.environmentRows().filter(
      (row) => row.hostId === machine.hostId,
    );
    const livePaths = new Set(
      rows.flatMap((row) =>
        row.status !== "destroyed" && row.path !== null ? [row.path] : [],
      ),
    );
    const labelForPath = (path: string) => {
      const row = rows.find((candidate) => candidate.path === path);
      return row === undefined ? path : this.environmentLabel(row.id);
    };
    const worktrees = (
      await git(machine.repo, "worktree", "list", "--porcelain")
    )
      .split("\n\n")
      .map((block) => ({
        path: /^worktree (.*)$/m.exec(block)?.[1] ?? "",
        branch: /^branch refs\/heads\/(.*)$/m.exec(block)?.[1] ?? null,
        prunable: /^prunable/m.test(block),
      }))
      .filter((entry) => entry.path !== "" && entry.path !== machine.repo);
    for (const entry of worktrees)
      if (entry.prunable || !livePaths.has(entry.path))
        this.violation(
          "orphaned-worktree",
          labelForPath(entry.path),
          entry.prunable
            ? "git still lists the deleted worktree"
            : "worktree left without a live environment",
        );
    for (const attempt of await readdir(machine.worktreesRoot).catch(
      () => [],
    )) {
      const children = await readdir(join(machine.worktreesRoot, attempt), {
        withFileTypes: true,
      }).catch(() => []);
      for (const child of children) {
        const path = join(machine.worktreesRoot, attempt, child.name);
        if (child.isDirectory() && !livePaths.has(path))
          this.violation(
            "orphaned-worktree",
            labelForPath(path),
            "directory left without a live environment",
          );
      }
    }
    const checkedOut = new Set(worktrees.map((entry) => entry.branch));
    const current = await git(machine.repo, "branch", "--show-current");
    const branches = (
      await git(
        machine.repo,
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads",
      )
    )
      .split("\n")
      .filter(
        (branch) =>
          branch !== "" &&
          branch !== "main" &&
          branch !== current &&
          !checkedOut.has(branch),
      );
    for (const branch of branches) {
      const unique = await git(
        machine.repo,
        "rev-list",
        branch,
        "--not",
        "--remotes",
        "--tags",
        "main",
      );
      if (unique !== "") continue;
      const owner = rows.find((row) => row.branchName === branch);
      const creator = [...this.threadIds].find(([, id]) => branch.endsWith(id));
      this.violation(
        "orphaned-branch",
        owner !== undefined
          ? this.environmentLabel(owner.id)
          : creator !== undefined
            ? `env(${creator[0]})`
            : branch,
        `${branch} holds nothing but was left behind`,
      );
    }
  }
}

interface Ordering {
  name: string;
  machines?: MachineName[];
  run(world: World): Promise<void>;
}

const WORKTREE_REMOVE = `${WORKTREE_PLUGIN_ID}.remove`;
const RETIRE_MS = 7 * MINUTE_MS;

const ORDERINGS: Ordering[] = [
  {
    name: "worktree: create two, write work in one, archive both, retire",
    async run(world) {
      await world.createWorktreeThread("A");
      await world.createWorktreeThread("B");
      await world.writeWork("A", "commit");
      await world.writeWork("A", "uncommitted");
      await world.archive("A");
      await world.archive("B");
    },
  },
  {
    name: "worktree: archive, unarchive while its removal runs, restore",
    async run(world) {
      await world.createWorktreeThread("A");
      await world.writeWork("A", "commit");
      await world.archive("A");
      const removal = world.machine().hold(WORKTREE_REMOVE);
      await world.passTime(RETIRE_MS);
      await removal.reached;
      await world.unarchive("A");
      await world.release("finish removal", removal);
      await world.restoreIfDestroyed("A");
    },
  },
  {
    name: "worktree: archive, remove, unarchive before the removal starts, restore",
    async run(world) {
      await world.createWorktreeThread("A");
      await world.writeWork("A", "commit");
      await world.archive("A");
      await world.removeEnvironment("A");
      await world.unarchive("A");
      await world.restoreIfDestroyed("A");
    },
  },
  {
    name: "worktree: retire with worktree-local git state, resolve it, recover",
    async run(world) {
      await world.createWorktreeThread("A");
      await world.writeWork("A", "worktree-ref");
      await world.archive("A");
      await world.settledNow();
      await world.dropWorktreeRefs("A");
      await world.recoverIfNeeded("A");
    },
  },
  {
    name: "worktree: daemon disconnects during setup and reconnects",
    async run(world) {
      const setup = world.machine().hold("setup");
      await world.createWorktreeThread("A");
      await setup.reached;
      await world.disconnect();
      await world.reconnect();
      await world.release("finish setup", setup);
    },
  },
  {
    name: "worktree: archive during setup",
    async run(world) {
      const setup = world.machine().hold("setup");
      await world.createWorktreeThread("A");
      await setup.reached;
      await world.archive("A");
      await world.release("finish setup", setup);
    },
  },
  {
    name: "worktree: one machine's removal is slow while another's grace passes",
    machines: ["a", "b"],
    async run(world) {
      await world.createWorktreeThread("A", "a");
      await world.createWorktreeThread("B", "b");
      await world.archive("A");
      const removal = world.machine("a").hold(WORKTREE_REMOVE);
      await world.passTime(RETIRE_MS);
      await removal.reached;
      await world.archive("B");
      await world.passTime(RETIRE_MS);
      world.expectRemoved("B");
      await world.release("finish removal", removal);
    },
  },
  {
    name: "checkout: three creates race on one path",
    async run(world) {
      await world.createCheckoutThreadsTogether("A", "B", "C");
    },
  },
  {
    name: "checkout: a second thread's setup fails while the first is live",
    async run(world) {
      await world.createCheckoutThread("A");
      world.failNextCheckoutAttach();
      await world.createCheckoutThread("B", "default");
      world.expectThreadError("B");
    },
  },
];

const KNOWN_FAILURES: Record<string, string[]> = {
  "worktree: archive, remove, unarchive before the removal starts, restore": [
    "unsettled-environment: env(A)",
  ],
  "worktree: daemon disconnects during setup and reconnects": [
    "thread-failed: A",
  ],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(Date.now() + clockOffsetMs);
});

afterEach(() => {
  clearAllThreadProvisionSchedules();
  setPluginEnvironmentProviderBridge(undefined);
  vi.useRealTimers();
});

describe("environment lifecycle orderings", () => {
  it.each(ORDERINGS.map((ordering) => [ordering.name, ordering] as const))(
    "%s",
    async (_name, ordering) => {
      await withTestHarness(async (harness) => {
        const cleanups: Array<() => Promise<void>> = [];
        try {
          const world = await World.create(
            harness,
            ordering.machines ?? ["a"],
            (fn) => cleanups.push(fn),
          );
          await ordering.run(world);
          const violations = await world.finish();
          expect(
            violations.map((violation) => violation.key),
            violations.map((violation) => violation.text).join("\n"),
          ).toEqual(KNOWN_FAILURES[ordering.name] ?? []);
        } finally {
          for (const cleanup of cleanups.reverse()) await cleanup();
        }
      });
    },
    ORDERING_TIMEOUT_MS,
  );
});
