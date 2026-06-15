import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  createAgentRuntime,
  type AgentRuntime,
  type AgentRuntimeOptions,
  type AgentRuntimeSkillRoot,
  type AgentRuntimeProcessExitInfo,
} from "@bb/agent-runtime";
import type { Logger } from "@bb/logger";
import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
  ThreadEvent,
  WorkspaceProvisionType,
} from "@bb/domain";
import { turnScope } from "@bb/domain";
import type {
  HostDaemonActiveThread,
  HostDaemonEnvironmentChange,
  HostDaemonLoadedEnvironment,
  HostDaemonInjectedSkillSource,
} from "@bb/host-daemon-contract";
import type {
  DataDirSkillsWatchError,
  HostWatcher,
  InjectedSkillsObservedChange,
} from "@bb/host-watcher";
import {
  provisionWorkspace,
  WorkspaceError,
  type HostWorkspace,
  type ProvisionWorkspaceArgs,
} from "@bb/host-workspace";
import {
  cleanupInjectedSkillStagingDirs,
  EMPTY_SKILL_CATALOG_HASH,
  stageInjectedSkillSources,
  type InjectedSkillsLogger,
} from "./injected-skills.js";
import { reconnectProvisionArgs } from "./workspace-provision-target.js";

type StopWatching = () => void | Promise<void>;

const STOP_WATCHING: StopWatching = () => undefined;
const PROVIDER_MAINTENANCE_WORKSPACE_DIR = "provider-maintenance-workspace";
const PROVIDER_PROCESS_EXIT_DETAIL_MAX_LENGTH = 4000;

interface RuntimeSkillConfig {
  catalogHash: string;
  skillRoots: readonly AgentRuntimeSkillRoot[];
}

interface CreateEntryArgs extends Omit<
  EnsureEnvironmentArgs,
  "injectedSkillSources" | "targetThreadId"
> {
  provisionSignal: AbortSignal;
  skillConfig: RuntimeSkillConfig | null;
}

interface ApplyExistingEnvironmentProvisionArgs {
  entry: RuntimeEntry;
  provision: ProvisionWorkspaceArgs | undefined;
  signal: AbortSignal;
}

interface EnsureCompatibleEntryArgs {
  entry: RuntimeEntry;
  skillConfig: RuntimeSkillConfig | null;
  targetThreadId?: string;
}

interface ReplaceEntryForSkillCatalogArgs {
  entry: RuntimeEntry;
  skillConfig: RuntimeSkillConfig;
}

interface SkillCatalogConflictErrorArgs {
  environmentId: string;
  activeCatalogHash: string | null;
  requestedCatalogHash: string;
}

/**
 * Internal invariant guard: thrown when an environment's runtime must be
 * replaced to pick up a changed injected skill catalog while it has active
 * work (active threads or open terminals) and the requesting command targets
 * no thread. No production caller can reach this — only thread commands
 * (thread.start, turn.submit) resolve with injected skill sources, and they
 * always pass a targetThreadId, which reuses the busy runtime and defers the
 * refresh instead. Reaching this error indicates a daemon bug.
 */
export class SkillCatalogConflictError extends Error {
  constructor(args: SkillCatalogConflictErrorArgs) {
    super(
      `Daemon bug: a command targeting no thread carried injected skill sources into busy environment ${args.environmentId} (active catalog ${args.activeCatalogHash ?? "none"}, requested ${args.requestedCatalogHash})`,
    );
    this.name = "SkillCatalogConflictError";
  }
}

function formatProviderProcessExitStatus(
  info: AgentRuntimeProcessExitInfo,
): string {
  if (info.signal) {
    return `signal ${info.signal}`;
  }
  if (info.code !== null) {
    return `code ${info.code}`;
  }
  return "unknown status";
}

function buildProviderProcessExitMessage(
  info: AgentRuntimeProcessExitInfo,
): string {
  return `Provider "${info.providerId}" exited unexpectedly with ${formatProviderProcessExitStatus(info)}`;
}

function buildProviderProcessExitDetail(
  info: AgentRuntimeProcessExitInfo,
): string | undefined {
  if (!info.stderr) {
    return undefined;
  }
  return `stderr:\n${info.stderr.slice(-PROVIDER_PROCESS_EXIT_DETAIL_MAX_LENGTH)}`;
}

