import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentRuntime, AgentRuntimeOptions } from "@bb/agent-runtime";
import type { ThreadEvent } from "@bb/domain";
import { threadScope, turnScope } from "@bb/domain";
import type { HostDaemonInjectedSkillSource } from "@bb/host-daemon-contract";
import type {
  HostWatcher,
  WatchApplicationStorageRootArgs,
  ThreadStorageWatchError,
  WatchThreadStorageRootArgs,
  WatchWorkspaceArgs,
  WorkspaceWatchError,
} from "@bb/host-watcher";
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
type StopWatchingStatus = () => void | Promise<void>;
type StopWatchingPathChanges = () => void | Promise<void>;
type WatchWorkspaceImplementation = (
  args: WatchWorkspaceArgs,
) => StopWatchingStatus;
type WatchThreadStorageRootImplementation = (
  args: WatchThreadStorageRootArgs,
) => StopWatchingPathChanges;
type WatchApplicationStorageRootImplementation = (
  args: WatchApplicationStorageRootArgs,
) => StopWatchingPathChanges;
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
    applicationId: null,
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

function createFakeHostWatcher(
  args: {
    watchApplicationStorageRootImplementation?: WatchApplicationStorageRootImplementation;
    watchThreadStorageRootImplementation?: WatchThreadStorageRootImplementation;
    watchWorkspaceImplementation?: WatchWorkspaceImplementation;
  } = {},
) {
  const watchWorkspace = vi.fn<WatchWorkspaceImplementation>(
    args.watchWorkspaceImplementation ?? ((_args) => () => undefined),
  );
  const watchThreadStorageRoot = vi.fn<WatchThreadStorageRootImplementation>(
    args.watchThreadStorageRootImplementation ?? ((_args) => () => undefined),
  );
  const watchApplicationStorageRoot =
    vi.fn<WatchApplicationStorageRootImplementation>(
      args.watchApplicationStorageRootImplementation ??
        ((_args) => () => undefined),
    );
  const hostWatcher = {
    watchApplicationStorageRoot,
    watchWorkspace,
    watchThreadStorageRoot,
  } satisfies HostWatcher;

  return {
    hostWatcher,
    watchApplicationStorageRoot,
    watchThreadStorageRoot,
    watchWorkspace,
  };
}

