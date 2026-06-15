import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentRuntime, AgentRuntimeOptions } from "@bb/agent-runtime";
import type { ThreadEvent } from "@bb/domain";
import { turnScope } from "@bb/domain";
import type { HostDaemonInjectedSkillSource } from "@bb/host-daemon-contract";
import type { HostWatcher } from "@bb/host-watcher";
import {
  provisionWorkspace,
  type HostWorkspace,
  type ProvisionWorkspaceArgs,
} from "@bb/host-workspace";
import { makeWorkspaceMergeBase, makeWorkspaceStatus } from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RuntimeManager,
  SkillCatalogConflictError,
} from "./runtime-manager.js";

type GetCurrentBranchArgs = Parameters<HostWorkspace["getCurrentBranch"]>;
type GetStatusResult = Awaited<ReturnType<HostWorkspace["getStatus"]>>;
type GetDiffResult = Awaited<ReturnType<HostWorkspace["getDiff"]>>;
type GetLocalStateFingerprintResult = Awaited<
  ReturnType<HostWorkspace["getLocalStateFingerprint"]>
>;
type GetSharedGitRefsFingerprintResult = Awaited<
  ReturnType<HostWorkspace["getSharedGitRefsFingerprint"]>
>;
type CommitArgs = Parameters<HostWorkspace["commit"]>;
type FetchArgs = Parameters<HostWorkspace["fetch"]>;
type SquashMergeArgs = Parameters<HostWorkspace["squashMerge"]>;
type ProvisionWorkspaceMockArgs = Parameters<
  (options: ProvisionWorkspaceArgs) => Promise<HostWorkspace>
>;
type EnsureProviderArgs = Parameters<AgentRuntime["ensureProvider"]>[0];
type StartThreadArgs = Parameters<AgentRuntime["startThread"]>[0];
type ResumeThreadArgs = Parameters<AgentRuntime["resumeThread"]>[0];
type RunTurnArgs = Parameters<AgentRuntime["runTurn"]>[0];
type SteerTurnArgs = Parameters<AgentRuntime["steerTurn"]>[0];
type StopThreadArgs = Parameters<AgentRuntime["stopThread"]>[0];
type RenameThreadArgs = Parameters<AgentRuntime["renameThread"]>[0];
type ListModelsArgs = Parameters<AgentRuntime["listModels"]>[0];
interface RunGitOptions {
  cwd: string;
}

interface WriteInjectedSkillSourceArgs {
  dataDir: string;
  name: string;
  token: string;
}

interface RuntimeOptionsRef {
  current: AgentRuntimeOptions | null;
}

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function runGit(
  args: readonly string[],
  options: RunGitOptions,
): Promise<string> {
  const result = await execFileAsync("git", [...args], {
    cwd: options.cwd,
  });
  return result.stdout;
}