export interface RuntimeEntry {
  environmentId: string;
  runtime: AgentRuntime;
  skillCatalogHash: string | null;
  /**
   * Log-throttle state only: the last stale requested catalog hash this entry
   * warned about, so the deferral warn fires once per requested catalog
   * instead of on every command while the runtime stays busy. It never drives
   * the deferred refresh — every thread command re-stages and re-compares the
   * catalog.
   */
  lastWarnedStaleSkillCatalogHash: string | null;
  stopWatchingStatus: StopWatching;
  workspace: HostWorkspace;
  path: string;
  terminals: Set<string>;
}

export interface InjectedSkillsChangedNotification {
  changedPaths: string[];
  sourceType: InjectedSkillsObservedChange["sourceType"];
}

export interface EnsureEnvironmentArgs {
  environmentId: string;
  injectedSkillSources?: readonly HostDaemonInjectedSkillSource[];
  personalWorkspaceRoot?: string;
  /**
   * The thread the requesting command targets; set by thread commands that
   * resolve with injected skill sources (thread.start, turn.submit). When
   * set, a busy runtime is reused even when its injected skill catalog is
   * stale, instead of failing the command and dropping the thread's message;
   * the catalog refresh is deferred to the next launch on an idle
   * environment.
   */
  targetThreadId?: string;
  workspacePath?: string;
  workspaceProvisionType?: WorkspaceProvisionType;
  provision?: ProvisionWorkspaceArgs;
}

export interface CancelEnvironmentProvisionArgs {
  environmentId: string;
}

export interface CancelEnvironmentProvisionResult {
  aborted: boolean;
}

export interface RuntimeManagerOptions {
  bridgeBundleDir?: AgentRuntimeOptions["bridgeBundleDir"];
  createRuntime?: (options: AgentRuntimeOptions) => AgentRuntime;
  dataDir?: string;
  dataDirSkillsRootPath?: string | null;
  hostWatcher?: HostWatcher;
  logger?: Pick<Logger, "debug" | "warn">;
  provisionWorkspace?: (
    options: ProvisionWorkspaceArgs,
  ) => Promise<HostWorkspace>;
  shellEnv?: AgentRuntimeOptions["shellEnv"];
  onEvent?: (args: { environmentId: string; event: ThreadEvent }) => void;
  threadStorageRootPath?: string | null;
  onInjectedSkillsChanged?: (args: InjectedSkillsChangedNotification) => void;
  onDataDirSkillsWatchError?: (args: {
    error: DataDirSkillsWatchError;
  }) => void;
  onWorkspaceStatusChanged?: (args: {
    changeKinds: HostDaemonEnvironmentChange[];
    environmentId: string;
  }) => void;
  onInteractiveRequest?: (
    request: PendingInteractionCreate,
  ) => Promise<PendingInteractionResolution>;
  onToolCall?: AgentRuntimeOptions["onToolCall"];
  onStderr?: AgentRuntimeOptions["onStderr"];
  onProcessExit?: AgentRuntimeOptions["onProcessExit"];
}

interface RuntimeWorkspaceWriteRootsArgs {
  threadStorageRootPath: string | null | undefined;
  workspaceRoots: readonly string[];
}

interface PendingEnvironmentProvision {
  abortController: AbortController;
  done: Promise<unknown>;
}

interface RunCancellableEnvironmentProvisionArgs {
  environmentId: string;
  work: (signal: AbortSignal) => Promise<void>;
}

export class RuntimeManager {
  private readonly createRuntime;
  private readonly hostWatcher;
  private readonly provisionWorkspace;
  private readonly baseShellEnv;
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly pendingEntries = new Map<string, Promise<RuntimeEntry>>();
  private readonly pendingEnvironmentProvisions = new Map<
    string,
    PendingEnvironmentProvision
  >();
  private providerMaintenanceRuntime: AgentRuntime | null = null;
  private pendingProviderMaintenanceRuntime: Promise<AgentRuntime> | null =
    null;
  private managedShellEnv: NonNullable<AgentRuntimeOptions["shellEnv"]> = {};
  private stopWatchingDataDirSkillsRoot: StopWatching = STOP_WATCHING;

