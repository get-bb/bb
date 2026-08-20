import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentRuntime } from "@bb/agent-runtime";
import type {
  HostDaemonInjectedSkillSource,
  ProviderCliInstallEvent,
  ProviderCliStatus,
} from "@bb/host-daemon-contract";
import type { HostWorkspace } from "@bb/host-workspace";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  dispatchCommand,
  dispatchOnlineRpcCommand,
} from "./command-dispatch.js";
import {
  DISPATCH_TEST_BRIDGE_LAUNCH,
  DISPATCH_TEST_RUNTIME_BRIDGE_LAUNCH,
  silentLogger,
} from "../test/command/dispatch-helpers.js";
import type { CommandOf } from "./command-dispatch-support.js";
import { RuntimeManager } from "./runtime-manager.js";

const WORKSPACE_PATH = "/tmp/bb-command-dispatch-test";

interface Deferred<TValue> {
  promise: Promise<TValue>;
  resolve: (value: TValue | PromiseLike<TValue>) => void;
  reject: (reason?: Error) => void;
}

interface WriteInjectedSkillSourceArgs {
  dataDir: string;
  token: string;
}

interface BusySkillCatalogFixture {
  createRuntimeSpy: Mock<() => AgentRuntime>;
  dataDir: string;
  manager: RuntimeManager;
  originalCatalogHash: string | null;
  runtime: FakeDispatchRuntime;
  source: HostDaemonInjectedSkillSource;
}

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function writeInjectedSkillSource(
  args: WriteInjectedSkillSourceArgs,
): Promise<HostDaemonInjectedSkillSource> {
  const sourceRootPath = path.join(args.dataDir, "skills", "release-notes");
  await fs.mkdir(sourceRootPath, { recursive: true });
  await fs.writeFile(
    path.join(sourceRootPath, "SKILL.md"),
    [
      "---",
      "name: release-notes",
      "description: Use release-notes when command dispatch tests run.",
      "---",
      "",
      args.token,
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    kind: "workspace-path",
    sourceType: "project",
    name: "release-notes",
    description: "Use release-notes when command dispatch tests run.",
    sourceRootPath,
    skillFilePath: path.join(sourceRootPath, "SKILL.md"),
  };
}

/**
 * Builds the thread-brick scenario the catalog-deferral fix targets: an
 * environment whose runtime was created with an injected skill catalog, made
 * busy by an active thread, after which the skill source content changes so
 * the next staged catalog hash no longer matches the loaded runtime's.
 */
async function setupBusySkillCatalogEnvironment(args: {
  activeThreadId: string;
}): Promise<BusySkillCatalogFixture> {
  const dataDir = await makeTempDir("bb-command-dispatch-skills-");
  const source = await writeInjectedSkillSource({
    dataDir,
    token: "first-token",
  });
  const runtime = createRuntime();
  const createRuntimeSpy = vi.fn(() => runtime);
  const manager = new RuntimeManager({
    dataDir,
    createRuntime: createRuntimeSpy,
    provisionWorkspace: async () => createWorkspace(),
  });
  const entry = await manager.ensureEnvironment({
    environmentId: "env-1",
    injectedSkillSources: [source],
    workspacePath: WORKSPACE_PATH,
  });
  runtime.setActiveTurn(args.activeThreadId, "turn-busy-1");
  await writeInjectedSkillSource({ dataDir, token: "second-token" });
  return {
    createRuntimeSpy,
    dataDir,
    manager,
    originalCatalogHash: entry.skillCatalogHash,
    runtime,
    source,
  };
}

function createDeferred<TValue>(): Deferred<TValue> {
  let resolve!: Deferred<TValue>["resolve"];
  let reject!: Deferred<TValue>["reject"];
  const promise = new Promise<TValue>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

async function unexpectedWorkspaceCall(): Promise<never> {
  throw new Error("Unexpected workspace call");
}

function createWorkspace(workspacePath = WORKSPACE_PATH): HostWorkspace {
  return {
    path: workspacePath,
    managed: false,
    isGitRepo: false,
    isWorktree: false,
    getDefaultBranch: unexpectedWorkspaceCall,
    getCurrentBranch: unexpectedWorkspaceCall,
    getHeadSha: unexpectedWorkspaceCall,
    getLocalStateFingerprint: unexpectedWorkspaceCall,
    getSharedGitRefsFingerprint: unexpectedWorkspaceCall,
    getAdditionalWorkspaceWriteRoots: vi.fn(async () => []),
    getStatus: unexpectedWorkspaceCall,
    getDiff: unexpectedWorkspaceCall,
    diffFiles: unexpectedWorkspaceCall,
    diffPatch: unexpectedWorkspaceCall,
    getPullRequest: unexpectedWorkspaceCall,
    runPullRequestAction: unexpectedWorkspaceCall,
    listBranches: unexpectedWorkspaceCall,
    listFiles: unexpectedWorkspaceCall,
    commit: unexpectedWorkspaceCall,
    reset: unexpectedWorkspaceCall,
    fetch: unexpectedWorkspaceCall,
    squashMerge: unexpectedWorkspaceCall,
    destroy: vi.fn(async () => undefined),
  };
}

interface FakeDispatchRuntime extends AgentRuntime {
  /** Test-only mutator for the runtime-owned per-thread turn state. */
  setActiveTurn: (threadId: string, turnId: string) => void;
  setIdle: (threadId: string) => void;
}

function createRuntime(): FakeDispatchRuntime {
  const activeTurnsByThreadId = new Map<string, string>();
  const hostedThreadIds = new Set<string>();
  return {
    ensureProvider: vi.fn(async () => undefined),
    startThread: vi.fn(async (args: { threadId: string }) => {
      hostedThreadIds.add(args.threadId);
      return { providerThreadId: "provider-thread-1" };
    }),
    prepareThreadRewind: vi.fn(async () => ({
      providerThreadId: "provider-thread-rewind-1",
    })),
    discardThreadRewind: vi.fn(async () => undefined),
    resumeThread: vi.fn(async (args: { threadId: string }) => {
      hostedThreadIds.add(args.threadId);
      return { providerThreadId: "provider-thread-1" };
    }),
    runTurn: vi.fn(async () => undefined),
    steerTurn: vi.fn(async () => ({ status: "steered" as const })),
    stopThread: vi.fn(async (args: { threadId: string }) => {
      activeTurnsByThreadId.delete(args.threadId);
      hostedThreadIds.delete(args.threadId);
      return { providerCheckpointId: null };
    }),
    clearThreadGoal: vi.fn(async () => ({ cleared: true })),
    renameThread: vi.fn(async () => undefined),
    archiveThread: vi.fn(async () => undefined),
    unarchiveThread: vi.fn(async () => undefined),
    listModels: vi.fn(async () => ({
      models: [],
      selectedOnlyModels: [],
    })),
    providerHealth: vi.fn(async () => ({ supported: false as const })),
    providerUsage: vi.fn(async () => ({ supported: false as const })),
    providerInstallationStatus: vi.fn(async () => {
      throw new Error("Unexpected provider installation status call");
    }),
    providerInstallationRun: vi.fn(async () => {
      throw new Error("Unexpected provider installation run call");
    }),
    listRunningProviders: vi.fn(() => ["fake"]),
    getActiveTurnId: (threadId) => activeTurnsByThreadId.get(threadId) ?? null,
    waitForActiveTurn: vi.fn(
      async (threadId: string) => activeTurnsByThreadId.get(threadId) ?? null,
    ),
    getProviderSession: (threadId) =>
      hostedThreadIds.has(threadId)
        ? { providerId: "fake", providerThreadId: "provider-thread-1" }
        : null,
    reapIdleProviderSessions: vi.fn(async () => ({ reapedSessions: [] })),
    hasThread: (threadId) => hostedThreadIds.has(threadId),
    getLiveThreadIds: () => [...activeTurnsByThreadId.keys()],
    hasOpenBackgroundWork: () => false,
    shutdown: vi.fn(async () => undefined),
    setActiveTurn: (threadId, turnId) => {
      hostedThreadIds.add(threadId);
      activeTurnsByThreadId.set(threadId, turnId);
    },
    setIdle: (threadId: string) => {
      hostedThreadIds.add(threadId);
      activeTurnsByThreadId.delete(threadId);
    },
  };
}

function createProviderCliInstallEventStream(
  events: readonly ProviderCliInstallEvent[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }
      controller.close();
    },
  });
}