async function initRepo(): Promise<string> {
  const repoPath = await makeTempDir("bb-runtime-manager-repo-");
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await runGit(["add", "."], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
  return repoPath;
}

async function writeInjectedSkillSource(
  args: WriteInjectedSkillSourceArgs,
): Promise<HostDaemonInjectedSkillSource> {
  const sourceRootPath = path.join(args.dataDir, "skills", args.name);
  await fs.mkdir(sourceRootPath, { recursive: true });
  await fs.writeFile(
    path.join(sourceRootPath, "SKILL.md"),
    [
      "---",
      `name: ${args.name}`,
      `description: Use ${args.name} when runtime manager tests run.`,
      "---",
      "",
      args.token,
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    sourceType: "data-dir",
    name: args.name,
    description: `Use ${args.name} when runtime manager tests run.`,
    sourceRootPath,
    skillFilePath: path.join(sourceRootPath, "SKILL.md"),
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return {
    promise,
    reject,
    resolve,
  };
}

function getProvisionWorkspacePath(args: ProvisionWorkspaceArgs): string {
  switch (args.workspaceProvisionType) {
    case "managed-worktree":
    case "personal":
      return args.targetPath;
    case "reconnect-managed-worktree":
    case "unmanaged":
      return args.path;
  }
}

function createFakeWorkspace(path: string) {
  const status: GetStatusResult = makeWorkspaceStatus({
    mergeBase: makeWorkspaceMergeBase(),
  });
  const diff: GetDiffResult = {
    diff: "",
    truncated: false,
    shortstat: "",
    files: "",
    mergeBaseRef: null,
  };
  let localStateFingerprint: GetLocalStateFingerprintResult = `local:${path}:initial`;
  let localStateFingerprintError: Error | null = null;
  let sharedGitRefsFingerprint: GetSharedGitRefsFingerprintResult = `refs:${path}:initial`;
  let sharedGitRefsFingerprintError: Error | null = null;
  const workspace = {
    path,
    managed: false,
    isGitRepo: true,
    isWorktree: false,
    getCurrentBranch: vi.fn(async (..._args: GetCurrentBranchArgs) => "main"),
    getHeadSha: vi.fn(async () => "commit-1"),
    getLocalStateFingerprint: vi.fn(async () => {
      if (localStateFingerprintError) {
        throw localStateFingerprintError;
      }
      return localStateFingerprint;
    }),
    getSharedGitRefsFingerprint: vi.fn(async () => {
      if (sharedGitRefsFingerprintError) {
        throw sharedGitRefsFingerprintError;
      }
      return sharedGitRefsFingerprint;
    }),
    getAdditionalWorkspaceWriteRoots: vi.fn(async () => []),
    getStatus: vi.fn(async () => status),
    getDiff: vi.fn(async () => diff),
    diffFiles: vi.fn(async () => ({
      files: [],
      shortstat: "",
      mergeBaseRef: null,
    })),
    diffPatch: vi.fn(async () => []),
    getPullRequest: vi.fn(async () => null),
    listBranches: vi.fn(async () => ["main"]),
    listFiles: vi.fn(async () => []),
    commit: vi.fn(async (..._args: CommitArgs) => ({
      commitSha: "commit-1",
      commitSubject: "commit",
    })),
    reset: vi.fn(async () => undefined),
    fetch: vi.fn(async (..._args: FetchArgs) => undefined),
    squashMerge: vi.fn(async (..._args: SquashMergeArgs) => ({
      merged: true,
      commitSha: "commit-1",
      commitSubject: "commit",
      targetBranch: "main",
    })),
    setLocalStateFingerprint(value: GetLocalStateFingerprintResult) {
      localStateFingerprint = value;
    },
    setLocalStateFingerprintError(value: Error | null) {
      localStateFingerprintError = value;
    },
    setSharedGitRefsFingerprint(value: GetSharedGitRefsFingerprintResult) {
      sharedGitRefsFingerprint = value;
    },
    setSharedGitRefsFingerprintError(value: Error | null) {
      sharedGitRefsFingerprintError = value;
    },
    destroy: vi.fn(async () => undefined),
  } satisfies HostWorkspace & {
    setLocalStateFingerprint: (value: GetLocalStateFingerprintResult) => void;
    setLocalStateFingerprintError: (value: Error | null) => void;
    setSharedGitRefsFingerprint: (
      value: GetSharedGitRefsFingerprintResult,
    ) => void;
    setSharedGitRefsFingerprintError: (value: Error | null) => void;
  };

  return workspace;
}

interface FakeAgentRuntime extends AgentRuntime {
  /** Test-only mutators for the runtime-owned per-thread turn state. */
  endActiveTurn: (threadId: string) => void;
  setActiveTurn: (threadId: string, turnId: string) => void;
}

function createFakeRuntime() {
  const activeTurnsByThreadId = new Map<string, string>();
  return {
    ensureProvider: vi.fn(async (_args: EnsureProviderArgs) => undefined),
    startThread: vi.fn(async (_args: StartThreadArgs) => ({
      providerThreadId: "provider-1",
    })),
    resumeThread: vi.fn(async (_args: ResumeThreadArgs) => ({
      providerThreadId: "provider-1",
    })),
    runTurn: vi.fn(async (_args: RunTurnArgs) => undefined),
    steerTurn: vi.fn(async (_args: SteerTurnArgs) => ({
      status: "steered" as const,
    })),
    stopThread: vi.fn(async (_args: StopThreadArgs) => undefined),
    renameThread: vi.fn(async (_args: RenameThreadArgs) => undefined),
    archiveThread: vi.fn(async () => undefined),
    unarchiveThread: vi.fn(async () => undefined),
    listModels: vi.fn(async (_args: ListModelsArgs) => ({
      models: [],
      selectedOnlyModels: [],
    })),
    listRunningProviders: vi.fn((): string[] => []),
    getActiveTurnId: (threadId) => activeTurnsByThreadId.get(threadId) ?? null,
    waitForActiveTurn: async (threadId) =>
      activeTurnsByThreadId.get(threadId) ?? null,
    getProviderSession: () => null,
    reapIdleProviderSessions: vi.fn<AgentRuntime["reapIdleProviderSessions"]>(
      async () => ({ reapedSessions: [] }),
    ),
    hasThread: (threadId) => activeTurnsByThreadId.has(threadId),
    getActiveThreadIds: () => [...activeTurnsByThreadId.keys()],
    shutdown: vi.fn(async () => undefined),
    endActiveTurn: (threadId) => {
      activeTurnsByThreadId.delete(threadId);
    },
    setActiveTurn: (threadId, turnId) => {
      activeTurnsByThreadId.set(threadId, turnId);
    },
  } satisfies FakeAgentRuntime;
}

function createProvisionWorkspaceMock(path: string) {
  return vi.fn(async (..._args: ProvisionWorkspaceMockArgs) =>
    createFakeWorkspace(path),
  );
}

describe("RuntimeManager", () => {
  it("creates a runtime the first time an environment is requested", async () => {
    const provisionWorkspace = createProvisionWorkspaceMock("/tmp/env-1");
    const createRuntime = vi.fn(() => createFakeRuntime());
    const manager = new RuntimeManager({
      provisionWorkspace,
      createRuntime,
    });

    const entry = await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    expect(provisionWorkspace).toHaveBeenCalledTimes(1);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(entry.path).toBe("/tmp/env-1");
  });

  it("reaps idle provider sessions from loaded runtimes", async () => {
    const firstRuntime = createFakeRuntime();
    const secondRuntime = createFakeRuntime();
    firstRuntime.reapIdleProviderSessions.mockResolvedValue({
      reapedSessions: [
        {
          idleForMs: 1_500,
          providerId: "codex",
          providerThreadId: "provider-thread-1",
          threadId: "thread-1",
        },
      ],
    });
    secondRuntime.reapIdleProviderSessions.mockResolvedValue({
      reapedSessions: [
        {
          idleForMs: 2_500,
          providerId: "codex",
          providerThreadId: "provider-thread-2",
          threadId: "thread-2",
        },
      ],
    });
    const runtimes = [firstRuntime, secondRuntime];
    const createRuntime = vi.fn(() => {
      const runtime = runtimes.shift();
      if (!runtime) {
        throw new Error("Unexpected runtime creation");
      }
      return runtime;
    });
    const manager = new RuntimeManager({
      provisionWorkspace: createProvisionWorkspaceMock("/tmp/env-1"),
      createRuntime,
    });

    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    await manager.ensureEnvironment({
      environmentId: "env-2",
      workspacePath: "/tmp/env-2",
    });

    await expect(
      manager.reapIdleProviderSessions({ idleForMs: 1_000, nowMs: 5_000 }),
    ).resolves.toEqual({
      reapedSessions: [
        {
          environmentId: "env-1",
          idleForMs: 1_500,
          providerId: "codex",
          providerThreadId: "provider-thread-1",
          threadId: "thread-1",
        },
        {
          environmentId: "env-2",
          idleForMs: 2_500,
          providerId: "codex",
          providerThreadId: "provider-thread-2",
          threadId: "thread-2",
        },
      ],
    });
    expect(firstRuntime.reapIdleProviderSessions).toHaveBeenCalledWith({
      idleForMs: 1_000,
      nowMs: 5_000,
    });
    expect(secondRuntime.reapIdleProviderSessions).toHaveBeenCalledWith({
      idleForMs: 1_000,
      nowMs: 5_000,
    });
  });

  it("passes staged injected skill roots to created runtimes", async () => {
    const dataDir = await makeTempDir("bb-runtime-manager-skills-");
    const source = await writeInjectedSkillSource({
      dataDir,
      name: "release-notes",
      token: "first-token",
    });
    const provisionWorkspace = createProvisionWorkspaceMock("/tmp/env-1");
    const runtimeOptions: RuntimeOptionsRef = { current: null };
    const manager = new RuntimeManager({
      dataDir,
      provisionWorkspace,
      createRuntime: (options) => {
        runtimeOptions.current = options;
        return createFakeRuntime();
      },
    });

    const entry = await manager.ensureEnvironment({
      environmentId: "env-skills",
      injectedSkillSources: [source],
      workspacePath: "/tmp/env-1",
    });

    expect(entry.skillCatalogHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(runtimeOptions.current?.skillRoots).toEqual([
      {
        id: `global-skills:${entry.skillCatalogHash}:codex`,
        providerId: "codex",
        skillDirectoryRootPath: path.join(
          dataDir,
          "runtime",
          "global-skills",
          entry.skillCatalogHash ?? "",
          "skills",
        ),
      },
      {
        id: `global-skills:${entry.skillCatalogHash}:claude-code`,
        providerId: "claude-code",
        localPluginPath: path.join(
          dataDir,
          "runtime",
          "global-skills",
          entry.skillCatalogHash ?? "",
        ),
      },
    ]);
  });

  it("does not reuse an idle runtime with a stale skill catalog hash", async () => {
    const dataDir = await makeTempDir("bb-runtime-manager-skills-stale-");
    const source = await writeInjectedSkillSource({
      dataDir,
      name: "release-notes",
      token: "first-token",
    });
    const provisionWorkspace = createProvisionWorkspaceMock("/tmp/env-1");
    const runtimes = [createFakeRuntime(), createFakeRuntime()];
    const createRuntime = vi.fn(() => {
      const runtime = runtimes.shift();
      if (!runtime) {
        throw new Error("Unexpected runtime creation");
      }
      return runtime;
    });
    const manager = new RuntimeManager({
      dataDir,
      provisionWorkspace,
      createRuntime,
    });

    const firstEntry = await manager.ensureEnvironment({
      environmentId: "env-skills",
      injectedSkillSources: [source],
      workspacePath: "/tmp/env-1",
    });
    await fs.writeFile(
      source.skillFilePath,
      [
        "---",
        "name: release-notes",
        "description: Use release-notes when runtime manager tests run.",
        "---",
        "",
        "second-token",
        "",
      ].join("\n"),
      "utf8",
    );
    const secondEntry = await manager.ensureEnvironment({
      environmentId: "env-skills",
      injectedSkillSources: [source],
      workspacePath: "/tmp/env-1",
    });

    expect(secondEntry).not.toBe(firstEntry);
    expect(secondEntry.skillCatalogHash).not.toBe(firstEntry.skillCatalogHash);
    expect(createRuntime).toHaveBeenCalledTimes(2);
    expect(firstEntry.runtime.shutdown).toHaveBeenCalledTimes(1);
  });

  it("reuses a busy runtime with a stale skill catalog and refreshes it once idle", async () => {
    const dataDir = await makeTempDir("bb-runtime-manager-skills-defer-");
    const source = await writeInjectedSkillSource({
      dataDir,
      name: "release-notes",
      token: "first-token",
    });
    const provisionWorkspace = createProvisionWorkspaceMock("/tmp/env-1");
    const runtimes: ReturnType<typeof createFakeRuntime>[] = [];
    const createRuntime = vi.fn(() => {
      const runtime = createFakeRuntime();
      runtimes.push(runtime);
      return runtime;
    });
    const manager = new RuntimeManager({
      dataDir,
      provisionWorkspace,
      createRuntime,
    });

    const firstEntry = await manager.ensureEnvironment({
      environmentId: "env-skills",
      injectedSkillSources: [source],
      workspacePath: "/tmp/env-1",
    });
    const firstCatalogHash = firstEntry.skillCatalogHash;
    runtimes[0]?.setActiveTurn("thread-1", "turn-1");
    await writeInjectedSkillSource({
      dataDir,
      name: "release-notes",
      token: "second-token",
    });

    const busyEntry = await manager.ensureEnvironment({
      environmentId: "env-skills",
      injectedSkillSources: [source],
      targetThreadId: "thread-1",
      workspacePath: "/tmp/env-1",
    });

    expect(busyEntry).toBe(firstEntry);
    expect(busyEntry.skillCatalogHash).toBe(firstCatalogHash);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(firstEntry.runtime.shutdown).not.toHaveBeenCalled();

    runtimes[0]?.endActiveTurn("thread-1");
    const idleEntry = await manager.ensureEnvironment({
      environmentId: "env-skills",
      injectedSkillSources: [source],
      targetThreadId: "thread-1",
      workspacePath: "/tmp/env-1",
    });

    expect(idleEntry).not.toBe(firstEntry);
    expect(idleEntry.skillCatalogHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(idleEntry.skillCatalogHash).not.toBe(firstCatalogHash);
    expect(createRuntime).toHaveBeenCalledTimes(2);
    expect(firstEntry.runtime.shutdown).toHaveBeenCalledTimes(1);
  });

  it("replaces an idle runtime that hosts the target thread and keeps the new staged catalog", async () => {
    const dataDir = await makeTempDir("bb-runtime-manager-skills-idle-host-");
    const source = await writeInjectedSkillSource({
      dataDir,
      name: "release-notes",
      token: "first-token",
    });
    const provisionWorkspace = createProvisionWorkspaceMock("/tmp/env-1");
    const createRuntime = vi.fn(() => createFakeRuntime());
    const manager = new RuntimeManager({
      dataDir,
      provisionWorkspace,
      createRuntime,
    });

    const firstEntry = await manager.ensureEnvironment({
      environmentId: "env-skills",
      injectedSkillSources: [source],
      workspacePath: "/tmp/env-1",
    });
    await writeInjectedSkillSource({
      dataDir,
      name: "release-notes",
      token: "second-token",
    });

    const secondEntry = await manager.ensureEnvironment({
      environmentId: "env-skills",
      injectedSkillSources: [source],
      targetThreadId: "thread-1",
      workspacePath: "/tmp/env-1",
    });

    expect(secondEntry).not.toBe(firstEntry);
    expect(firstEntry.skillCatalogHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(secondEntry.skillCatalogHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(secondEntry.skillCatalogHash).not.toBe(firstEntry.skillCatalogHash);
    expect(createRuntime).toHaveBeenCalledTimes(2);
    expect(firstEntry.runtime.shutdown).toHaveBeenCalledTimes(1);

    // The replacement's staging cleanup must keep the about-to-be-active
    // catalog (the new runtime's skill roots point into it) and drop the
    // replaced one. The hash-shape assertions above keep the `?? ""` fallback
    // from silently pointing these stats at the staging root itself.
    const stagingRoot = path.join(dataDir, "runtime", "global-skills");
    const newCatalogStat = await fs.stat(
      path.join(stagingRoot, secondEntry.skillCatalogHash ?? ""),
    );
    expect(newCatalogStat.isDirectory()).toBe(true);
    await expect(
      fs.stat(path.join(stagingRoot, firstEntry.skillCatalogHash ?? "")),
    ).rejects.toThrow();
  });

  it("reuses a busy runtime for a target thread it does not host yet", async () => {
    const dataDir = await makeTempDir("bb-runtime-manager-skills-unhosted-");
    const source = await writeInjectedSkillSource({
      dataDir,
      name: "release-notes",
      token: "first-token",
    });
    const provisionWorkspace = createProvisionWorkspaceMock("/tmp/env-1");
    const runtime = createFakeRuntime();
    const createRuntime = vi.fn(() => runtime);
    const manager = new RuntimeManager({
      dataDir,
      provisionWorkspace,
      createRuntime,
    });

    const firstEntry = await manager.ensureEnvironment({
      environmentId: "env-skills",
      injectedSkillSources: [source],
      workspacePath: "/tmp/env-1",
    });
    runtime.setActiveTurn("other-thread", "turn-1");
    await writeInjectedSkillSource({
      dataDir,
      name: "release-notes",
      token: "second-token",
    });

    const secondEntry = await manager.ensureEnvironment({
      environmentId: "env-skills",
      injectedSkillSources: [source],
      targetThreadId: "thread-1",
      workspacePath: "/tmp/env-1",
    });

    expect(secondEntry).toBe(firstEntry);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(firstEntry.runtime.shutdown).not.toHaveBeenCalled();
  });

  it("reuses a runtime pinned busy by a terminal when a thread brings skill sources", async () => {
    const dataDir = await makeTempDir("bb-runtime-manager-skills-terminal-");
    const source = await writeInjectedSkillSource({
      dataDir,
      name: "release-notes",
      token: "first-token",
    });
    const provisionWorkspace = createProvisionWorkspaceMock("/tmp/env-1");
    const createRuntime = vi.fn(() => createFakeRuntime());
    const manager = new RuntimeManager({
      dataDir,
      provisionWorkspace,
      createRuntime,
    });

    // Terminal-first entry: created without skill sources, so the runtime has
    // no catalog (hash null) and the open terminal keeps it busy.
    const terminalEntry = await manager.ensureEnvironment({
      environmentId: "env-skills",
      workspacePath: "/tmp/env-1",
    });
    manager.markTerminalActive("env-skills", "terminal-1");

    const threadEntry = await manager.ensureEnvironment({
      environmentId: "env-skills",
      injectedSkillSources: [source],
      targetThreadId: "thread-1",
      workspacePath: "/tmp/env-1",
    });

    expect(threadEntry).toBe(terminalEntry);
    expect(threadEntry.skillCatalogHash).toBeNull();
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(terminalEntry.runtime.shutdown).not.toHaveBeenCalled();
  });

  it("rejects a stale skill catalog on a busy runtime when no thread targets it", async () => {
    const dataDir = await makeTempDir("bb-runtime-manager-skills-conflict-");
    const source = await writeInjectedSkillSource({
      dataDir,
      name: "release-notes",
      token: "first-token",
    });
    const provisionWorkspace = createProvisionWorkspaceMock("/tmp/env-1");
    const runtime = createFakeRuntime();
    const createRuntime = vi.fn(() => runtime);
    const manager = new RuntimeManager({
      dataDir,
      provisionWorkspace,
      createRuntime,
    });

    const firstEntry = await manager.ensureEnvironment({
      environmentId: "env-skills",
      injectedSkillSources: [source],
      workspacePath: "/tmp/env-1",
    });
    runtime.setActiveTurn("thread-1", "turn-1");
    await writeInjectedSkillSource({
      dataDir,
      name: "release-notes",
      token: "second-token",
    });

    await expect(
      manager.ensureEnvironment({
        environmentId: "env-skills",
        injectedSkillSources: [source],
        workspacePath: "/tmp/env-1",
      }),
    ).rejects.toBeInstanceOf(SkillCatalogConflictError);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(firstEntry.runtime.shutdown).not.toHaveBeenCalled();
  });

  it("applies unmanaged checkout provisioning to existing runtime entries", async () => {
    const provisionWorkspace = createProvisionWorkspaceMock("/tmp/env-1");
    const createRuntime = vi.fn(() => createFakeRuntime());
    const onWorkspaceStatusChanged = vi.fn();
    const manager = new RuntimeManager({
      provisionWorkspace,
      createRuntime,
      onWorkspaceStatusChanged,
    });

    const firstEntry = await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    const secondEntry = await manager.ensureEnvironment({
      environmentId: "env-1",
      provision: {
        workspaceProvisionType: "unmanaged",
        path: "/tmp/env-1",
        checkout: { kind: "existing", name: "feature-existing" },
      },
    });

    expect(secondEntry).toBe(firstEntry);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(provisionWorkspace).toHaveBeenCalledTimes(2);
    expect(provisionWorkspace).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        workspaceProvisionType: "unmanaged",
        path: "/tmp/env-1",
        checkout: { kind: "existing", name: "feature-existing" },
      }),
    );
    expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
      environmentId: "env-1",
      changeKinds: ["work-status-changed", "git-refs-changed"],
    });
  });

  it("registers existing environment provisioning before invoking work", async () => {
    let manager: RuntimeManager;
    let callCount = 0;
    let cancelDuringWork: Promise<{ aborted: boolean }> | null = null;
    const workspace = createFakeWorkspace("/tmp/env-1");
    const provisionWorkspace = vi.fn(
      async (options: ProvisionWorkspaceArgs) => {
        callCount += 1;
        if (callCount === 1) {
          return workspace;
        }

        cancelDuringWork = manager.cancelEnvironmentProvision({
          environmentId: "env-1",
        });
        if (!options.signal?.aborted) {
          throw new Error("Expected provision signal to be aborted");
        }
        throw options.signal.reason;
      },
    );
    manager = new RuntimeManager({
      provisionWorkspace,
      createRuntime: vi.fn(() => createFakeRuntime()),
    });

    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    await expect(
      manager.ensureEnvironment({
        environmentId: "env-1",
        provision: {
          workspaceProvisionType: "unmanaged",
          path: "/tmp/env-1",
          checkout: { kind: "existing", name: "feature-existing" },
        },
      }),
    ).rejects.toMatchObject({ code: "provision_cancelled" });
    if (!cancelDuringWork) {
      throw new Error("Expected cancellation to be requested during provision");
    }
    await expect(cancelDuringWork).resolves.toEqual({ aborted: true });
  });

  it("shares existing environment provisioning cancellation across concurrent callers", async () => {
    const provisionStarted = createDeferred<void>();
    const provisionSignals: AbortSignal[] = [];
    let callCount = 0;
    const workspace = createFakeWorkspace("/tmp/env-1");
    const provisionWorkspace = vi.fn(
      async (options: ProvisionWorkspaceArgs) => {
        callCount += 1;
        if (callCount === 1) {
          return workspace;
        }
        if (!options.signal) {
          throw new Error("Expected provision signal");
        }
        provisionSignals.push(options.signal);
        provisionStarted.resolve();
        return new Promise<HostWorkspace>((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        });
      },
    );
    const manager = new RuntimeManager({
      provisionWorkspace,
      createRuntime: vi.fn(() => createFakeRuntime()),
    });
    const provision: ProvisionWorkspaceArgs = {
      workspaceProvisionType: "unmanaged",
      path: "/tmp/env-1",
      checkout: { kind: "existing", name: "feature-existing" },
    };

    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    const first = manager.ensureEnvironment({
      environmentId: "env-1",
      provision,
    });
    await provisionStarted.promise;
    const second = manager.ensureEnvironment({
      environmentId: "env-1",
      provision,
    });
    const firstCancelled = expect(first).rejects.toMatchObject({
      code: "provision_cancelled",
    });
    const secondCancelled = expect(second).rejects.toMatchObject({
      code: "provision_cancelled",
    });

    await expect(
      manager.cancelEnvironmentProvision({
        environmentId: "env-1",
      }),
    ).resolves.toEqual({ aborted: true });
    await firstCancelled;
    await secondCancelled;
    expect(provisionWorkspace).toHaveBeenCalledTimes(2);
    expect(provisionSignals).toHaveLength(1);
    expect(provisionSignals[0]?.aborted).toBe(true);
  });

  it("passes managed worktree git metadata roots to created runtimes", async () => {
    const repoPath = await initRepo();
    const parentDir = await makeTempDir("bb-runtime-manager-worktree-");
    const targetPath = path.join(parentDir, "env");
    const runtimeOptions: RuntimeOptionsRef = { current: null };
    const manager = new RuntimeManager({
      provisionWorkspace,
      createRuntime: (options) => {
        runtimeOptions.current = options;
        return createFakeRuntime();
      },
    });

    await manager.ensureEnvironment({
      environmentId: "env-roots",
      provision: {
        workspaceProvisionType: "managed-worktree",
        sourcePath: repoPath,
        targetPath,
        branchName: "bb/env-roots",
        baseBranch: "main",
        timeoutMs: 900000,
      },
    });
    const gitDir = (
      await runGit(["rev-parse", "--absolute-git-dir"], { cwd: targetPath })
    ).trim();
    const commonGitDir = path.resolve(
      targetPath,
      (
        await runGit(["rev-parse", "--git-common-dir"], { cwd: targetPath })
      ).trim(),
    );

    expect(runtimeOptions.current?.additionalWorkspaceWriteRoots).toEqual([
      path.resolve(gitDir),
      path.join(commonGitDir, "objects"),
      path.join(commonGitDir, "refs"),
      path.join(commonGitDir, "logs"),
    ]);
  });

  it("passes unmanaged linked worktree git metadata roots to created runtimes", async () => {
    const repoPath = await initRepo();
    const parentDir = await makeTempDir("bb-runtime-manager-unmanaged-wt-");
    const worktreePath = path.join(parentDir, "env");
    await runGit(["worktree", "add", "-B", "bb/unmanaged", worktreePath], {
      cwd: repoPath,
    });
    const runtimeOptions: RuntimeOptionsRef = { current: null };
    const manager = new RuntimeManager({
      provisionWorkspace,
      createRuntime: (options) => {
        runtimeOptions.current = options;
        return createFakeRuntime();
      },
    });

    await manager.ensureEnvironment({
      environmentId: "env-unmanaged-roots",
      provision: {
        workspaceProvisionType: "unmanaged",
        path: worktreePath,
      },
    });
    const gitDir = (
      await runGit(["rev-parse", "--absolute-git-dir"], { cwd: worktreePath })
    ).trim();
    const commonGitDir = path.resolve(
      worktreePath,
      (
        await runGit(["rev-parse", "--git-common-dir"], { cwd: worktreePath })
      ).trim(),
    );

    expect(runtimeOptions.current?.additionalWorkspaceWriteRoots).toEqual([
      path.resolve(gitDir),
      path.join(commonGitDir, "objects"),
      path.join(commonGitDir, "refs"),
      path.join(commonGitDir, "logs"),
    ]);
  });

  it("passes thread storage root to created runtimes as a workspace-write root", async () => {
    const provisionWorkspace = createProvisionWorkspaceMock("/tmp/env-1");
    const runtimeOptions: RuntimeOptionsRef = { current: null };
    const manager = new RuntimeManager({
      provisionWorkspace,
      threadStorageRootPath: "/tmp/bb-thread-storage",
      createRuntime: (options) => {
        runtimeOptions.current = options;
        return createFakeRuntime();
      },
    });

    await manager.ensureEnvironment({
      environmentId: "env-thread-storage-root",
      workspacePath: "/tmp/env-1",
    });

    expect(runtimeOptions.current?.additionalWorkspaceWriteRoots).toEqual([
      "/tmp/bb-thread-storage",
    ]);
  });

  it("passes shell env through to created runtimes", async () => {
    const provisionWorkspace = createProvisionWorkspaceMock("/tmp/env-1");
    const createRuntime = vi.fn(() => createFakeRuntime());
    const manager = new RuntimeManager({
      provisionWorkspace,
      createRuntime,
      shellEnv: {
        PATH: "/tmp/bb-bin:/usr/bin",
        BB_SERVER_URL: "http://127.0.0.1:3334",
      },
    });

    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    expect(createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        shellEnv: {
          PATH: "/tmp/bb-bin:/usr/bin",
          BB_SERVER_URL: "http://127.0.0.1:3334",
        },
      }),
    );
  });

  it("merges managed shell env into future runtime creation", async () => {
    const provisionWorkspace = createProvisionWorkspaceMock("/tmp/env-1");
    const createRuntime = vi.fn(() => createFakeRuntime());
    const manager = new RuntimeManager({
      provisionWorkspace,
      createRuntime,
      shellEnv: {
        PATH: "/tmp/bb-bin:/usr/bin",
      },
    });

    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    manager.replaceManagedShellEnv({
      GITHUB_TOKEN: "test-github-token",
      OPENAI_API_KEY: "test-openai-key",
    });
    await manager.ensureEnvironment({
      environmentId: "env-2",
      workspacePath: "/tmp/env-2",
    });

    expect(createRuntime).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        shellEnv: {
          GITHUB_TOKEN: "test-github-token",
          OPENAI_API_KEY: "test-openai-key",
          PATH: "/tmp/bb-bin:/usr/bin",
        },
      }),
    );
  });

  it("reuses the existing runtime for subsequent requests", async () => {
    const provisionWorkspace = createProvisionWorkspaceMock("/tmp/env-1");
    const createRuntime = vi.fn(() => createFakeRuntime());
    const manager = new RuntimeManager({
      provisionWorkspace,
      createRuntime,
    });

    const first = await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    const second = await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    expect(second).toBe(first);
    expect(provisionWorkspace).toHaveBeenCalledTimes(1);
    expect(createRuntime).toHaveBeenCalledTimes(1);
  });

  it("evicts only idle environments and keeps their workspaces intact", async () => {
    const runtimes: ReturnType<typeof createFakeRuntime>[] = [];
    const workspaces: HostWorkspace[] = [];
    const createRuntime = vi.fn(() => {
      const runtime = createFakeRuntime();
      runtimes.push(runtime);
      return runtime;
    });
    const provisionWorkspace = vi.fn(
      async (...args: ProvisionWorkspaceMockArgs) => {
        const workspace = createFakeWorkspace(
          getProvisionWorkspacePath(args[0]),
        );
        workspaces.push(workspace);
        return workspace;
      },
    );
    const manager = new RuntimeManager({
      createRuntime,
      provisionWorkspace,
    });

    await manager.ensureEnvironment({
      environmentId: "env-idle",
      workspacePath: "/tmp/env-idle",
    });
    await manager.ensureEnvironment({
      environmentId: "env-active",
      workspacePath: "/tmp/env-active",
    });
    runtimes[1]?.setActiveTurn("thr-active", "turn-active");

    await expect(manager.evictIdleEnvironments()).resolves.toEqual([
      "env-idle",
    ]);

    expect(manager.get("env-idle")).toBeUndefined();
    expect(manager.get("env-active")).toBeDefined();
    expect(runtimes[0]?.shutdown).toHaveBeenCalledTimes(1);
    expect(runtimes[1]?.shutdown).not.toHaveBeenCalled();
    // Idle eviction only tears down daemon-owned runtime processes. Workspace
    // destruction remains a server-owned explicit lifecycle action.
    expect(workspaces[0]?.destroy).not.toHaveBeenCalled();
    expect(workspaces[1]?.destroy).not.toHaveBeenCalled();
  });

  it("skips idle eviction while environment creation is still pending", async () => {
    const deferredWorkspace = createDeferred<HostWorkspace>();
    const manager = new RuntimeManager({
      provisionWorkspace: vi.fn(async () => deferredWorkspace.promise),
      createRuntime: vi.fn(() => createFakeRuntime()),
    });

    const pendingEnvironment = manager.ensureEnvironment({
      environmentId: "env-pending",
      workspacePath: "/tmp/env-pending",
    });

    await expect(manager.evictIdleEnvironments()).resolves.toEqual([]);

    deferredWorkspace.resolve(createFakeWorkspace("/tmp/env-pending"));
    await expect(pendingEnvironment).resolves.toMatchObject({
      environmentId: "env-pending",
    });
    expect(manager.get("env-pending")).toBeDefined();
  });

  it("shuts down the runtime and destroys the workspace", async () => {
    const workspace = createFakeWorkspace("/tmp/env-1");
    const runtime = createFakeRuntime();
    const manager = new RuntimeManager({
      provisionWorkspace:
        createProvisionWorkspaceMock("/tmp/env-1").mockResolvedValue(workspace),
      createRuntime: vi.fn(() => runtime),
    });

    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    await manager.destroyEnvironment("env-1");

    expect(runtime.shutdown).toHaveBeenCalledTimes(1);
    expect(workspace.destroy).toHaveBeenCalledTimes(1);
  });

  it("forgets a retired environment without destroying its workspace", async () => {
    const workspace = createFakeWorkspace("/tmp/env-retired");
    const runtime = createFakeRuntime();
    const manager = new RuntimeManager({
      provisionWorkspace:
        createProvisionWorkspaceMock("/tmp/env-retired").mockResolvedValue(
          workspace,
        ),
      createRuntime: vi.fn(() => runtime),
    });

    await manager.ensureEnvironment({
      environmentId: "env-retired",
      workspacePath: "/tmp/env-retired",
    });
    await manager.forgetEnvironment("env-retired");

    expect(manager.get("env-retired")).toBeUndefined();
    expect(runtime.shutdown).toHaveBeenCalledTimes(1);
    expect(workspace.destroy).not.toHaveBeenCalled();
  });

  it("does not start a workspace watcher when loading an environment", async () => {
    const hostWatcher = {
      watchWorkspace: vi.fn(() => () => undefined),
      watchThreadStorageRoot: vi.fn(() => () => undefined),
    } satisfies HostWatcher;
    const manager = new RuntimeManager({
      hostWatcher,
      provisionWorkspace: createProvisionWorkspaceMock("/tmp/env-read"),
      createRuntime: vi.fn(() => createFakeRuntime()),
    });

    await manager.ensureEnvironment({
      environmentId: "env-read",
      workspacePath: "/tmp/env-read",
    });

    expect(hostWatcher.watchWorkspace).not.toHaveBeenCalled();
    expect(hostWatcher.watchThreadStorageRoot).not.toHaveBeenCalled();
  });

  it("lists the runtimes' active threads for session reconciliation", async () => {
    const runtime = createFakeRuntime();
    const manager = new RuntimeManager({
      provisionWorkspace: createProvisionWorkspaceMock("/tmp/env-1"),
      createRuntime: vi.fn(() => runtime),
    });

    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    runtime.setActiveTurn("thread-1", "turn-1");
    expect(manager.listActiveThreads()).toEqual([
      {
        threadId: "thread-1",
      },
    ]);

    runtime.endActiveTurn("thread-1");
    expect(manager.listActiveThreads()).toEqual([]);
  });

  it("removes stale entries when the provider process exits", async () => {
    const workspace = createFakeWorkspace("/tmp/env-exit");
    const runtime = createFakeRuntime();
    let onProcessExit:
      | NonNullable<AgentRuntimeOptions["onProcessExit"]>
      | undefined;
    const manager = new RuntimeManager({
      provisionWorkspace:
        createProvisionWorkspaceMock("/tmp/env-exit").mockResolvedValue(
          workspace,
        ),
      createRuntime: vi.fn((options) => {
        onProcessExit = options.onProcessExit;
        return runtime;
      }),
    });

    await manager.ensureEnvironment({
      environmentId: "env-exit",
      workspacePath: "/tmp/env-exit",
    });

    onProcessExit?.({
      providerId: "fake",
      threads: [
        { threadId: "thread-1", activeTurnId: null, providerThreadId: null },
      ],
      code: 1,
      expected: false,
      signal: null,
      stderr: null,
    });

    expect(manager.get("env-exit")).toBeUndefined();
    expect(runtime.shutdown).not.toHaveBeenCalled();
  });

  it("keeps sibling provider threads running when one provider exits", async () => {
    const workspace = createFakeWorkspace("/tmp/env-shared");
    const runtime = createFakeRuntime();
    let runningProviders = ["fake-alpha", "fake-beta"];
    runtime.listRunningProviders.mockImplementation(() => runningProviders);
    let onProcessExit:
      | NonNullable<AgentRuntimeOptions["onProcessExit"]>
      | undefined;
    const manager = new RuntimeManager({
      provisionWorkspace:
        createProvisionWorkspaceMock("/tmp/env-shared").mockResolvedValue(
          workspace,
        ),
      createRuntime: vi.fn((options) => {
        onProcessExit = options.onProcessExit;
        return runtime;
      }),
    });

    await manager.ensureEnvironment({
      environmentId: "env-shared",
      workspacePath: "/tmp/env-shared",
    });
    runningProviders = ["fake-beta"];
    onProcessExit?.({
      providerId: "fake-alpha",
      threads: [
        { threadId: "thread-a", activeTurnId: null, providerThreadId: null },
      ],
      code: 1,
      expected: false,
      signal: null,
      stderr: null,
    });

    expect(manager.get("env-shared")).toBeDefined();
    expect(runtime.shutdown).not.toHaveBeenCalled();
  });

  it("emits failure events for active threads when a provider exits unexpectedly", async () => {
    const emittedEvents: Array<{
      environmentId: string;
      event: ThreadEvent;
    }> = [];
    const runtime = createFakeRuntime();
    const forwardedProcessExits: Parameters<
      NonNullable<AgentRuntimeOptions["onProcessExit"]>
    >[0][] = [];
    let onRuntimeEvent: AgentRuntimeOptions["onEvent"] | undefined;
    let onProcessExit:
      | NonNullable<AgentRuntimeOptions["onProcessExit"]>
      | undefined;
    const manager = new RuntimeManager({
      provisionWorkspace: createProvisionWorkspaceMock(
        "/tmp/env-provider-exit",
      ).mockResolvedValue(createFakeWorkspace("/tmp/env-provider-exit")),
      createRuntime: vi.fn((options) => {
        onRuntimeEvent = options.onEvent;
        onProcessExit = options.onProcessExit;
        return runtime;
      }),
      onEvent: (event) => {
        emittedEvents.push(event);
      },
      onProcessExit: (info) => {
        forwardedProcessExits.push(info);
      },
    });

    await manager.ensureEnvironment({
      environmentId: "env-provider-exit",
      workspacePath: "/tmp/env-provider-exit",
    });
    if (!onRuntimeEvent || !onProcessExit) {
      throw new Error("Expected runtime callbacks to be captured");
    }
    onRuntimeEvent({
      type: "turn/started",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
    });

    onProcessExit({
      providerId: "codex",
      threads: [
        {
          threadId: "thread-1",
          activeTurnId: "turn-1",
          providerThreadId: "provider-1",
        },
      ],
      code: 1,
      expected: false,
      signal: null,
      stderr: "OPENAI_API_KEY=sk-test-secret\nUsage limit reached.",
    });

    expect(emittedEvents).toEqual([
      {
        environmentId: "env-provider-exit",
        event: {
          type: "turn/started",
          threadId: "thread-1",
          providerThreadId: "provider-1",
          scope: turnScope("turn-1"),
        },
      },
      {
        environmentId: "env-provider-exit",
        event: {
          type: "turn/completed",
          threadId: "thread-1",
          providerThreadId: "provider-1",
          scope: turnScope("turn-1"),
          status: "failed",
          error: {
            message: 'Provider "codex" exited unexpectedly with code 1',
          },
        },
      },
      {
        environmentId: "env-provider-exit",
        event: {
          type: "system/error",
          threadId: "thread-1",
          scope: turnScope("turn-1"),
          code: "provider_process_exited",
          message: 'Provider "codex" exited unexpectedly with code 1',
          detail:
            "stderr:\nOPENAI_API_KEY=sk-test-secret\nUsage limit reached.",
        },
      },
    ]);
    expect(forwardedProcessExits).toEqual([
      expect.objectContaining({
        stderr: "OPENAI_API_KEY=sk-test-secret\nUsage limit reached.",
      }),
    ]);
  });

  it("does not synthesize failure events for exited threads without an active turn", async () => {
    const emittedEvents: Array<{
      environmentId: string;
      event: ThreadEvent;
    }> = [];
    const runtime = createFakeRuntime();
    let onProcessExit:
      | NonNullable<AgentRuntimeOptions["onProcessExit"]>
      | undefined;
    const manager = new RuntimeManager({
      provisionWorkspace: createProvisionWorkspaceMock(
        "/tmp/env-idle-exit",
      ).mockResolvedValue(createFakeWorkspace("/tmp/env-idle-exit")),
      createRuntime: vi.fn((options) => {
        onProcessExit = options.onProcessExit;
        return runtime;
      }),
      onEvent: (event) => {
        emittedEvents.push(event);
      },
    });

    await manager.ensureEnvironment({
      environmentId: "env-idle-exit",
      workspacePath: "/tmp/env-idle-exit",
    });
    if (!onProcessExit) {
      throw new Error("Expected runtime callbacks to be captured");
    }

    onProcessExit({
      providerId: "codex",
      threads: [
        {
          threadId: "thread-idle",
          activeTurnId: null,
          providerThreadId: "provider-idle",
        },
      ],
      code: 1,
      expected: false,
      signal: null,
      stderr: null,
    });

    expect(emittedEvents).toEqual([]);
  });

  it("does not emit failure events for expected provider exits", async () => {
    const emittedEvents: Array<{
      environmentId: string;
      event: ThreadEvent;
    }> = [];
    const runtime = createFakeRuntime();
    let onRuntimeEvent: AgentRuntimeOptions["onEvent"] | undefined;
    let onProcessExit:
      | NonNullable<AgentRuntimeOptions["onProcessExit"]>
      | undefined;
    const manager = new RuntimeManager({
      provisionWorkspace: createProvisionWorkspaceMock(
        "/tmp/env-expected-exit",
      ).mockResolvedValue(createFakeWorkspace("/tmp/env-expected-exit")),
      createRuntime: vi.fn((options) => {
        onRuntimeEvent = options.onEvent;
        onProcessExit = options.onProcessExit;
        return runtime;
      }),
      onEvent: (event) => {
        emittedEvents.push(event);
      },
    });

    await manager.ensureEnvironment({
      environmentId: "env-expected-exit",
      workspacePath: "/tmp/env-expected-exit",
    });
    if (!onRuntimeEvent || !onProcessExit) {
      throw new Error("Expected runtime callbacks to be captured");
    }
    onRuntimeEvent({
      type: "turn/started",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
    });
    emittedEvents.splice(0, emittedEvents.length);

    onProcessExit({
      providerId: "codex",
      threads: [
        {
          threadId: "thread-1",
          activeTurnId: "turn-1",
          providerThreadId: "provider-1",
        },
      ],
      code: null,
      expected: true,
      signal: "SIGTERM",
      stderr: null,
    });

    expect(emittedEvents).toEqual([]);
    expect(manager.get("env-expected-exit")).toBeDefined();
  });

  it("shuts down all tracked environments", async () => {
    const workspaceA = createFakeWorkspace("/tmp/env-a");
    const workspaceB = createFakeWorkspace("/tmp/env-b");
    const runtimeA = createFakeRuntime();
    const runtimeB = createFakeRuntime();
    const provisionWorkspace = createProvisionWorkspaceMock("/tmp/env-a")
      .mockResolvedValueOnce(workspaceA)
      .mockResolvedValueOnce(workspaceB);
    const createRuntime = vi
      .fn()
      .mockReturnValueOnce(runtimeA)
      .mockReturnValueOnce(runtimeB);
    const manager = new RuntimeManager({
      provisionWorkspace,
      createRuntime,
    });

    await manager.ensureEnvironment({
      environmentId: "env-a",
      workspacePath: "/tmp/env-a",
    });
    await manager.ensureEnvironment({
      environmentId: "env-b",
      workspacePath: "/tmp/env-b",
    });

    await manager.shutdownAll();

    expect(runtimeA.shutdown).toHaveBeenCalledTimes(1);
    expect(runtimeB.shutdown).toHaveBeenCalledTimes(1);
    // shutdownAll does NOT destroy workspaces — the server owns managed
    // workspace lifecycle via explicit environment.destroy commands
    expect(workspaceA.destroy).not.toHaveBeenCalled();
    expect(workspaceB.destroy).not.toHaveBeenCalled();
  });
});