  constructor(private readonly options: RuntimeManagerOptions = {}) {
    this.createRuntime = options.createRuntime ?? createAgentRuntime;
    this.hostWatcher = options.hostWatcher;
    this.provisionWorkspace = options.provisionWorkspace ?? provisionWorkspace;
    this.baseShellEnv = { ...(options.shellEnv ?? {}) };
    this.ensureDataDirSkillsWatcher();
  }

  private runtimeWorkspaceWriteRoots(
    args: RuntimeWorkspaceWriteRootsArgs,
  ): string[] {
    const roots = [...args.workspaceRoots];
    if (args.threadStorageRootPath) {
      // Provider runtimes are environment-scoped and may host multiple threads.
      // BB_THREAD_STORAGE still points agents at their own thread subdirectory;
      // this root lets workspace-write sandboxes mutate that path.
      roots.push(args.threadStorageRootPath);
    }
    return [...new Set(roots)];
  }

  get(environmentId: string): RuntimeEntry | undefined {
    return this.entries.get(environmentId);
  }

  async getOrAwait(environmentId: string): Promise<RuntimeEntry | undefined> {
    const existing = this.entries.get(environmentId);
    if (existing) {
      return existing;
    }

    const pending = this.pendingEntries.get(environmentId);
    if (pending) {
      return pending;
    }

    return undefined;
  }

  markTerminalActive(environmentId: string, terminalId: string): void {
    this.entries.get(environmentId)?.terminals.add(terminalId);
  }

  markTerminalInactive(environmentId: string, terminalId: string): void {
    this.entries.get(environmentId)?.terminals.delete(terminalId);
  }

  listActiveThreads(): HostDaemonActiveThread[] {
    const activeThreads: HostDaemonActiveThread[] = [];
    for (const entry of this.entries.values()) {
      for (const threadId of entry.runtime.getActiveThreadIds()) {
        activeThreads.push({
          threadId,
        });
      }
    }
    return activeThreads;
  }

  listLoadedEnvironments(): HostDaemonLoadedEnvironment[] {
    return [...this.entries.keys()].map((environmentId) => ({
      environmentId,
    }));
  }

  getShellEnv(): NonNullable<AgentRuntimeOptions["shellEnv"]> {
    return {
      ...this.baseShellEnv,
      ...this.managedShellEnv,
    };
  }

  private getInjectedSkillsLogger(): InjectedSkillsLogger | undefined {
    return this.options.logger;
  }

  private async resolveRuntimeSkillConfig(
    args: EnsureEnvironmentArgs,
  ): Promise<RuntimeSkillConfig | null> {
    if (args.injectedSkillSources === undefined) {
      return null;
    }
    if (args.injectedSkillSources.length === 0) {
      return {
        catalogHash: EMPTY_SKILL_CATALOG_HASH,
        skillRoots: [],
      };
    }
    if (!this.options.dataDir) {
      throw new Error("Runtime skill staging requires a host dataDir");
    }
    return stageInjectedSkillSources({
      dataDir: this.options.dataDir,
      injectedSkillSources: args.injectedSkillSources,
      logger: this.getInjectedSkillsLogger(),
    });
  }

  private entryHasActiveRuntimeWork(entry: RuntimeEntry): boolean {
    return (
      entry.terminals.size > 0 ||
      entry.runtime.getActiveThreadIds().length > 0
    );
  }

  /**
   * Removes staged skill catalog directories no loaded entry references.
   * `pendingCatalogHashes` names catalogs that are about to become active but
   * are not yet registered in `entries` — e.g. the replacement catalog during
   * a runtime swap — so the cleanup does not delete a just-staged directory.
   */
  private async cleanupUnusedInjectedSkillStagingDirs(
    pendingCatalogHashes: readonly string[],
  ): Promise<void> {
    if (!this.options.dataDir) {
      return;
    }
    try {
      await cleanupInjectedSkillStagingDirs({
        dataDir: this.options.dataDir,
        keepCatalogHashes: [
          ...pendingCatalogHashes,
          ...[...this.entries.values()].flatMap((entry) =>
            entry.skillCatalogHash === null ? [] : [entry.skillCatalogHash],
          ),
        ],
        logger: this.getInjectedSkillsLogger(),
      });
    } catch (error) {
      this.options.logger?.warn(
        {
          reason:
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "Unable to clean injected skill staging directories",
        },
        "Failed to clean injected skill staging directories",
      );
    }
  }