function claudeCodeStatus(args: {
  currentVersion: string;
  latestVersion: string | null;
}): ProviderCliStatus {
  return {
    displayName: "Claude Code",
    executableName: "claude",
    executablePath: "/Users/me/.local/bin/claude",
    installed: true,
    installSource: "external",
    currentVersion: args.currentVersion,
    latestVersion: args.latestVersion,
    minimumSupportedVersion: null,
    npmPackageName: "@anthropic-ai/claude-code",
    npmGlobalPackageVersion: null,
    installAction: {
      kind: "update",
      label: "Update",
      command: "claude update",
    },
    needsUpdate:
      args.latestVersion === null || args.currentVersion !== args.latestVersion,
    versionUnsupported: false,
  };
}

function supportedCodexInstallationStatus(): ProviderCliStatus {
  return {
    displayName: "Codex",
    executableName: "codex",
    executablePath: "/usr/local/bin/codex",
    installed: true,
    installSource: "npmGlobal",
    currentVersion: "0.146.0",
    latestVersion: null,
    minimumSupportedVersion: "0.136.0",
    npmPackageName: "@openai/codex",
    npmGlobalPackageVersion: "0.146.0",
    installAction: null,
    needsUpdate: false,
    versionUnsupported: false,
  };
}

async function runSuccessfulClaudeCodeUpdateVerification(args: {
  before: ProviderCliStatus;
  after: ProviderCliStatus;
}) {
  const dataDir = await makeTempDir("bb-command-dispatch-provider-cli-");
  const manager = new RuntimeManager({
    dataDir,
    createRuntime,
    provisionWorkspace: async () => createWorkspace(),
  });
  const providerInstallationStatus = vi.fn().mockResolvedValueOnce(args.after);
  const events: ProviderCliInstallEvent[] = [
    {
      type: "started",
      provider: "claude-code",
      command: "claude update",
    },
    {
      type: "completed",
      provider: "claude-code",
      exitCode: 0,
      signal: null,
      success: true,
    },
  ];
  const result = await dispatchOnlineRpcCommand(
    {
      type: "provider.installation.run",
      bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
      providerId: "claude-code",
      action: "update",
    },
    {
      dataDir,
      logger: silentLogger,
      eventSink: {
        emit: vi.fn(),
        flush: vi.fn(async () => undefined),
      },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      providerInstallationStatus,
      providerInstallationRun: async () => ({
        available: true,
        command: {
          command: "claude",
          args: ["update"],
          displayCommand: "claude update",
        },
        verification:
          args.before.latestVersion === null
            ? {
                kind: "version_changed",
                previousVersion: args.before.currentVersion ?? "unknown",
              }
            : {
                kind: "version_at_least",
                version: args.before.latestVersion,
              },
      }),
      runtimeManager: manager,
      streamProviderInstallation: () =>
        createProviderCliInstallEventStream(events),
      threadStorageRootPath: "/tmp/bb-thread-storage",
    },
  );
  return { events, providerInstallationStatus, result };
}