function createFakeRuntime() {
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
    shutdown: vi.fn(async () => undefined),
  } satisfies AgentRuntime;
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
    const firstCatalogHash = firstEntry.skillCatalogHash;
    manager.markThreadActive("env-skills", "thread-1", "provider-1", null);
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

    manager.markThreadInactive("env-skills", "thread-1");
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
    manager.markThreadActive("env-skills", "thread-1", "provider-1", null);
    manager.markThreadInactive("env-skills", "thread-1");
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
    manager.markThreadActive("env-skills", "other-thread", "provider-1", null);
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
    manager.markThreadActive("env-skills", "thread-1", "provider-1", null);
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
    const runtimes: AgentRuntime[] = [];
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
    manager.markThreadActive(
      "env-active",
      "thr-active",
      "provider-thread-active",
      null,
    );

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
    const stopWatchingStatus = vi.fn(() => undefined);
    const workspace = createFakeWorkspace("/tmp/env-1");
    const { hostWatcher, watchWorkspace } = createFakeHostWatcher({
      watchWorkspaceImplementation: (_args) => stopWatchingStatus,
    });
    const runtime = createFakeRuntime();
    const manager = new RuntimeManager({
      hostWatcher,
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
    expect(watchWorkspace).toHaveBeenCalledTimes(1);
    expect(stopWatchingStatus).toHaveBeenCalledTimes(1);
    expect(workspace.destroy).toHaveBeenCalledTimes(1);
  });

  it("waits for workspace watcher teardown before destroying the workspace", async () => {
    const watcherStopped = createDeferred<void>();
    const stopWatchingStatus = vi.fn(async () => watcherStopped.promise);
    const workspace = createFakeWorkspace("/tmp/env-1");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (_args) => stopWatchingStatus,
    });
    const runtime = createFakeRuntime();
    const manager = new RuntimeManager({
      hostWatcher,
      provisionWorkspace:
        createProvisionWorkspaceMock("/tmp/env-1").mockResolvedValue(workspace),
      createRuntime: vi.fn(() => runtime),
    });

    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    const destroyPromise = manager.destroyEnvironment("env-1");

    await vi.waitFor(() => {
      expect(stopWatchingStatus).toHaveBeenCalledTimes(1);
    });
    expect(runtime.shutdown).not.toHaveBeenCalled();
    expect(workspace.destroy).not.toHaveBeenCalled();

    watcherStopped.resolve(undefined);
    await destroyPromise;

    expect(runtime.shutdown).toHaveBeenCalledTimes(1);
    expect(workspace.destroy).toHaveBeenCalledTimes(1);
  });

  it("forgets a retired environment without destroying its workspace", async () => {
    const stopWatchingStatus = vi.fn(() => undefined);
    const workspace = createFakeWorkspace("/tmp/env-retired");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (_args) => stopWatchingStatus,
    });
    const runtime = createFakeRuntime();
    const manager = new RuntimeManager({
      hostWatcher,
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
    expect(stopWatchingStatus).toHaveBeenCalledTimes(1);
    expect(runtime.shutdown).toHaveBeenCalledTimes(1);
    expect(workspace.destroy).not.toHaveBeenCalled();
  });

  it("installs the workspace status watcher once and reports workspace status changes", async () => {
    const stopWatchingStatus = vi.fn(() => undefined);
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher, watchWorkspace } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return stopWatchingStatus;
      },
    });
    const onWorkspaceStatusChanged = vi.fn();
    const manager = new RuntimeManager({
      hostWatcher,
      provisionWorkspace:
        createProvisionWorkspaceMock("/tmp/env-watch").mockResolvedValue(
          workspace,
        ),
      createRuntime: vi.fn(() => createFakeRuntime()),
      onWorkspaceStatusChanged,
    });

    await manager.ensureEnvironment({
      environmentId: "env-watch",
      workspacePath: "/tmp/env-watch",
    });
    workspace.setLocalStateFingerprint("local:/tmp/env-watch:changed");
    await manager.ensureEnvironment({
      environmentId: "env-watch",
      workspacePath: "/tmp/env-watch",
    });
    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/env-watch/README.md"],
      changeKinds: ["workspace-content-changed"],
      kind: "workspace-status-changed",
      environmentId: "env-watch",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(watchWorkspace).toHaveBeenCalledTimes(1);
    expect(watchWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: "env-watch",
        workspacePath: "/tmp/env-watch",
      }),
    );
    expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
      changeKinds: ["work-status-changed"],
      environmentId: "env-watch",
    });
    expect(stopWatchingStatus).not.toHaveBeenCalled();
  });

  it("suppresses workspace change notifications when the local fingerprint is unchanged", async () => {
    const stopWatchingStatus = vi.fn(() => undefined);
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return stopWatchingStatus;
      },
    });
    const onWorkspaceStatusChanged = vi.fn();
    const manager = new RuntimeManager({
      hostWatcher,
      provisionWorkspace:
        createProvisionWorkspaceMock("/tmp/env-watch").mockResolvedValue(
          workspace,
        ),
      createRuntime: vi.fn(() => createFakeRuntime()),
      onWorkspaceStatusChanged,
    });

    await manager.ensureEnvironment({
      environmentId: "env-watch",
      workspacePath: "/tmp/env-watch",
    });

    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/env-watch/README.md"],
      changeKinds: ["workspace-content-changed"],
      kind: "workspace-status-changed",
      environmentId: "env-watch",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onWorkspaceStatusChanged).not.toHaveBeenCalled();
  });

  it("reports shared git ref changes separately from local workspace changes", async () => {
    const stopWatchingStatus = vi.fn(() => undefined);
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return stopWatchingStatus;
      },
    });
    const onWorkspaceStatusChanged = vi.fn();
    const manager = new RuntimeManager({
      hostWatcher,
      provisionWorkspace:
        createProvisionWorkspaceMock("/tmp/env-watch").mockResolvedValue(
          workspace,
        ),
      createRuntime: vi.fn(() => createFakeRuntime()),
      onWorkspaceStatusChanged,
    });

    await manager.ensureEnvironment({
      environmentId: "env-watch",
      workspacePath: "/tmp/env-watch",
    });
    workspace.setSharedGitRefsFingerprint("refs:/tmp/env-watch:changed");

    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/shared/.git/refs/heads/main"],
      changeKinds: ["shared-git-refs-changed"],
      kind: "workspace-status-changed",
      environmentId: "env-watch",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
      changeKinds: ["git-refs-changed"],
      environmentId: "env-watch",
    });
  });

  it("reports shared git ref changes from single-dir git watcher events", async () => {
    const stopWatchingStatus = vi.fn(() => undefined);
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return stopWatchingStatus;
      },
    });
    const onWorkspaceStatusChanged = vi.fn();
    const manager = new RuntimeManager({
      hostWatcher,
      provisionWorkspace:
        createProvisionWorkspaceMock("/tmp/env-watch").mockResolvedValue(
          workspace,
        ),
      createRuntime: vi.fn(() => createFakeRuntime()),
      onWorkspaceStatusChanged,
    });

    await manager.ensureEnvironment({
      environmentId: "env-watch",
      workspacePath: "/tmp/env-watch",
    });
    workspace.setSharedGitRefsFingerprint("refs:/tmp/env-watch:changed");

    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/env-watch/.git/refs/heads/feature"],
      changeKinds: ["workspace-git-changed", "shared-git-refs-changed"],
      kind: "workspace-status-changed",
      environmentId: "env-watch",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
      changeKinds: ["git-refs-changed"],
      environmentId: "env-watch",
    });
  });

  it("reports local fingerprint recomputation failures and recovers on the next change", async () => {
    const stopWatchingStatus = vi.fn(() => undefined);
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return stopWatchingStatus;
      },
    });
    const onWorkspaceStatusChanged = vi.fn();
    const onWorkspaceStatusWatchError = vi.fn();
    const manager = new RuntimeManager({
      hostWatcher,
      provisionWorkspace:
        createProvisionWorkspaceMock("/tmp/env-watch").mockResolvedValue(
          workspace,
        ),
      createRuntime: vi.fn(() => createFakeRuntime()),
      onWorkspaceStatusChanged,
      onWorkspaceStatusWatchError,
    });

    await manager.ensureEnvironment({
      environmentId: "env-watch",
      workspacePath: "/tmp/env-watch",
    });

    workspace.setLocalStateFingerprintError(new Error("workspace vanished"));
    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/env-watch/README.md"],
      changeKinds: ["workspace-content-changed"],
      kind: "workspace-status-changed",
      environmentId: "env-watch",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onWorkspaceStatusChanged).not.toHaveBeenCalled();
    expect(onWorkspaceStatusWatchError).toHaveBeenCalledWith({
      error: {
        environmentId: "env-watch",
        kind: "workspace-watch-error",
        message: "workspace vanished",
        rootPath: "/tmp/env-watch",
      },
    });

    workspace.setLocalStateFingerprintError(null);
    workspace.setLocalStateFingerprint("local:/tmp/env-watch:changed");
    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/env-watch/src/index.ts"],
      changeKinds: ["workspace-content-changed"],
      kind: "workspace-status-changed",
      environmentId: "env-watch",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
      changeKinds: ["work-status-changed"],
      environmentId: "env-watch",
    });
  });

  it("reports shared git ref fingerprint recomputation failures and recovers on the next change", async () => {
    const stopWatchingStatus = vi.fn(() => undefined);
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return stopWatchingStatus;
      },
    });
    const onWorkspaceStatusChanged = vi.fn();
    const onWorkspaceStatusWatchError = vi.fn();
    const manager = new RuntimeManager({
      hostWatcher,
      provisionWorkspace:
        createProvisionWorkspaceMock("/tmp/env-watch").mockResolvedValue(
          workspace,
        ),
      createRuntime: vi.fn(() => createFakeRuntime()),
      onWorkspaceStatusChanged,
      onWorkspaceStatusWatchError,
    });

    await manager.ensureEnvironment({
      environmentId: "env-watch",
      workspacePath: "/tmp/env-watch",
    });

    workspace.setSharedGitRefsFingerprintError(new Error("refs unavailable"));
    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/shared/.git/refs/heads/main"],
      changeKinds: ["shared-git-refs-changed"],
      kind: "workspace-status-changed",
      environmentId: "env-watch",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onWorkspaceStatusChanged).not.toHaveBeenCalled();
    expect(onWorkspaceStatusWatchError).toHaveBeenCalledWith({
      error: {
        environmentId: "env-watch",
        kind: "workspace-watch-error",
        message: "refs unavailable",
        rootPath: "/tmp/env-watch",
      },
    });

    workspace.setSharedGitRefsFingerprintError(null);
    workspace.setSharedGitRefsFingerprint("refs:/tmp/env-watch:changed");
    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/shared/.git/refs/heads/feature"],
      changeKinds: ["shared-git-refs-changed"],
      kind: "workspace-status-changed",
      environmentId: "env-watch",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
      changeKinds: ["git-refs-changed"],
      environmentId: "env-watch",
    });
  });

  it("forwards workspace watch startup failures with the environment id", async () => {
    const stopWatchingStatus = vi.fn(() => undefined);
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return stopWatchingStatus;
      },
    });
    const onWorkspaceStatusWatchError = vi.fn();
    const manager = new RuntimeManager({
      hostWatcher,
      provisionWorkspace:
        createProvisionWorkspaceMock("/tmp/env-watch").mockResolvedValue(
          workspace,
        ),
      createRuntime: vi.fn(() => createFakeRuntime()),
      onWorkspaceStatusWatchError,
    });

    await manager.ensureEnvironment({
      environmentId: "env-watch",
      workspacePath: "/tmp/env-watch",
    });

    watchWorkspaceArgs?.onWatchError({
      kind: "workspace-watch-error",
      environmentId: "env-watch",
      message: "Error starting FSEvents stream",
      rootPath: "/tmp/env-watch",
    } satisfies WorkspaceWatchError);

    expect(onWorkspaceStatusWatchError).toHaveBeenCalledWith({
      error: {
        kind: "workspace-watch-error",
        environmentId: "env-watch",
        message: "Error starting FSEvents stream",
        rootPath: "/tmp/env-watch",
      },
    });
    expect(stopWatchingStatus).not.toHaveBeenCalled();
  });

  it("tracks active threads for session reconciliation", async () => {
    const manager = new RuntimeManager({
      provisionWorkspace: createProvisionWorkspaceMock("/tmp/env-1"),
      createRuntime: vi.fn(() => createFakeRuntime()),
    });

    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    manager.markThreadActive("env-1", "thread-1", "provider-1", null);
    expect(manager.listActiveThreads()).toEqual([
      {
        threadId: "thread-1",
      },
    ]);

    manager.markThreadInactive("env-1", "thread-1");
    expect(manager.listActiveThreads()).toEqual([]);
  });

  it("remembers known threads after a turn completes so follow-ups reuse the runtime", async () => {
    const manager = new RuntimeManager({
      provisionWorkspace: createProvisionWorkspaceMock("/tmp/env-1"),
      createRuntime: vi.fn(() => createFakeRuntime()),
    });

    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    manager.markThreadActive("env-1", "thread-1", "provider-1", null);
    manager.markThreadInactive("env-1", "thread-1");

    expect(manager.hasThread("env-1", "thread-1")).toBe(true);
    expect(manager.listActiveThreads()).toEqual([]);

    manager.markThreadActive("env-1", "thread-1", "provider-1", null);
    expect(manager.listActiveThreads()).toEqual([
      {
        threadId: "thread-1",
      },
    ]);
  });

  it("forgets stopped threads so follow-ups resume the provider session", async () => {
    const manager = new RuntimeManager({
      provisionWorkspace: createProvisionWorkspaceMock("/tmp/env-1"),
      createRuntime: vi.fn(() => createFakeRuntime()),
    });

    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    manager.markThreadActive("env-1", "thread-1", "provider-1", null);
    manager.forgetThread("env-1", "thread-1");

    expect(manager.hasThread("env-1", "thread-1")).toBe(false);
    expect(manager.listActiveThreads()).toEqual([]);
  });

  it("installs one shared thread storage root watcher for tracked threads", async () => {
    const stopWatchingPathChanges = vi.fn(() => undefined);
    let watchThreadStorageRootArgs: WatchThreadStorageRootArgs | undefined;
    const { hostWatcher, watchThreadStorageRoot } = createFakeHostWatcher({
      watchThreadStorageRootImplementation: (args) => {
        watchThreadStorageRootArgs = args;
        return stopWatchingPathChanges;
      },
    });
    const onThreadStorageChanged = vi.fn();
    const manager = new RuntimeManager({
      hostWatcher,
      provisionWorkspace: createProvisionWorkspaceMock("/tmp/env-storage"),
      createRuntime: vi.fn(() => createFakeRuntime()),
      onThreadStorageChanged,
      threadStorageRootPath: "/tmp/bb-data/thread-storage",
    });

    await manager.ensureEnvironment({
      environmentId: "env-storage",
      workspacePath: "/tmp/env-storage",
    });

    manager.markThreadActive("env-storage", "thread-1", "provider-1", null);
    manager.markThreadActive("env-storage", "thread-2", "provider-2", null);
    watchThreadStorageRootArgs?.onChange({
      kind: "thread-storage-changed",
      environmentId: "env-storage",
      threadId: "thread-1",
    });
    watchThreadStorageRootArgs?.onChange({
      kind: "thread-storage-changed",
      environmentId: "env-storage",
      threadId: "thread-2",
    });
    expect(watchThreadStorageRoot).toHaveBeenCalledTimes(1);
    expect(watchThreadStorageRoot).toHaveBeenCalledWith(
      expect.objectContaining({
        threadStorageRootPath: "/tmp/bb-data/thread-storage",
      }),
    );
    expect(onThreadStorageChanged).toHaveBeenNthCalledWith(1, {
      environmentId: "env-storage",
      threadId: "thread-1",
    });
    expect(onThreadStorageChanged).toHaveBeenNthCalledWith(2, {
      environmentId: "env-storage",
      threadId: "thread-2",
    });
    expect(onThreadStorageChanged).toHaveBeenCalledTimes(2);
    expect(stopWatchingPathChanges).not.toHaveBeenCalled();

    await manager.destroyEnvironment("env-storage");

    expect(stopWatchingPathChanges).toHaveBeenCalledTimes(1);
  });

  it("installs one shared application storage root watcher for app data", async () => {
    const stopWatchingPathChanges = vi.fn(() => undefined);
    let watchApplicationStorageRootArgs:
      | WatchApplicationStorageRootArgs
      | undefined;
    const { hostWatcher, watchApplicationStorageRoot } = createFakeHostWatcher({
      watchApplicationStorageRootImplementation: (args) => {
        watchApplicationStorageRootArgs = args;
        return stopWatchingPathChanges;
      },
    });
    const onApplicationStorageTargetsChanged = vi.fn();
    const onApplicationDataChanged = vi.fn();
    const onApplicationDataResync = vi.fn();
    const onApplicationContentChanged = vi.fn();
    const manager = new RuntimeManager({
      appsRootPath: "/tmp/bb-data/apps",
      appDataRootPath: "/tmp/bb-data/app-data",
      hostWatcher,
      provisionWorkspace: createProvisionWorkspaceMock("/tmp/env-storage"),
      createRuntime: vi.fn(() => createFakeRuntime()),
      onApplicationStorageTargetsChanged,
      onApplicationDataChanged,
      onApplicationDataResync,
      onApplicationContentChanged,
    });

    manager.replaceTrackedApplicationDataTargets([
      {
        applicationId: "status",
        appDataPath: "/tmp/bb-data/app-data/status",
      },
    ]);

    expect(watchApplicationStorageRoot).toHaveBeenCalledTimes(1);
    expect(watchApplicationStorageRoot).toHaveBeenCalledWith(
      expect.objectContaining({
        appsRootPath: "/tmp/bb-data/apps",
        appDataRootPath: "/tmp/bb-data/app-data",
      }),
    );
    expect(
      watchApplicationStorageRootArgs?.resolveApplicationTarget("status"),
    ).toEqual({
      applicationId: "status",
      appDataPath: "/tmp/bb-data/app-data/status",
    });

    watchApplicationStorageRootArgs?.onChange({
      kind: "application-storage-targets-changed",
    });
    watchApplicationStorageRootArgs?.onChange({
      kind: "application-data-changed",
      applicationId: "status",
      appDataPath: "/tmp/bb-data/app-data/status",
      path: "state.json",
    });
    watchApplicationStorageRootArgs?.onChange({
      kind: "application-data-resync",
      applicationId: "status",
    });
    watchApplicationStorageRootArgs?.onChange({
      kind: "application-content-changed",
      applicationId: "status",
    });

    expect(onApplicationStorageTargetsChanged).toHaveBeenCalledTimes(1);
    expect(onApplicationDataChanged).toHaveBeenCalledWith({
      applicationId: "status",
      appDataPath: "/tmp/bb-data/app-data/status",
      path: "state.json",
    });
    expect(onApplicationDataResync).toHaveBeenCalledWith({
      applicationId: "status",
    });
    expect(onApplicationContentChanged).toHaveBeenCalledTimes(1);
    expect(onApplicationContentChanged).toHaveBeenCalledWith({
      applicationId: "status",
    });

    await manager.shutdownAll();

    expect(stopWatchingPathChanges).toHaveBeenCalledTimes(1);
  });

  it("watches tracked thread storage targets restored from session state", async () => {
    let watchThreadStorageRootArgs: WatchThreadStorageRootArgs | undefined;
    const { hostWatcher, watchThreadStorageRoot } = createFakeHostWatcher({
      watchThreadStorageRootImplementation: (args) => {
        watchThreadStorageRootArgs = args;
        return () => undefined;
      },
    });
    const onThreadStorageChanged = vi.fn();
    const manager = new RuntimeManager({
      hostWatcher,
      provisionWorkspace: createProvisionWorkspaceMock("/tmp/env-storage"),
      createRuntime: vi.fn(() => createFakeRuntime()),
      onThreadStorageChanged,
      threadStorageRootPath: "/tmp/bb-data/thread-storage",
    });

    manager.replaceTrackedThreadStorageTargets([
      {
        environmentId: "env-storage",
        threadId: "thread-1",
      },
    ]);

    expect(watchThreadStorageRoot).toHaveBeenCalledTimes(1);
    watchThreadStorageRootArgs?.onChange({
      kind: "thread-storage-changed",
      environmentId: "env-storage",
      threadId: "thread-1",
    });

    expect(onThreadStorageChanged).toHaveBeenCalledWith({
      environmentId: "env-storage",
      threadId: "thread-1",
    });
  });

  it("forwards thread storage watch failures for the shared root watcher", async () => {
    let watchThreadStorageRootArgs: WatchThreadStorageRootArgs | undefined;
    const { hostWatcher } = createFakeHostWatcher({
      watchThreadStorageRootImplementation: (args) => {
        watchThreadStorageRootArgs = args;
        return () => undefined;
      },
    });
    const onThreadStorageWatchError = vi.fn();
    const manager = new RuntimeManager({
      hostWatcher,
      provisionWorkspace: createProvisionWorkspaceMock("/tmp/env-storage"),
      createRuntime: vi.fn(() => createFakeRuntime()),
      onThreadStorageWatchError,
      threadStorageRootPath: "/tmp/bb-data/thread-storage",
    });

    await manager.ensureEnvironment({
      environmentId: "env-storage",
      workspacePath: "/tmp/env-storage",
    });

    manager.markThreadActive("env-storage", "thread-1", "provider-1", null);
    watchThreadStorageRootArgs?.onWatchError({
      kind: "thread-storage-watch-error",
      message: "watch failed",
      rootPath: "/tmp/bb-data/thread-storage",
    } satisfies ThreadStorageWatchError);

    expect(onThreadStorageWatchError).toHaveBeenCalledWith({
      error: {
        kind: "thread-storage-watch-error",
        message: "watch failed",
        rootPath: "/tmp/bb-data/thread-storage",
      },
    });
  });

  it("keeps the shared thread storage watcher running while other environments still have tracked threads", async () => {
    const stopWatchingPathChanges = vi.fn(() => undefined);
    const { hostWatcher } = createFakeHostWatcher({
      watchThreadStorageRootImplementation: (_args) => stopWatchingPathChanges,
    });
    const provisionWorkspace = createProvisionWorkspaceMock("/tmp/env-a");
    provisionWorkspace
      .mockResolvedValueOnce(createFakeWorkspace("/tmp/env-a"))
      .mockResolvedValueOnce(createFakeWorkspace("/tmp/env-b"));
    const manager = new RuntimeManager({
      hostWatcher,
      provisionWorkspace,
      createRuntime: vi.fn(() => createFakeRuntime()),
      threadStorageRootPath: "/tmp/bb-data/thread-storage",
    });

    await manager.ensureEnvironment({
      environmentId: "env-a",
      workspacePath: "/tmp/env-a",
    });
    await manager.ensureEnvironment({
      environmentId: "env-b",
      workspacePath: "/tmp/env-b",
    });

    manager.markThreadActive("env-a", "thread-a", "provider-a", null);
    manager.markThreadActive("env-b", "thread-b", "provider-b", null);

    await manager.destroyEnvironment("env-a");
    expect(stopWatchingPathChanges).not.toHaveBeenCalled();

    await manager.destroyEnvironment("env-b");
    expect(stopWatchingPathChanges).toHaveBeenCalledTimes(1);
  });

  it("removes stale entries when the provider process exits", async () => {
    const stopWatchingStatus = vi.fn(() => undefined);
    const workspace = createFakeWorkspace("/tmp/env-exit");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (_args) => stopWatchingStatus,
    });
    const runtime = createFakeRuntime();
    let onProcessExit:
      | NonNullable<AgentRuntimeOptions["onProcessExit"]>
      | undefined;
    const manager = new RuntimeManager({
      hostWatcher,
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
    manager.markThreadActive("env-exit", "thread-1", "provider-1", null);

    onProcessExit?.({
      providerId: "fake",
      threadIds: ["thread-1"],
      code: 1,
      expected: false,
      signal: null,
      stderr: null,
    });

    expect(manager.get("env-exit")).toBeUndefined();
    expect(manager.hasThread("env-exit", "thread-1")).toBe(false);
    expect(stopWatchingStatus).toHaveBeenCalledTimes(1);
    expect(runtime.shutdown).not.toHaveBeenCalled();
  });

  it("keeps sibling provider threads running when one provider exits", async () => {
    const stopWatchingStatus = vi.fn(() => undefined);
    const workspace = createFakeWorkspace("/tmp/env-shared");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (_args) => stopWatchingStatus,
    });
    const runtime = createFakeRuntime();
    let runningProviders = ["fake-alpha", "fake-beta"];
    runtime.listRunningProviders.mockImplementation(() => runningProviders);
    let onProcessExit:
      | NonNullable<AgentRuntimeOptions["onProcessExit"]>
      | undefined;
    const manager = new RuntimeManager({
      hostWatcher,
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
    manager.markThreadActive("env-shared", "thread-a", "provider-a", null);
    manager.markThreadActive("env-shared", "thread-b", "provider-b", null);

    runningProviders = ["fake-beta"];
    onProcessExit?.({
      providerId: "fake-alpha",
      threadIds: ["thread-a"],
      code: 1,
      expected: false,
      signal: null,
      stderr: null,
    });

    expect(manager.get("env-shared")).toBeDefined();
    expect(manager.hasThread("env-shared", "thread-a")).toBe(false);
    expect(manager.hasThread("env-shared", "thread-b")).toBe(true);
    expect(stopWatchingStatus).not.toHaveBeenCalled();
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
      threadIds: ["thread-1"],
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

  it("preserves the active turn when thread identity arrives after turn start", async () => {
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
        "/tmp/env-identity-after-turn",
      ).mockResolvedValue(createFakeWorkspace("/tmp/env-identity-after-turn")),
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
      environmentId: "env-identity-after-turn",
      workspacePath: "/tmp/env-identity-after-turn",
    });
    if (!onRuntimeEvent || !onProcessExit) {
      throw new Error("Expected runtime callbacks to be captured");
    }
    onRuntimeEvent({
      type: "turn/started",
      threadId: "thread-1",
      providerThreadId: "provider-before-identity",
      scope: turnScope("turn-1"),
    });
    onRuntimeEvent({
      type: "thread/identity",
      threadId: "thread-1",
      providerThreadId: "provider-after-identity",
      scope: threadScope(),
    });
    emittedEvents.splice(0, emittedEvents.length);

    onProcessExit({
      providerId: "codex",
      threadIds: ["thread-1"],
      code: 1,
      expected: false,
      signal: null,
      stderr: null,
    });

    expect(emittedEvents).toEqual([
      {
        environmentId: "env-identity-after-turn",
        event: {
          type: "turn/completed",
          threadId: "thread-1",
          providerThreadId: "provider-after-identity",
          scope: turnScope("turn-1"),
          status: "failed",
          error: {
            message: 'Provider "codex" exited unexpectedly with code 1',
          },
        },
      },
      {
        environmentId: "env-identity-after-turn",
        event: {
          type: "system/error",
          threadId: "thread-1",
          scope: turnScope("turn-1"),
          code: "provider_process_exited",
          message: 'Provider "codex" exited unexpectedly with code 1',
        },
      },
    ]);
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
      threadIds: ["thread-1"],
      code: null,
      expected: true,
      signal: "SIGTERM",
      stderr: null,
    });

    expect(emittedEvents).toEqual([]);
  });

  it("shuts down all tracked environments", async () => {
    const stopWatchingStatusA = vi.fn(() => undefined);
    const stopWatchingStatusB = vi.fn(() => undefined);
    const workspaceA = createFakeWorkspace("/tmp/env-a");
    const workspaceB = createFakeWorkspace("/tmp/env-b");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: vi
        .fn<WatchWorkspaceImplementation>()
        .mockImplementationOnce((_args) => stopWatchingStatusA)
        .mockImplementationOnce((_args) => stopWatchingStatusB),
    });
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
      hostWatcher,
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
    expect(stopWatchingStatusA).toHaveBeenCalledTimes(1);
    expect(stopWatchingStatusB).toHaveBeenCalledTimes(1);
    // shutdownAll does NOT destroy workspaces — the server owns managed
    // workspace lifecycle via explicit environment.destroy commands
    expect(workspaceA.destroy).not.toHaveBeenCalled();
    expect(workspaceB.destroy).not.toHaveBeenCalled();
  });
});