  private async replaceEntryForSkillCatalog(
    args: ReplaceEntryForSkillCatalogArgs,
  ): Promise<void> {
    if (this.entryHasActiveRuntimeWork(args.entry)) {
      throw new SkillCatalogConflictError({
        environmentId: args.entry.environmentId,
        activeCatalogHash: args.entry.skillCatalogHash,
        requestedCatalogHash: args.skillConfig.catalogHash,
      });
    }

    this.entries.delete(args.entry.environmentId);
    await this.stopWatchingStatus(args.entry);
    await args.entry.runtime.shutdown();
    await this.cleanupUnusedInjectedSkillStagingDirs([
      args.skillConfig.catalogHash,
    ]);
  }

  private async ensureCompatibleEntry(
    args: EnsureCompatibleEntryArgs,
  ): Promise<RuntimeEntry | null> {
    if (
      args.skillConfig === null ||
      args.entry.skillCatalogHash === args.skillConfig.catalogHash ||
      (args.entry.skillCatalogHash === null &&
        args.skillConfig.skillRoots.length === 0)
    ) {
      return args.entry;
    }

    // A thread command must not force a catalog swap while the runtime is
    // busy: replacement would kill in-flight work, and failing the command
    // would drop the thread's message — an agent can trigger this against its
    // own thread by installing a skill mid-turn, and an open terminal would
    // otherwise pin every thread in the environment into the failure. Reuse
    // the busy runtime with its stale catalog and defer the refresh to the
    // next launch on an idle environment.
    if (
      args.targetThreadId !== undefined &&
      this.entryHasActiveRuntimeWork(args.entry)
    ) {
      if (
        args.entry.lastWarnedStaleSkillCatalogHash !==
        args.skillConfig.catalogHash
      ) {
        args.entry.lastWarnedStaleSkillCatalogHash =
          args.skillConfig.catalogHash;
        this.options.logger?.warn(
          {
            environmentId: args.entry.environmentId,
            threadId: args.targetThreadId,
            activeCatalogHash: args.entry.skillCatalogHash,
            requestedCatalogHash: args.skillConfig.catalogHash,
          },
          "Deferring injected skill catalog refresh for busy runtime",
        );
      }
      return args.entry;
    }

    await this.replaceEntryForSkillCatalog({
      entry: args.entry,
      skillConfig: args.skillConfig,
    });
    return null;
  }

  replaceManagedShellEnv(
    shellEnv: NonNullable<AgentRuntimeOptions["shellEnv"]>,
  ): void {
    this.managedShellEnv = { ...shellEnv };
  }

  async openWorkspace(path: string): Promise<HostWorkspace> {
    return this.provisionWorkspace({
      workspaceProvisionType: "unmanaged",
      path,
    });
  }

  async ensureProviderMaintenanceRuntime(args: {
    dataDir: string;
  }): Promise<AgentRuntime> {
    if (this.providerMaintenanceRuntime) {
      return this.providerMaintenanceRuntime;
    }
    if (this.pendingProviderMaintenanceRuntime) {
      return this.pendingProviderMaintenanceRuntime;
    }

    const creation = this.createProviderMaintenanceRuntime(args).then(
      (runtime) => {
        this.providerMaintenanceRuntime = runtime;
        return runtime;
      },
    );
    this.pendingProviderMaintenanceRuntime = creation.finally(() => {
      this.pendingProviderMaintenanceRuntime = null;
    });
    return this.pendingProviderMaintenanceRuntime;
  }

  async ensureEnvironment(args: EnsureEnvironmentArgs): Promise<RuntimeEntry> {
    const skillConfig = await this.resolveRuntimeSkillConfig(args);
    const existing = this.entries.get(args.environmentId);
    if (existing) {
      await this.runCancellableEnvironmentProvision({
        environmentId: args.environmentId,
        work: (signal) =>
          this.applyExistingEnvironmentProvision({
            entry: existing,
            provision: args.provision,
            signal,
          }),
      });
      const compatible = await this.ensureCompatibleEntry({
        entry: existing,
        skillConfig,
        ...(args.targetThreadId !== undefined
          ? { targetThreadId: args.targetThreadId }
          : {}),
      });
      if (compatible) {
        return compatible;
      }
    }

    const pending = this.pendingEntries.get(args.environmentId);
    if (pending) {
      const entry = await pending;
      const compatible = await this.ensureCompatibleEntry({
        entry,
        skillConfig,
        ...(args.targetThreadId !== undefined
          ? { targetThreadId: args.targetThreadId }
          : {}),
      });
      if (compatible) {
        return compatible;
      }
    }

    const pendingProvision = this.createPendingEnvironmentProvision(
      args.environmentId,
    );
    const creation = Promise.resolve()
      .then(() =>
        this.createEntry({
          ...args,
          provisionSignal: pendingProvision.abortController.signal,
          skillConfig,
        }),
      )
      .then((entry) => {
        this.entries.set(args.environmentId, entry);
        return entry;
      })
      .finally(() => {
        this.pendingEntries.delete(args.environmentId);
        this.clearPendingEnvironmentProvision(
          args.environmentId,
          pendingProvision,
        );
      });
    pendingProvision.done = creation;
    this.pendingEntries.set(args.environmentId, creation);

    return creation;
  }

