import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentRuntime } from "@bb/agent-runtime";
import type { HostDaemonInjectedSkillSource } from "@bb/host-daemon-contract";
import type { HostWorkspace } from "@bb/host-workspace";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { dispatchCommand } from "./command-dispatch.js";
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
    sourceType: "data-dir",
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

function createWorkspace(): HostWorkspace {
  return {
    path: WORKSPACE_PATH,
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
    resumeThread: vi.fn(async (args: { threadId: string }) => {
      hostedThreadIds.add(args.threadId);
      return { providerThreadId: "provider-thread-1" };
    }),
    runTurn: vi.fn(async () => undefined),
    steerTurn: vi.fn(async () => ({ status: "steered" as const })),
    stopThread: vi.fn(async (args: { threadId: string }) => {
      activeTurnsByThreadId.delete(args.threadId);
      hostedThreadIds.delete(args.threadId);
    }),
    renameThread: vi.fn(async () => undefined),
    archiveThread: vi.fn(async () => undefined),
    unarchiveThread: vi.fn(async () => undefined),
    listModels: vi.fn(async () => ({
      models: [],
      selectedOnlyModels: [],
    })),
    listRunningProviders: vi.fn(() => ["fake"]),
    getActiveTurnId: (threadId) => activeTurnsByThreadId.get(threadId) ?? null,
    waitForActiveTurn: async (threadId) =>
      activeTurnsByThreadId.get(threadId) ?? null,
    getProviderSession: (threadId) =>
      hostedThreadIds.has(threadId)
        ? { providerId: "fake", providerThreadId: "provider-thread-1" }
        : null,
    reapIdleProviderSessions: vi.fn(async () => ({ reapedSessions: [] })),
    hasThread: (threadId) => hostedThreadIds.has(threadId),
    getActiveThreadIds: () => [...activeTurnsByThreadId.keys()],
    shutdown: vi.fn(async () => undefined),
    setActiveTurn: (threadId, turnId) => {
      hostedThreadIds.add(threadId);
      activeTurnsByThreadId.set(threadId, turnId);
    },
  };
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
      environmentId: "env-1",
      threadId: "thread-1",
    };
    let resolved = false;
    const dispatchPromise = dispatchCommand(command, {
      dataDir: "/tmp/bb-data",
      eventSink: {
        emit: vi.fn(),
        flush,
      },
      fetchProjectAttachment: async () => {
        throw new Error("Unexpected project attachment fetch");
      },
      runtimeManager: manager,
      threadStorageRootPath: "/tmp/bb-thread-storage",
    }).then(() => {
      resolved = true;
    });

    await vi.waitFor(() => {
      expect(runtime.stopThread).toHaveBeenCalledWith({ threadId: "thread-1" });
      expect(flush).toHaveBeenCalledTimes(1);
    });
    expect(resolved).toBe(false);

    flushDeferred.resolve(undefined);
    await dispatchPromise;

    expect(resolved).toBe(true);
    expect(runtime.hasThread("thread-1")).toBe(false);
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
        permissionEscalation: null,
      },
      instructions: "Be concise.",
      dynamicTools: [],
      injectedSkillSources: [fixture.source],
      instructionMode: "append",
    };

    const result = await dispatchCommand(command, {
      dataDir: fixture.dataDir,
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
        permissionEscalation: null,
      },
      resumeContext: {
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
});