describe("dispatchCommand", () => {
  it("flushes buffered events before reporting thread.stop success", async () => {
    const runtime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async () => createWorkspace(),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/bb-command-dispatch-test",
    });
    runtime.setActiveTurn("thread-1", "turn-1");

    const flushDeferred = createDeferred<void>();
    const flush = vi.fn(async () => flushDeferred.promise);
    const command: CommandOf<"thread.stop"> = {
      type: "thread.stop",
      intent: "interrupt",
      environmentId: "env-1",
      threadId: "thread-1",
    };
    let resolved = false;
    const dispatchPromise = dispatchCommand(command, {
      dataDir: "/tmp/bb-data",
      logger: silentLogger,
      eventSink: {
        emit: vi.fn(),
        flush,
      },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      runtimeManager: manager,
      threadStorageRootPath: "/tmp/bb-thread-storage",
    }).then((result) => {
      resolved = true;
      return result;
    });

    await vi.waitFor(() => {
      expect(runtime.stopThread).toHaveBeenCalledWith({ threadId: "thread-1" });
      expect(flush).toHaveBeenCalledTimes(1);
    });
    expect(resolved).toBe(false);

    flushDeferred.resolve(undefined);
    await expect(dispatchPromise).resolves.toEqual({
      providerCheckpointId: null,
    });

    expect(resolved).toBe(true);
    expect(runtime.hasThread("thread-1")).toBe(false);
  });

  it("cancels Plan through the active provider runtime before flushing events", async () => {
    const runtime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async () => createWorkspace(),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: WORKSPACE_PATH,
    });
    runtime.setActiveTurn("thread-1", "turn-1");
    const flush = vi.fn(async () => undefined);

    const result = await dispatchCommand(
      {
        type: "thread.plan.cancel",
        environmentId: "env-1",
        threadId: "thread-1",
        expectedTurnId: "turn-1",
      },
      {
        dataDir: "/tmp/bb-data",
        logger: silentLogger,
        eventSink: { emit: vi.fn(), flush },
        fetchProjectAttachment: async () => {
          throw new Error("Unexpected project attachment fetch");
        },
        runtimeManager: manager,
        threadStorageRootPath: "/tmp/bb-thread-storage",
      },
    );

    expect(result).toEqual({ cancelled: true });
    expect(runtime.stopThread).toHaveBeenCalledWith({ threadId: "thread-1" });
    expect(flush).toHaveBeenCalledOnce();
  });

  it("does not cancel Plan after its turn has already ended", async () => {
    const runtime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async () => createWorkspace(),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: WORKSPACE_PATH,
    });
    runtime.setIdle("thread-1");
    const flush = vi.fn(async () => undefined);

    const result = await dispatchCommand(
      {
        type: "thread.plan.cancel",
        environmentId: "env-1",
        threadId: "thread-1",
        expectedTurnId: "turn-plan-1",
      },
      {
        dataDir: "/tmp/bb-data",
        logger: silentLogger,
        eventSink: { emit: vi.fn(), flush },
        fetchProjectAttachment: async () => {
          throw new Error("Unexpected project attachment fetch");
        },
        runtimeManager: manager,
        threadStorageRootPath: "/tmp/bb-thread-storage",
      },
    );

    expect(result).toEqual({ cancelled: false });
    expect(runtime.stopThread).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it("does not cancel a newer turn when the Plan cancellation is stale", async () => {
    const runtime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async () => createWorkspace(),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: WORKSPACE_PATH,
    });
    runtime.setActiveTurn("thread-1", "turn-newer-2");
    const flush = vi.fn(async () => undefined);

    const result = await dispatchCommand(
      {
        type: "thread.plan.cancel",
        environmentId: "env-1",
        threadId: "thread-1",
        expectedTurnId: "turn-plan-1",
      },
      {
        dataDir: "/tmp/bb-data",
        logger: silentLogger,
        eventSink: { emit: vi.fn(), flush },
        fetchProjectAttachment: async () => {
          throw new Error("Unexpected project attachment fetch");
        },
        runtimeManager: manager,
        threadStorageRootPath: "/tmp/bb-thread-storage",
      },
    );

    expect(result).toEqual({ cancelled: false });
    expect(runtime.getActiveTurnId("thread-1")).toBe("turn-newer-2");
    expect(runtime.stopThread).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it("resumes a reaped Codex runtime before clearing its Goal", async () => {
    const runtime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async () => createWorkspace(),
    });
    const flush = vi.fn(async () => undefined);
    const command: CommandOf<"thread.goal.clear"> = {
      bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
      type: "thread.goal.clear",
      environmentId: "env-1",
      threadId: "thread-1",
      options: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        workflowsEnabled: false,
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
      resumeContext: {
        bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
        workspaceContext: {
          workspacePath: WORKSPACE_PATH,
          workspaceProvisionType: "unmanaged",
        },
        projectId: "proj-1",
        providerId: "codex",
        providerThreadId: "provider-thread-1",
        instructions: "Be concise.",
        dynamicTools: [],
        injectedSkillSources: [],
        instructionMode: "append",
      },
    };

    const result = await dispatchCommand(command, {
      dataDir: "/tmp/bb-data",
      logger: silentLogger,
      eventSink: { emit: vi.fn(), flush },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      runtimeManager: manager,
      threadStorageRootPath: "/tmp/bb-thread-storage",
    });

    expect(result).toEqual({ cleared: true });
    expect(runtime.resumeThread).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "codex",
        providerThreadId: "provider-thread-1",
        threadId: "thread-1",
      }),
    );
    expect(runtime.clearThreadGoal).toHaveBeenCalledWith({
      threadId: "thread-1",
    });
    expect(flush).toHaveBeenCalledOnce();
  });

  it("releases a moved thread from its old environment before resuming it", async () => {
    const oldRuntime = createRuntime();
    const newRuntime = createRuntime();
    const createRuntimeSpy = vi
      .fn<() => AgentRuntime>()
      .mockReturnValueOnce(oldRuntime)
      .mockReturnValueOnce(newRuntime);
    const manager = new RuntimeManager({
      createRuntime: createRuntimeSpy,
      provisionWorkspace: async (args) =>
        createWorkspace("path" in args ? args.path : args.targetPath),
    });
    await manager.ensureEnvironment({
      environmentId: "env-old",
      workspacePath: "/tmp/bb-command-dispatch-old",
    });
    oldRuntime.setIdle("thread-1");

    const command: CommandOf<"turn.submit"> = {
      bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
      type: "turn.submit",
      environmentId: "env-new",
      threadId: "thread-1",
      requestId: "creq_moved_thread",
      input: [{ type: "text", text: "follow up", mentions: [] }],
      options: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        workflowsEnabled: false,
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
      resumeContext: {
        bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
        workspaceContext: {
          workspacePath: "/tmp/bb-command-dispatch-new",
          workspaceProvisionType: "unmanaged",
        },
        projectId: "proj_1",
        providerId: "codex",
        providerThreadId: "provider-thread-1",
        instructions: "Be concise.",
        dynamicTools: [],
        injectedSkillSources: [],
        instructionMode: "append",
      },
      target: { mode: "start" },
    };

    const result = await dispatchCommand(command, {
      dataDir: "/tmp/bb-data",
      logger: silentLogger,
      eventSink: {
        emit: vi.fn(),
        flush: vi.fn(async () => undefined),
      },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      runtimeManager: manager,
      threadStorageRootPath: "/tmp/bb-thread-storage",
    });

    expect(result).toEqual({ appliedAs: "new-turn" });
    expect(oldRuntime.stopThread).toHaveBeenCalledWith({
      threadId: "thread-1",
    });
    expect(createRuntimeSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        workspacePath: "/tmp/bb-command-dispatch-new",
      }),
    );
    expect(newRuntime.resumeThread).toHaveBeenCalledWith(
      expect.objectContaining({
        providerThreadId: "provider-thread-1",
        threadId: "thread-1",
      }),
    );
    expect(
      (oldRuntime.stopThread as unknown as Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (newRuntime.resumeThread as unknown as Mock).mock.invocationCallOrder[0],
    );
  });

  it("stops the old owner when the moved thread has no runtime yet", async () => {
    const oldRuntime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => oldRuntime,
      provisionWorkspace: async () => createWorkspace("/tmp/bb-stop-old"),
    });
    await manager.ensureEnvironment({
      environmentId: "env-old",
      workspacePath: "/tmp/bb-stop-old",
    });
    oldRuntime.setActiveTurn("thread-1", "turn-old");
    (oldRuntime.stopThread as Mock).mockResolvedValueOnce({
      providerCheckpointId: "pi-entry-at-stop",
    });

    // The thread already points at its new environment, which the daemon has
    // never loaded. The stop must still reach the turn in the old runtime.
    const command: CommandOf<"thread.stop"> = {
      type: "thread.stop",
      intent: "interrupt",
      environmentId: "env-new",
      threadId: "thread-1",
    };
    const flush = vi.fn(async () => undefined);

    const result = await dispatchCommand(command, {
      dataDir: "/tmp/bb-data",
      logger: silentLogger,
      eventSink: { emit: vi.fn(), flush },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      runtimeManager: manager,
      threadStorageRootPath: "/tmp/bb-thread-storage",
    });

    expect(result).toEqual({ providerCheckpointId: "pi-entry-at-stop" });
    expect(oldRuntime.stopThread).toHaveBeenCalledWith({
      threadId: "thread-1",
    });
    expect(flush).toHaveBeenCalledOnce();
  });

  it("releases an idle runtime without the active-turn wait", async () => {
    const runtime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async () => createWorkspace("/tmp/bb-release"),
    });
    await manager.ensureEnvironment({
      environmentId: "env-release",
      workspacePath: "/tmp/bb-release",
    });
    runtime.setIdle("thread-1");

    const options = {
      dataDir: "/tmp/bb-data",
      logger: silentLogger,
      eventSink: { emit: vi.fn(), flush: vi.fn(async () => undefined) },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      runtimeManager: manager,
      threadStorageRootPath: "/tmp/bb-thread-storage",
    };

    // The server already settled this thread as idle. Waiting for an active
    // turn would burn the full stop timeout on every runtime released.
    await dispatchCommand(
      {
        type: "thread.stop",
        intent: "release",
        environmentId: "env-release",
        threadId: "thread-1",
      },
      options,
    );
    expect(runtime.waitForActiveTurn).not.toHaveBeenCalled();
    expect(runtime.stopThread).toHaveBeenCalledWith({ threadId: "thread-1" });

    // An interrupt keeps the wait: the stop can race a start whose
    // turn/started event the runtime has not observed yet.
    runtime.setIdle("thread-1");
    await dispatchCommand(
      {
        type: "thread.stop",
        intent: "interrupt",
        environmentId: "env-release",
        threadId: "thread-1",
      },
      options,
    );
    expect(runtime.waitForActiveTurn).toHaveBeenCalledWith("thread-1", {
      timeoutMs: expect.any(Number),
    });
  });

  it("skips a release when a turn started after the server read the thread", async () => {
    const runtime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async () => createWorkspace("/tmp/bb-release-race"),
    });
    await manager.ensureEnvironment({
      environmentId: "env-release-race",
      workspacePath: "/tmp/bb-release-race",
    });
    // The server chose a release from an idle read. A send won the race and
    // started a turn before this command reached the daemon.
    runtime.setActiveTurn("thread-1", "turn-new");

    const result = await dispatchCommand(
      {
        type: "thread.stop",
        intent: "release",
        environmentId: "env-release-race",
        threadId: "thread-1",
      },
      {
        dataDir: "/tmp/bb-data",
        logger: silentLogger,
        eventSink: { emit: vi.fn(), flush: vi.fn(async () => undefined) },
        fetchProjectAttachment: async () => {
          throw new Error("Unexpected project attachment fetch");
        },
        runtimeManager: manager,
        threadStorageRootPath: "/tmp/bb-thread-storage",
      },
    );

    // Stopping here would end accepted work and leave the server holding an
    // active thread with no runtime.
    expect(runtime.stopThread).not.toHaveBeenCalled();
    expect(runtime.getActiveTurnId("thread-1")).toBe("turn-new");
    expect(result).toEqual({ providerCheckpointId: null });
  });

  it("treats thread.stop as successful when no runtime holds the thread", async () => {
    const manager = new RuntimeManager({
      createRuntime: () => createRuntime(),
      provisionWorkspace: async () => createWorkspace(),
    });
    const command: CommandOf<"thread.stop"> = {
      type: "thread.stop",
      intent: "interrupt",
      environmentId: "env-missing-runtime",
      threadId: "thread-1",
    };

    await expect(
      dispatchCommand(command, {
        dataDir: "/tmp/bb-data",
        logger: silentLogger,
        eventSink: { emit: vi.fn(), flush: vi.fn(async () => undefined) },
        fetchProjectAttachment: async () => {
          throw new Error("Unexpected project attachment fetch");
        },
        runtimeManager: manager,
        threadStorageRootPath: "/tmp/bb-thread-storage",
      }),
    ).resolves.toEqual({ providerCheckpointId: null });
  });

  it("cancels a plan in the environment the thread moved away from", async () => {
    const oldRuntime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => oldRuntime,
      provisionWorkspace: async () => createWorkspace("/tmp/bb-plan-old"),
    });
    await manager.ensureEnvironment({
      environmentId: "env-old",
      workspacePath: "/tmp/bb-plan-old",
    });
    oldRuntime.setActiveTurn("thread-1", "turn-old");

    const command: CommandOf<"thread.plan.cancel"> = {
      type: "thread.plan.cancel",
      environmentId: "env-new",
      threadId: "thread-1",
      expectedTurnId: "turn-old",
    };

    const result = await dispatchCommand(command, {
      dataDir: "/tmp/bb-data",
      logger: silentLogger,
      eventSink: { emit: vi.fn(), flush: vi.fn(async () => undefined) },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      runtimeManager: manager,
      threadStorageRootPath: "/tmp/bb-thread-storage",
    });

    expect(result).toEqual({ cancelled: true });
    expect(oldRuntime.stopThread).toHaveBeenCalledWith({
      threadId: "thread-1",
    });
  });

  it("leaves a plan alone when no runtime runs the expected turn", async () => {
    const oldRuntime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => oldRuntime,
      provisionWorkspace: async () => createWorkspace("/tmp/bb-plan-old"),
    });
    await manager.ensureEnvironment({
      environmentId: "env-old",
      workspacePath: "/tmp/bb-plan-old",
    });
    oldRuntime.setActiveTurn("thread-1", "turn-other");

    const command: CommandOf<"thread.plan.cancel"> = {
      type: "thread.plan.cancel",
      environmentId: "env-new",
      threadId: "thread-1",
      expectedTurnId: "turn-old",
    };

    const result = await dispatchCommand(command, {
      dataDir: "/tmp/bb-data",
      logger: silentLogger,
      eventSink: { emit: vi.fn(), flush: vi.fn(async () => undefined) },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      runtimeManager: manager,
      threadStorageRootPath: "/tmp/bb-thread-storage",
    });

    expect(result).toEqual({ cancelled: false });
    expect(oldRuntime.stopThread).not.toHaveBeenCalled();
  });

  it("keeps an old-environment turn alive through a rename", async () => {
    const oldRuntime = createRuntime();
    const newRuntime = createRuntime();
    const createRuntimeSpy = vi
      .fn<() => AgentRuntime>()
      .mockReturnValueOnce(oldRuntime)
      .mockReturnValueOnce(newRuntime);
    const manager = new RuntimeManager({
      createRuntime: createRuntimeSpy,
      provisionWorkspace: async (args) =>
        createWorkspace("path" in args ? args.path : args.targetPath),
    });
    await manager.ensureEnvironment({
      environmentId: "env-old",
      workspacePath: "/tmp/bb-rename-old",
    });
    await manager.ensureEnvironment({
      environmentId: "env-new",
      workspacePath: "/tmp/bb-rename-new",
    });
    // The switch moves the thread mid-turn, so the old runtime still runs it
    // while the thread already points at the new environment.
    oldRuntime.setActiveTurn("thread-1", "turn-old");

    const command: CommandOf<"thread.rename"> = {
      type: "thread.rename",
      environmentId: "env-new",
      threadId: "thread-1",
      title: "Renamed",
    };

    const result = await dispatchCommand(command, {
      dataDir: "/tmp/bb-data",
      logger: silentLogger,
      eventSink: { emit: vi.fn(), flush: vi.fn(async () => undefined) },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      runtimeManager: manager,
      threadStorageRootPath: "/tmp/bb-thread-storage",
    });

    expect(result).toEqual({});
    expect(oldRuntime.stopThread).not.toHaveBeenCalled();
    expect(oldRuntime.getActiveTurnId("thread-1")).toBe("turn-old");
    expect(newRuntime.renameThread).toHaveBeenCalledWith({
      threadId: "thread-1",
      title: "Renamed",
    });
  });

  it("refuses a goal clear while the old environment still runs the turn", async () => {
    const oldRuntime = createRuntime();
    const newRuntime = createRuntime();
    const createRuntimeSpy = vi
      .fn<() => AgentRuntime>()
      .mockReturnValueOnce(oldRuntime)
      .mockReturnValueOnce(newRuntime);
    const manager = new RuntimeManager({
      createRuntime: createRuntimeSpy,
      provisionWorkspace: async (args) =>
        createWorkspace("path" in args ? args.path : args.targetPath),
    });
    await manager.ensureEnvironment({
      environmentId: "env-old",
      workspacePath: "/tmp/bb-goal-old",
    });
    oldRuntime.setActiveTurn("thread-1", "turn-old");

    const command: CommandOf<"thread.goal.clear"> = {
      bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
      type: "thread.goal.clear",
      environmentId: "env-new",
      threadId: "thread-1",
      options: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        workflowsEnabled: false,
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
      resumeContext: {
        bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
        workspaceContext: {
          workspacePath: "/tmp/bb-goal-new",
          workspaceProvisionType: "unmanaged",
        },
        projectId: "proj_1",
        providerId: "codex",
        providerThreadId: "provider-thread-1",
        instructions: "Be concise.",
        dynamicTools: [],
        injectedSkillSources: [],
        instructionMode: "append",
      },
    };

    await expect(
      dispatchCommand(command, {
        dataDir: "/tmp/bb-data",
        logger: silentLogger,
        eventSink: { emit: vi.fn(), flush: vi.fn(async () => undefined) },
        fetchProjectAttachment: async () => {
          throw new Error("Unexpected project attachment fetch");
        },
        runtimeManager: manager,
        threadStorageRootPath: "/tmp/bb-thread-storage",
      }),
    ).rejects.toMatchObject({ code: "thread_busy_in_other_environment" });
    expect(oldRuntime.stopThread).not.toHaveBeenCalled();
    expect(newRuntime.clearThreadGoal).not.toHaveBeenCalled();
  });

  it("treats thread.rename as best-effort when the runtime is not loaded", async () => {
    const runtime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async () => createWorkspace(),
    });
    const command: CommandOf<"thread.rename"> = {
      type: "thread.rename",
      environmentId: "env-missing-runtime",
      threadId: "thread-1",
      title: "Renamed",
    };

    const result = await dispatchCommand(command, {
      dataDir: "/tmp/bb-data",
      logger: silentLogger,
      eventSink: {
        emit: vi.fn(),
        flush: vi.fn(async () => undefined),
      },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      runtimeManager: manager,
      threadStorageRootPath: "/tmp/bb-thread-storage",
    });

    expect(result).toEqual({});
    expect(runtime.renameThread).not.toHaveBeenCalled();
  });

  it("blocks codex thread.start when the CLI is below the minimum version", async () => {
    const runtime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async () => createWorkspace(),
    });
    const command: CommandOf<"thread.start"> = {
      bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
      type: "thread.start",
      environmentId: "env-1",
      threadId: "thread-1",
      workspaceContext: {
        workspacePath: WORKSPACE_PATH,
        workspaceProvisionType: "unmanaged",
      },
      projectId: "proj_1",
      providerId: "codex",
      requestId: "creq_unsupported_codex",
      input: [{ type: "text", text: "hello", mentions: [] }],
      options: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        workflowsEnabled: false,
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
      instructions: "Be concise.",
      dynamicTools: [],
      injectedSkillSources: [],
      instructionMode: "append",
    };

    const unsupportedCodexStatus: ProviderCliStatus = {
      displayName: "Codex",
      executableName: "codex",
      executablePath: "/usr/local/bin/codex",
      installed: true,
      installSource: "npmGlobal",
      currentVersion: "0.135.0",
      latestVersion: null,
      minimumSupportedVersion: "0.136.0",
      npmPackageName: "@openai/codex",
      npmGlobalPackageVersion: "0.135.0",
      installAction: {
        kind: "update",
        label: "Update",
        command: "codex update",
      },
      needsUpdate: false,
      versionUnsupported: true,
    };

    await expect(
      dispatchCommand(command, {
        dataDir: "/tmp/bb-data",
        logger: silentLogger,
        eventSink: {
          emit: vi.fn(),
          flush: vi.fn(async () => undefined),
        },
        fetchProjectAttachment: async () => {
          throw new Error("Unexpected project attachment fetch");
        },
        providerInstallationStatus: async () => unsupportedCodexStatus,
        runtimeManager: manager,
        threadStorageRootPath: "/tmp/bb-thread-storage",
      }),
    ).rejects.toMatchObject({
      code: "provider_cli_unsupported_version",
    });

    expect(runtime.startThread).not.toHaveBeenCalled();
  });

  it("does not check Codex CLI status for non-Codex thread.start", async () => {
    const runtime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async () => createWorkspace(),
    });
    const command: CommandOf<"thread.start"> = {
      bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
      type: "thread.start",
      environmentId: "env-1",
      threadId: "thread-1",
      workspaceContext: {
        workspacePath: WORKSPACE_PATH,
        workspaceProvisionType: "unmanaged",
      },
      projectId: "proj_1",
      providerId: "claude-code",
      requestId: "creq_non_codex",
      input: [{ type: "text", text: "hello", mentions: [] }],
      options: {
        model: "claude-sonnet-4-6",
        serviceTier: "default",
        reasoningLevel: "medium",
        workflowsEnabled: false,
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
      instructions: "Be concise.",
      dynamicTools: [],
      injectedSkillSources: [],
      instructionMode: "append",
    };
    const providerInstallationStatus = vi.fn(async () => {
      throw new Error("Codex CLI status should not be checked");
    });

    const result = await dispatchCommand(command, {
      dataDir: "/tmp/bb-data",
      logger: silentLogger,
      eventSink: {
        emit: vi.fn(),
        flush: vi.fn(async () => undefined),
      },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      providerInstallationStatus,
      runtimeManager: manager,
      threadStorageRootPath: "/tmp/bb-thread-storage",
    });

    expect(result).toEqual({ providerThreadId: "provider-thread-1" });
    expect(providerInstallationStatus).not.toHaveBeenCalled();
    expect(runtime.startThread).toHaveBeenCalledOnce();
  });

  it("prepares a Codex rewind through the requested retained turn", async () => {
    const runtime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async () => createWorkspace(),
    });
    const command: CommandOf<"thread.rewind.prepare"> = {
      bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
      type: "thread.rewind.prepare",
      environmentId: "env-1",
      threadId: "thread-1",
      workspaceContext: {
        workspacePath: WORKSPACE_PATH,
        workspaceProvisionType: "unmanaged",
      },
      projectId: "proj_1",
      providerId: "codex",
      leaseId: "lease-1",
      sourceProviderThreadId: "provider-source-1",
      retainThroughProviderCheckpoint: "turn-before-edit",
      options: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        workflowsEnabled: false,
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
      instructions: "Be concise.",
      dynamicTools: [],
      injectedSkillSources: [],
      instructionMode: "append",
    };
    const supportedCodexStatus: ProviderCliStatus = {
      displayName: "Codex",
      executableName: "codex",
      executablePath: "/usr/local/bin/codex",
      installed: true,
      installSource: "npmGlobal",
      currentVersion: "0.146.0",
      latestVersion: null,
      minimumSupportedVersion: "0.136.0",
      npmPackageName: "@openai/codex",
      npmGlobalPackageVersion: "0.146.0",
      installAction: null,
      needsUpdate: false,
      versionUnsupported: false,
    };

    await expect(
      dispatchCommand(command, {
        dataDir: "/tmp/bb-data",
        logger: silentLogger,
        eventSink: {
          emit: vi.fn(),
          flush: vi.fn(async () => undefined),
        },
        fetchProjectAttachment: async () => {
          throw new Error("Unexpected project attachment fetch");
        },
        providerInstallationStatus: async () => supportedCodexStatus,
        runtimeManager: manager,
        threadStorageRootPath: "/tmp/bb-thread-storage",
      }),
    ).resolves.toEqual({ providerThreadId: "provider-thread-rewind-1" });
    expect(runtime.prepareThreadRewind).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseId: "lease-1",
        sourceProviderThreadId: "provider-source-1",
        retainThroughProviderCheckpoint: "turn-before-edit",
        threadId: "thread-1",
      }),
    );
    await expect(
      dispatchCommand(
        { ...command, leaseId: "lease-old-codex" },
        {
          dataDir: "/tmp/bb-data",
          logger: silentLogger,
          eventSink: {
            emit: vi.fn(),
            flush: vi.fn(async () => undefined),
          },
          fetchProjectAttachment: async () => {
            throw new Error("Unexpected project attachment fetch");
          },
          providerInstallationStatus: async () => ({
            ...supportedCodexStatus,
            currentVersion: "0.140.0",
            npmGlobalPackageVersion: "0.140.0",
          }),
          runtimeManager: manager,
          threadStorageRootPath: "/tmp/bb-thread-storage",
        },
      ),
    ).rejects.toMatchObject({ code: "provider_cli_unsupported_version" });
    expect(runtime.prepareThreadRewind).toHaveBeenCalledOnce();

    await expect(
      dispatchCommand(
        {
          type: "thread.rewind.discard",
          environmentId: "env-1",
          threadId: "thread-1",
          leaseId: "lease-1",
        },
        {
          dataDir: "/tmp/bb-data",
          logger: silentLogger,
          eventSink: {
            emit: vi.fn(),
            flush: vi.fn(async () => undefined),
          },
          fetchProjectAttachment: async () => {
            throw new Error("Unexpected project attachment fetch");
          },
          runtimeManager: manager,
          threadStorageRootPath: "/tmp/bb-thread-storage",
        },
      ),
    ).resolves.toEqual({});
    expect(runtime.discardThreadRewind).toHaveBeenCalledWith({
      leaseId: "lease-1",
    });
  });

  it("invalidates the provider maintenance runtime after a verified provider update", async () => {
    const dataDir = await makeTempDir("bb-command-dispatch-provider-cli-");
    const staleRuntime = createRuntime();
    const freshRuntime = createRuntime();
    const createRuntimeSpy = vi.fn(() => staleRuntime);
    createRuntimeSpy.mockReturnValueOnce(staleRuntime);
    createRuntimeSpy.mockReturnValueOnce(freshRuntime);
    const manager = new RuntimeManager({
      createRuntime: createRuntimeSpy,
      dataDir,
      provisionWorkspace: async () => createWorkspace(),
    });
    await manager.ensureProviderMaintenanceRuntime({ dataDir });

    const events: ProviderCliInstallEvent[] = [
      {
        type: "started",
        provider: "codex",
        command: "codex update",
      },
      {
        type: "completed",
        provider: "codex",
        exitCode: 0,
        signal: null,
        success: true,
      },
    ];
    const streamProviderInstallation = vi.fn(() =>
      createProviderCliInstallEventStream(events),
    );
    const command: CommandOf<"provider.installation.run"> = {
      type: "provider.installation.run",
      bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
      providerId: "codex",
      action: "update",
    };

    const result = await dispatchOnlineRpcCommand(command, {
      dataDir,
      logger: silentLogger,
      eventSink: {
        emit: vi.fn(),
        flush: vi.fn(async () => undefined),
      },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      runtimeManager: manager,
      providerInstallationRun: async () => ({
        available: true,
        command: {
          command: "codex",
          args: ["update"],
          displayCommand: "codex update",
        },
        verification: { kind: "version_changed", previousVersion: "0.1.0" },
      }),
      providerInstallationStatus: async () => ({
        executableName: "codex",
        executablePath: "/usr/local/bin/codex",
        installed: true,
        installSource: "external",
        currentVersion: "0.2.0",
        latestVersion: "0.2.0",
        minimumSupportedVersion: null,
        npmPackageName: null,
        npmGlobalPackageVersion: null,
        installAction: null,
        needsUpdate: false,
        versionUnsupported: false,
      }),
      streamProviderInstallation,
      threadStorageRootPath: "/tmp/bb-thread-storage",
    });

    expect(result).toEqual({ events });
    expect(streamProviderInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "codex",
        plan: {
          command: "codex",
          args: ["update"],
          displayCommand: "codex update",
        },
      }),
    );
    expect(staleRuntime.shutdown).toHaveBeenCalledOnce();

    await manager.ensureProviderMaintenanceRuntime({ dataDir });
    expect(createRuntimeSpy).toHaveBeenCalledTimes(2);
    expect(freshRuntime.shutdown).not.toHaveBeenCalled();
  });

  it("keeps the provider maintenance runtime after a failed provider update", async () => {
    const cases: Array<{
      action: CommandOf<"provider.installation.run">["action"];
      events: ProviderCliInstallEvent[];
      provider: CommandOf<"provider.installation.run">["providerId"];
    }> = [
      {
        action: "update",
        provider: "codex",
        events: [
          {
            type: "completed",
            provider: "codex",
            exitCode: 1,
            signal: null,
            success: false,
          },
        ],
      },
    ];

    for (const testCase of cases) {
      const dataDir = await makeTempDir("bb-command-dispatch-provider-cli-");
      const runtime = createRuntime();
      const createRuntimeSpy = vi.fn(() => runtime);
      const manager = new RuntimeManager({
        createRuntime: createRuntimeSpy,
        dataDir,
        provisionWorkspace: async () => createWorkspace(),
      });
      await manager.ensureProviderMaintenanceRuntime({ dataDir });
      const streamProviderInstallation = vi.fn(() =>
        createProviderCliInstallEventStream(testCase.events),
      );
      const result = await dispatchOnlineRpcCommand(
        {
          type: "provider.installation.run",
          bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
          providerId: testCase.provider,
          action: testCase.action,
        },
        {
          dataDir,
          logger: silentLogger,
          eventSink: {
            emit: vi.fn(),
            flush: vi.fn(async () => undefined),
          },
          fetchProjectAttachment: async () => {
            throw new Error("Unexpected project attachment fetch");
          },
          providerInstallationRun: async () => ({
            available: true,
            command: {
              command: testCase.provider,
              args: [testCase.action],
              displayCommand: `${testCase.provider} ${testCase.action}`,
            },
            verification: {
              kind: "version_changed",
              previousVersion: "2.1.220",
            },
          }),
          runtimeManager: manager,
          streamProviderInstallation,
          threadStorageRootPath: "/tmp/bb-thread-storage",
        },
      );

      expect(result).toEqual({ events: testCase.events });
      expect(runtime.shutdown).not.toHaveBeenCalled();
      await expect(
        manager.ensureProviderMaintenanceRuntime({ dataDir }),
      ).resolves.toBe(runtime);
      expect(createRuntimeSpy).toHaveBeenCalledTimes(1);
    }
  });

  it("reports a successful Claude update command as failed when the active executable stays old", async () => {
    const dataDir = await makeTempDir("bb-command-dispatch-provider-cli-");
    const runtime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      dataDir,
      provisionWorkspace: async () => createWorkspace(),
    });
    const providerInstallationStatus = vi.fn().mockResolvedValueOnce(
      claudeCodeStatus({
        currentVersion: "2.1.220",
        latestVersion: "2.1.227",
      }),
    );

    const result = await dispatchOnlineRpcCommand(
      {
        type: "provider.installation.run",
        bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
        providerId: "claude-code",
        action: "update",
      },
      {
        dataDir,
        logger: silentLogger,
        eventSink: {
          emit: vi.fn(),
          flush: vi.fn(async () => undefined),
        },
        fetchProjectAttachment: async () => {
          throw new Error("Unexpected project attachment fetch");
        },
        providerInstallationStatus,
        providerInstallationRun: async () => ({
          available: true,
          command: {
            command: "claude",
            args: ["update"],
            displayCommand: "claude update",
          },
          verification: { kind: "version_at_least", version: "2.1.227" },
        }),
        runtimeManager: manager,
        streamProviderInstallation: () =>
          createProviderCliInstallEventStream([
            {
              type: "started",
              provider: "claude-code",
              command: "claude update",
            },
            {
              type: "output",
              provider: "claude-code",
              stream: "stdout",
              text: "Successfully updated from 2.1.220 to version 2.1.227\n",
            },
            {
              type: "completed",
              provider: "claude-code",
              exitCode: 0,
              signal: null,
              success: true,
            },
          ]),
        threadStorageRootPath: "/tmp/bb-thread-storage",
      },
    );

    expect(providerInstallationStatus).toHaveBeenCalledOnce();
    expect(result.events).toEqual([
      expect.objectContaining({ type: "started" }),
      expect.objectContaining({ type: "output" }),
      expect.objectContaining({
        type: "error",
        provider: "claude-code",
        message: expect.stringContaining(
          "could not verify the installed result",
        ),
      }),
      {
        type: "completed",
        provider: "claude-code",
        exitCode: 0,
        signal: null,
        success: false,
      },
    ]);
  });

  it("does not spawn when the provider withdraws a stale installation action", async () => {
    const dataDir = await makeTempDir("bb-command-dispatch-provider-cli-");
    const manager = new RuntimeManager({
      createRuntime,
      dataDir,
      provisionWorkspace: async () => createWorkspace(),
    });
    const providerInstallationStatus = vi.fn();
    const streamProviderInstallation = vi.fn();

    const result = await dispatchOnlineRpcCommand(
      {
        type: "provider.installation.run",
        bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
        providerId: "claude-code",
        action: "update",
      },
      {
        dataDir,
        logger: silentLogger,
        eventSink: {
          emit: vi.fn(),
          flush: vi.fn(async () => undefined),
        },
        fetchProjectAttachment: async () => {
          throw new Error("Unexpected project attachment fetch");
        },
        providerInstallationStatus,
        providerInstallationRun: async () => ({
          available: false,
          message: "Claude Code update is no longer available on this host.",
        }),
        runtimeManager: manager,
        streamProviderInstallation,
        threadStorageRootPath: "/tmp/bb-thread-storage",
      },
    );

    expect(providerInstallationStatus).not.toHaveBeenCalled();
    expect(streamProviderInstallation).not.toHaveBeenCalled();
    expect(result.events).toEqual([
      {
        type: "error",
        provider: "claude-code",
        message: "Claude Code update is no longer available on this host.",
      },
    ]);
  });

  it("accepts a Claude update that advances when the release channel is unknown", async () => {
    const verification = await runSuccessfulClaudeCodeUpdateVerification({
      before: claudeCodeStatus({
        currentVersion: "2.1.69",
        latestVersion: null,
      }),
      after: claudeCodeStatus({
        currentVersion: "2.1.221",
        latestVersion: null,
      }),
    });

    expect(verification.providerInstallationStatus).toHaveBeenCalledOnce();
    expect(verification.result).toEqual({ events: verification.events });
  });

  it("rejects a Claude update that does not advance when the release channel is unknown", async () => {
    const verification = await runSuccessfulClaudeCodeUpdateVerification({
      before: claudeCodeStatus({
        currentVersion: "2.1.69",
        latestVersion: null,
      }),
      after: claudeCodeStatus({
        currentVersion: "2.1.69",
        latestVersion: null,
      }),
    });

    expect(verification.result.events).toEqual([
      expect.objectContaining({ type: "started" }),
      expect.objectContaining({
        type: "error",
        provider: "claude-code",
        message: expect.stringContaining(
          "could not verify the installed result",
        ),
      }),
      {
        type: "completed",
        provider: "claude-code",
        exitCode: 0,
        signal: null,
        success: false,
      },
    ]);
  });

  // Regression: a thread.start whose freshly staged skill catalog differed
  // from the busy runtime's catalog used to fail the command (and brick the
  // thread) instead of reusing the runtime. This drives the real plumbing —
  // the handler's targetThreadId carried through workspace resolution into
  // RuntimeManager.ensureEnvironment.
  it("reuses a busy runtime when thread.start carries a changed skill catalog", async () => {
    const fixture = await setupBusySkillCatalogEnvironment({
      activeThreadId: "sibling-thread",
    });
    const command: CommandOf<"thread.start"> = {
      bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
      type: "thread.start",
      environmentId: "env-1",
      threadId: "thread-1",
      workspaceContext: {
        workspacePath: WORKSPACE_PATH,
        workspaceProvisionType: "unmanaged",
      },
      projectId: "proj_1",
      providerId: "codex",
      requestId: "creq_2345678923",
      input: [{ type: "text", text: "hello", mentions: [] }],
      options: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        workflowsEnabled: false,
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
      instructions: "Be concise.",
      dynamicTools: [],
      injectedSkillSources: [fixture.source],
      instructionMode: "append",
    };

    const result = await dispatchCommand(command, {
      dataDir: fixture.dataDir,
      logger: silentLogger,
      eventSink: {
        emit: vi.fn(),
        flush: vi.fn(async () => undefined),
      },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      providerInstallationStatus: async () =>
        supportedCodexInstallationStatus(),
      runtimeManager: fixture.manager,
      threadStorageRootPath: "/tmp/bb-thread-storage",
    });

    expect(result.providerThreadId).toBe("provider-thread-1");
    expect(fixture.runtime.startThread).toHaveBeenCalledTimes(1);
    expect(fixture.createRuntimeSpy).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.shutdown).not.toHaveBeenCalled();
    // The stale catalog stays bound; the refresh is deferred until idle.
    expect(fixture.manager.get("env-1")?.skillCatalogHash).toBe(
      fixture.originalCatalogHash,
    );
  });

  // Regression: the self-brick case — an agent installs a skill mid-turn, so
  // the next turn.submit for its own (active) thread stages a different
  // catalog hash. The command must reuse the busy runtime instead of failing
  // and dropping the message.
  it("reuses a busy runtime when turn.submit carries a changed skill catalog", async () => {
    const fixture = await setupBusySkillCatalogEnvironment({
      activeThreadId: "thread-1",
    });
    const command: CommandOf<"turn.submit"> = {
      bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
      type: "turn.submit",
      environmentId: "env-1",
      threadId: "thread-1",
      requestId: "creq_2345678923",
      input: [{ type: "text", text: "follow up", mentions: [] }],
      options: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        workflowsEnabled: false,
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
      resumeContext: {
        bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
        workspaceContext: {
          workspacePath: WORKSPACE_PATH,
          workspaceProvisionType: "unmanaged",
        },
        projectId: "proj_1",
        providerId: "codex",
        providerThreadId: "provider-thread-1",
        instructions: "Be concise.",
        dynamicTools: [],
        injectedSkillSources: [fixture.source],
        instructionMode: "append",
      },
      target: { mode: "start" },
    };

    const result = await dispatchCommand(command, {
      dataDir: fixture.dataDir,
      logger: silentLogger,
      eventSink: {
        emit: vi.fn(),
        flush: vi.fn(async () => undefined),
      },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      runtimeManager: fixture.manager,
      threadStorageRootPath: "/tmp/bb-thread-storage",
    });

    expect(result).toEqual({ appliedAs: "new-turn" });
    expect(fixture.runtime.runTurn).toHaveBeenCalledTimes(1);
    // The runtime already hosts the thread, so no resume round-trip happens.
    expect(fixture.runtime.resumeThread).not.toHaveBeenCalled();
    expect(fixture.createRuntimeSpy).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.shutdown).not.toHaveBeenCalled();
    // The stale catalog stays bound; the refresh is deferred until idle.
    expect(fixture.manager.get("env-1")?.skillCatalogHash).toBe(
      fixture.originalCatalogHash,
    );
  });

  it("detects known ACP agents on the resolved user shell PATH, not the daemon's process PATH", async () => {
    // Regression: known_acp_agents.status must query `which` with the user's
    // resolved login-shell PATH (like provider.installation.status), otherwise ACP CLIs
    // installed only on the login PATH — e.g. Hermes' `hermes` under
    // ~/.local/bin — are invisible to a daemon launched by launchd/systemd with
    // a stripped PATH.
    const binDir = await makeTempDir("bb-acp-shell-path-");
    const executableName = `bb-acp-probe-${process.pid}`;
    const executablePath = path.join(binDir, executableName);
    await fs.writeFile(executablePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const runtime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async () => createWorkspace(),
    });
    // The probe executable exists ONLY on the shell PATH the manager reports,
    // never on process.env.PATH, so a detection that ignores the shell env
    // fails to find it. System bin dirs stay on PATH so `which` itself resolves;
    // only binDir (the stand-in for ~/.local/bin) is exclusive to the shell env.
    manager.replaceManagedShellEnv({ PATH: `${binDir}:/usr/bin:/bin` });

    const result = await dispatchOnlineRpcCommand(
      {
        type: "known_acp_agents.status",
        agents: [{ id: "acp-probe", executableName }],
      },
      {
        dataDir: "/tmp/bb-data",
        logger: silentLogger,
        eventSink: { emit: vi.fn(), flush: vi.fn(async () => undefined) },
        fetchProjectAttachment: async () => {
          throw new Error("Unexpected project attachment fetch");
        },
        runtimeManager: manager,
        threadStorageRootPath: "/tmp/bb-thread-storage",
      },
    );

    expect(result).toEqual({
      agents: [
        {
          id: "acp-probe",
          executableName,
          installed: true,
          executablePath,
        },
      ],
    });
  });

  it("routes provider health and usage to the targeted bridge runtime", async () => {
    const runtime = createRuntime();
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async () => createWorkspace(),
    });
    const providerHealth = vi.fn(async () => ({ supported: false as const }));
    const providerUsage = vi.fn(async () => ({ supported: false as const }));
    const options = {
      dataDir: "/tmp/bb-test-data",
      logger: silentLogger,
      eventSink: { emit: vi.fn(), flush: vi.fn(async () => undefined) },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      providerHealth,
      providerUsage,
      runtimeManager: manager,
      threadStorageRootPath: "/tmp/bb-thread-storage",
    };

    await expect(
      dispatchOnlineRpcCommand(
        {
          type: "provider.health",
          providerId: "pi",
          bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
          cwd: "/tmp/workspace",
        },
        options,
      ),
    ).resolves.toEqual({ supported: false });
    await expect(
      dispatchOnlineRpcCommand(
        {
          type: "provider.usage",
          providerId: "pi",
          bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
        },
        options,
      ),
    ).resolves.toEqual({ supported: false });

    expect(providerHealth).toHaveBeenCalledWith({
      providerId: "pi",
      cwd: "/tmp/workspace",
      bridgeLaunch: DISPATCH_TEST_RUNTIME_BRIDGE_LAUNCH,
    });
    expect(providerUsage).toHaveBeenCalledWith({
      providerId: "pi",
      bridgeLaunch: DISPATCH_TEST_RUNTIME_BRIDGE_LAUNCH,
    });
  });
});