  async cancelEnvironmentProvision(
    args: CancelEnvironmentProvisionArgs,
  ): Promise<CancelEnvironmentProvisionResult> {
    const pending = this.pendingEnvironmentProvisions.get(args.environmentId);
    if (!pending) {
      return { aborted: false };
    }

    pending.abortController.abort(
      new WorkspaceError(
        "provision_cancelled",
        "Environment provisioning was cancelled",
      ),
    );
    return { aborted: true };
  }

  private async runCancellableEnvironmentProvision(
    args: RunCancellableEnvironmentProvisionArgs,
  ): Promise<void> {
    const existing = this.pendingEnvironmentProvisions.get(args.environmentId);
    if (existing) {
      await existing.done;
      return;
    }

    const pending = this.createPendingEnvironmentProvision(args.environmentId);
    const done = Promise.resolve().then(() =>
      args.work(pending.abortController.signal),
    );
    pending.done = done;
    try {
      return await done;
    } finally {
      this.clearPendingEnvironmentProvision(args.environmentId, pending);
    }
  }

  private createPendingEnvironmentProvision(
    environmentId: string,
  ): PendingEnvironmentProvision {
    const pending: PendingEnvironmentProvision = {
      abortController: new AbortController(),
      done: Promise.resolve(),
    };
    this.pendingEnvironmentProvisions.set(environmentId, pending);
    return pending;
  }

  private clearPendingEnvironmentProvision(
    environmentId: string,
    pending: PendingEnvironmentProvision,
  ): void {
    if (this.pendingEnvironmentProvisions.get(environmentId) === pending) {
      this.pendingEnvironmentProvisions.delete(environmentId);
    }
  }

  private async applyExistingEnvironmentProvision(
    args: ApplyExistingEnvironmentProvisionArgs,
  ): Promise<void> {
    if (
      args.provision?.workspaceProvisionType !== "unmanaged" ||
      !args.provision.checkout
    ) {
      return;
    }
    if (args.provision.path !== args.entry.path) {
      throw new Error(
        `Cannot reprovision existing environment ${args.entry.environmentId} at a different path`,
      );
    }

    await this.provisionWorkspace({ ...args.provision, signal: args.signal });
    this.options.onWorkspaceStatusChanged?.({
      environmentId: args.entry.environmentId,
      changeKinds: ["work-status-changed", "git-refs-changed"],
    });
  }

  async destroyEnvironment(environmentId: string): Promise<void> {
    const existing = this.entries.get(environmentId);
    const pending = this.pendingEntries.get(environmentId);
    const entry = existing ?? (pending ? await pending : undefined);

    if (!entry) {
      return;
    }

    this.entries.delete(environmentId);
    await this.stopWatchingStatus(entry);
    await entry.runtime.shutdown();
    await entry.workspace.destroy();
    await this.cleanupUnusedInjectedSkillStagingDirs([]);
  }

  async forgetEnvironment(environmentId: string): Promise<void> {
    const existing = this.entries.get(environmentId);
    const pending = this.pendingEntries.get(environmentId);
    let entry = existing;
    if (!entry && pending) {
      try {
        entry = await pending;
      } catch {
        entry = undefined;
      }
    }

    if (!entry) {
      return;
    }

    this.entries.delete(environmentId);
    await this.stopWatchingStatus(entry);
    await entry.runtime.shutdown();
    await this.cleanupUnusedInjectedSkillStagingDirs([]);
  }

  async evictIdleEnvironments(): Promise<string[]> {
    // A pending environment creation is still active work. If we evict around
    // it, the creation can resolve immediately after this sweep and resurrect
    // an idle runtime entry that missed the eviction pass.
    if (this.pendingEntries.size > 0) {
      return [];
    }

    const idleEntries = [...this.entries.values()].filter(
      (entry) => !this.entryHasActiveRuntimeWork(entry),
    );

    for (const entry of idleEntries) {
      await this.stopWatchingStatus(entry);
      this.entries.delete(entry.environmentId);
    }

    const shutdownResults = await Promise.allSettled(
      idleEntries.map(async (entry) => {
        await entry.runtime.shutdown();
        return entry.environmentId;
      }),
    );
    const firstRejected = shutdownResults.find(
      (result) => result.status === "rejected",
    );
    if (firstRejected && firstRejected.status === "rejected") {
      throw firstRejected.reason;
    }

    await this.cleanupUnusedInjectedSkillStagingDirs([]);
    return shutdownResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
  }

  async shutdownAll(): Promise<void> {
    const entries = [...this.entries.values()];
    for (const pending of this.pendingEntries.values()) {
      try {
        entries.push(await pending);
      } catch {
        // Ignore failed provisions during shutdown
      }
    }
    this.entries.clear();
    this.pendingEntries.clear();

    for (const entry of entries) {
      await this.stopWatchingStatus(entry);
      await entry.runtime.shutdown();
      // Do NOT call workspace.destroy() — the server owns managed workspace
      // lifecycle via explicit environment.destroy commands. Daemon shutdown
      // should only release in-memory state and stop provider processes.
    }
    const providerMaintenanceRuntime =
      this.providerMaintenanceRuntime ??
      (this.pendingProviderMaintenanceRuntime
        ? await this.pendingProviderMaintenanceRuntime.catch(() => null)
        : null);
    this.providerMaintenanceRuntime = null;
    this.pendingProviderMaintenanceRuntime = null;
    if (providerMaintenanceRuntime) {
      await providerMaintenanceRuntime.shutdown();
    }
    await this.stopWatchingDataDirSkillsRoot();
    this.stopWatchingDataDirSkillsRoot = STOP_WATCHING;
    await this.cleanupUnusedInjectedSkillStagingDirs([]);
  }

  /**
   * Synthesizes failure events for threads that were mid-turn when their
   * provider process died, from the runtime's final per-thread snapshot.
   * Threads without an active turn need no synthesized events: in-flight
   * RPCs fail through the command result path, and idle resident threads
   * simply resume on their next turn.
   */
  private buildUnexpectedProviderExitEvents(
    info: AgentRuntimeProcessExitInfo,
  ): ThreadEvent[] {
    const message = buildProviderProcessExitMessage(info);
    const detail = buildProviderProcessExitDetail(info);
    const events: ThreadEvent[] = [];

    for (const thread of info.threads) {
      if (thread.activeTurnId === null || thread.providerThreadId === null) {
        continue;
      }

      events.push({
        type: "turn/completed",
        threadId: thread.threadId,
        providerThreadId: thread.providerThreadId,
        scope: turnScope(thread.activeTurnId),
        status: "failed",
        error: { message },
      });
      events.push({
        type: "system/error",
        threadId: thread.threadId,
        scope: turnScope(thread.activeTurnId),
        code: "provider_process_exited",
        message,
        ...(detail ? { detail } : {}),
      });
    }

    return events;
  }

  private async createProviderMaintenanceRuntime(args: {
    dataDir: string;
  }): Promise<AgentRuntime> {
    const workspacePath = path.join(
      args.dataDir,
      PROVIDER_MAINTENANCE_WORKSPACE_DIR,
    );
    await mkdir(workspacePath, { recursive: true });

    let runtime: AgentRuntime | null = null;
    runtime = this.createRuntime({
      workspacePath,
      additionalWorkspaceWriteRoots: [],
      shellEnv: this.getShellEnv(),
      threadStorageRootPath: this.options.threadStorageRootPath ?? undefined,
      bridgeBundleDir: this.options.bridgeBundleDir,
      onEvent: (event) => {
        this.options.onStderr?.(
          `Dropping provider maintenance event ${event.type}; no environment owns provider-only maintenance commands.`,
          event.threadId,
        );
      },
      onToolCall:
        this.options.onToolCall ??
        (async () => ({
          contentItems: [],
          success: true,
        })),
      onInteractiveRequest: this.options.onInteractiveRequest,
      onStderr: this.options.onStderr,
      onProcessExit: (info) => {
        if (
          runtime &&
          this.providerMaintenanceRuntime === runtime &&
          runtime.listRunningProviders().length === 0
        ) {
          this.providerMaintenanceRuntime = null;
        }
        this.options.onProcessExit?.(info);
      },
    });
    return runtime;
  }

  private async createEntry(args: CreateEntryArgs): Promise<RuntimeEntry> {
    const provision =
      args.provision ??
      (args.workspacePath
        ? reconnectProvisionArgs({
            environmentId: args.environmentId,
            ...(args.personalWorkspaceRoot !== undefined
              ? { personalWorkspaceRoot: args.personalWorkspaceRoot }
              : {}),
            workspacePath: args.workspacePath,
            workspaceProvisionType: args.workspaceProvisionType ?? "unmanaged",
          })
        : null);

    if (!provision) {
      throw new Error(
        `Missing workspace path for environment ${args.environmentId}`,
      );
    }

    const workspace = await this.provisionWorkspace({
      ...provision,
      signal: args.provisionSignal,
    });
    const workspaceWriteRoots =
      await workspace.getAdditionalWorkspaceWriteRoots();
    const additionalWorkspaceWriteRoots = this.runtimeWorkspaceWriteRoots({
      threadStorageRootPath: this.options.threadStorageRootPath,
      workspaceRoots: workspaceWriteRoots,
    });
    let runtime: AgentRuntime | null = null;
    runtime = this.createRuntime({
      workspacePath: workspace.path,
      additionalWorkspaceWriteRoots,
      ...(args.skillConfig ? { skillRoots: args.skillConfig.skillRoots } : {}),
      shellEnv: this.getShellEnv(),
      threadStorageRootPath: this.options.threadStorageRootPath ?? undefined,
      bridgeBundleDir: this.options.bridgeBundleDir,
      onEvent: (event) => {
        this.options.onEvent?.({
          environmentId: args.environmentId,
          event,
        });
      },
      onToolCall:
        this.options.onToolCall ??
        (async () => ({
          contentItems: [],
          success: true,
        })),
      onInteractiveRequest: this.options.onInteractiveRequest,
      onStderr: this.options.onStderr,
      onProcessExit: (info) => {
        if (!info.expected) {
          for (const event of this.buildUnexpectedProviderExitEvents(info)) {
            this.options.onEvent?.({
              environmentId: args.environmentId,
              event,
            });
          }
        }
        const current = this.entries.get(args.environmentId);
        if (
          current?.runtime === runtime &&
          runtime.listRunningProviders().length === 0
        ) {
          this.entries.delete(args.environmentId);
        }
        this.options.onProcessExit?.(info);
      },
    });

    return {
      environmentId: args.environmentId,
      runtime,
      skillCatalogHash: args.skillConfig?.catalogHash ?? null,
      lastWarnedStaleSkillCatalogHash: null,
      stopWatchingStatus: STOP_WATCHING,
      terminals: new Set<string>(),
      workspace,
      path: workspace.path,
    };
  }

  private async stopWatchingStatus(entry: RuntimeEntry): Promise<void> {
    const stopWatchingStatus = entry.stopWatchingStatus;
    entry.stopWatchingStatus = STOP_WATCHING;
    await stopWatchingStatus();
  }

  private ensureDataDirSkillsWatcher(): void {
    if (
      !this.hostWatcher?.watchDataDirSkillsRoot ||
      this.stopWatchingDataDirSkillsRoot !== STOP_WATCHING
    ) {
      return;
    }

    const dataDirSkillsRootPath = this.options.dataDirSkillsRootPath;
    if (!dataDirSkillsRootPath) {
      return;
    }

    this.stopWatchingDataDirSkillsRoot =
      this.hostWatcher.watchDataDirSkillsRoot({
        dataDirSkillsRootPath,
        onChange: (event) => {
          this.options.onInjectedSkillsChanged?.({
            changedPaths: event.changedPaths,
            sourceType: event.sourceType,
          });
        },
        onWatchError: (error) => {
          this.options.onDataDirSkillsWatchError?.({
            error,
          });
        },
      });
  }
}
