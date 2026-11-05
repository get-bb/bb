import path from "node:path";
import type {
  HostWatcher,
  WatchThreadStorageArgs,
  WatchWorkspaceArgs,
  WorkspaceWatchError,
} from "@bb/host-watcher";
import type { HostWorkspace } from "@bb/host-workspace";
import { createDeferredPromise } from "@bb/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { WatchManager, type WatchManagerOptions } from "./watch-manager.js";

type GetLocalStateFingerprintResult = Awaited<
  ReturnType<HostWorkspace["getLocalStateSnapshot"]>
>["fingerprint"];
type GetSharedGitRefsFingerprintResult = string;
type StopWatching = () => void | Promise<void>;
type WatchWorkspaceImplementation = (args: WatchWorkspaceArgs) => StopWatching;
type WatchThreadStorageImplementation = (
  args: WatchThreadStorageArgs,
) => StopWatching;

function createFakeWorkspace(path: string, isGitRepo = true) {
  let currentBranchName: string | null = "main";
  let localStateFingerprint: GetLocalStateFingerprintResult = `local:${path}:initial`;
  let localStateFingerprintError: Error | null = null;
  let sharedGitRefsFingerprint: GetSharedGitRefsFingerprintResult = `refs:${path}:initial`;
  let sharedGitRefsFingerprintError: Error | null = null;
  let branchNamesFingerprint = "names:initial";
  const workspace = {
    path,
    isGitRepo,
    isWorktree: false,
    gitCommonDir: isGitRepo ? `${path}/.git` : null,
    getDefaultBranch: vi.fn(async () => "main"),
    getCurrentBranch: vi.fn<HostWorkspace["getCurrentBranch"]>(
      async () => currentBranchName,
    ),
    getHeadSha: vi.fn(async () => "commit-1"),
    getLocalStateSnapshot: vi.fn(async () => {
      if (localStateFingerprintError) {
        throw localStateFingerprintError;
      }
      return {
        fingerprint: localStateFingerprint,
        branchName: currentBranchName,
      };
    }),
    getSharedGitRefsSnapshot: vi.fn<HostWorkspace["getSharedGitRefsSnapshot"]>(
      async () => {
        if (sharedGitRefsFingerprintError) {
          throw sharedGitRefsFingerprintError;
        }
        return {
          defaultBranch: "main",
          branchNamesFingerprint,
          fingerprintFor: () => sharedGitRefsFingerprint,
        };
      },
    ),
    getAdditionalWorkspaceWriteRoots: vi.fn(async () => []),
    commit: vi.fn(async () => ({
      commitSha: "commit-1",
      commitSubject: "commit",
    })),
    setCurrentBranch(value: string | null) {
      currentBranchName = value;
    },
    setLocalStateFingerprint(value: GetLocalStateFingerprintResult) {
      localStateFingerprint = value;
    },
    setLocalStateFingerprintError(error: Error | null) {
      localStateFingerprintError = error;
    },
    setSharedGitRefsFingerprint(value: GetSharedGitRefsFingerprintResult) {
      sharedGitRefsFingerprint = value;
    },
    setSharedGitRefsFingerprintError(error: Error | null) {
      sharedGitRefsFingerprintError = error;
    },
    setBranchNamesFingerprint(value: string) {
      branchNamesFingerprint = value;
    },
  } satisfies HostWorkspace & {
    setCurrentBranch: (value: string | null) => void;
    setLocalStateFingerprint: (value: GetLocalStateFingerprintResult) => void;
    setLocalStateFingerprintError: (error: Error | null) => void;
    setSharedGitRefsFingerprint: (
      value: GetSharedGitRefsFingerprintResult,
    ) => void;
    setSharedGitRefsFingerprintError: (error: Error | null) => void;
    setBranchNamesFingerprint: (value: string) => void;
  };

  return workspace;
}

function createFakeHostWatcher(
  args: {
    watchThreadStorageImplementation?: WatchThreadStorageImplementation;
    watchWorkspaceImplementation?: WatchWorkspaceImplementation;
  } = {},
) {
  const watchWorkspace = vi.fn<WatchWorkspaceImplementation>(
    args.watchWorkspaceImplementation ?? (() => () => undefined),
  );
  const watchThreadStorage = vi.fn<WatchThreadStorageImplementation>(
    args.watchThreadStorageImplementation ?? (() => () => undefined),
  );
  const hostWatcher = {
    watchWorkspace,
    watchThreadStorage,
  } satisfies HostWatcher;

  return {
    hostWatcher,
    watchThreadStorage,
    watchWorkspace,
  };
}

describe("WatchManager", () => {
  it("starts watching before initial workspace fingerprints finish", async () => {
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const localFingerprint =
      createDeferredPromise<
        Awaited<ReturnType<HostWorkspace["getLocalStateSnapshot"]>>
      >();
    workspace.getLocalStateSnapshot.mockImplementationOnce(
      () => localFingerprint.promise,
    );
    const { hostWatcher, watchWorkspace } = createFakeHostWatcher();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: vi.fn(async () => workspace),
    });

    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: {
            workspacePath: "/tmp/env-watch",
          },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });

    expect(watchWorkspace).toHaveBeenCalledTimes(1);
    expect(workspace.getLocalStateSnapshot).not.toHaveBeenCalled();
    watchWorkspace.mock.calls[0]?.[0].onReady();
    expect(workspace.getLocalStateSnapshot).toHaveBeenCalledTimes(1);

    localFingerprint.resolve({
      fingerprint: "local:/tmp/env-watch:initial",
      branchName: "main",
    });
    await vi.waitFor(() => {
      expect(workspace.getSharedGitRefsSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  it("reconciles live content when the workspace watcher becomes ready", async () => {
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return () => undefined;
      },
    });
    const onWorkspaceStatusChanged = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: vi.fn(async () => workspace),
      onWorkspaceStatusChanged,
    });

    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: {
            workspacePath: "/tmp/env-watch",
          },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });

    watchWorkspaceArgs?.onReady();

    expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
      changeKinds: ["work-status-changed"],
      environmentId: "env-watch",
    });
  });

  it("starts workspace watches from snapshots and stops removed targets", async () => {
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
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: vi.fn(async () => workspace),
      onWorkspaceStatusChanged,
    });

    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: {
            workspacePath: "/tmp/env-watch",
          },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });
    await manager.replaceWatchSet({
      generation: 2,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: {
            workspacePath: "/tmp/env-watch",
          },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });

    workspace.setLocalStateFingerprint("local:/tmp/env-watch:changed");
    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/env-watch/README.md"],
      changeKinds: ["workspace-content-changed"],
      kind: "workspace-status-changed",
      environmentId: "env-watch",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(watchWorkspace).toHaveBeenCalledTimes(1);
    expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
      changeKinds: ["work-status-changed"],
      environmentId: "env-watch",
    });

    await manager.replaceWatchSet({
      generation: 3,
      workspaceTargets: [],
      threadStorageTargets: [],
    });

    expect(stopWatchingStatus).toHaveBeenCalledTimes(1);
  });

  it("reports workspace content changes when the local fingerprint is unchanged", async () => {
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return () => undefined;
      },
    });
    const onWorkspaceStatusChanged = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: vi.fn(async () => workspace),
      onWorkspaceStatusChanged,
    });

    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: {
            workspacePath: "/tmp/env-watch",
          },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });
    watchWorkspaceArgs?.onReady();
    await vi.waitFor(() => {
      expect(workspace.getLocalStateSnapshot).toHaveBeenCalledTimes(1);
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    workspace.getLocalStateSnapshot.mockClear();
    workspace.setLocalStateFingerprintError(new Error("status too large"));

    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/env-watch/README.md"],
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
    expect(workspace.getLocalStateSnapshot).not.toHaveBeenCalled();
  });

  it("refreshes workspace metadata when a plain workspace becomes a git repository", async () => {
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const plainWorkspace = createFakeWorkspace("/tmp/env-watch", false);
    const gitWorkspace = createFakeWorkspace("/tmp/env-watch");
    const provisionWorkspace = vi
      .fn<NonNullable<WatchManagerOptions["provisionWorkspace"]>>()
      .mockResolvedValue(plainWorkspace);
    const refreshWorkspace = vi
      .fn<NonNullable<WatchManagerOptions["refreshWorkspace"]>>()
      .mockResolvedValue(gitWorkspace);
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return () => undefined;
      },
    });
    const onWorkspaceMetadataChanged = vi.fn();
    const onWorkspaceStatusChanged = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace,
      refreshWorkspace,
      onWorkspaceMetadataChanged,
      onWorkspaceStatusChanged,
    });

    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: {
            workspacePath: "/tmp/env-watch",
          },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });
    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/env-watch/file.txt"],
      changeKinds: ["workspace-content-changed"],
      kind: "workspace-status-changed",
      environmentId: "env-watch",
    });
    await vi.waitFor(() => {
      expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
        changeKinds: ["work-status-changed"],
        environmentId: "env-watch",
      });
    });
    expect(provisionWorkspace).toHaveBeenCalledTimes(1);
    expect(refreshWorkspace).not.toHaveBeenCalled();
    expect(onWorkspaceMetadataChanged).not.toHaveBeenCalled();
    onWorkspaceStatusChanged.mockClear();

    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/env-watch/.git"],
      changeKinds: [
        "workspace-content-changed",
        "workspace-git-repository-created",
      ],
      kind: "workspace-status-changed",
      environmentId: "env-watch",
    });

    await vi.waitFor(() => {
      expect(onWorkspaceMetadataChanged).toHaveBeenCalledWith({
        environmentId: "env-watch",
        workspace: {
          path: "/tmp/env-watch",
          isGitRepo: true,
          isWorktree: false,
          branchName: "main",
          defaultBranch: "main",
        },
      });
      expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
        changeKinds: ["work-status-changed"],
        environmentId: "env-watch",
      });
    });
    expect(provisionWorkspace).toHaveBeenCalledTimes(1);
    expect(refreshWorkspace).toHaveBeenCalledTimes(1);
  });

  it("reports branch changes with coalesced content events, clears detached HEAD, and deduplicates metadata", async () => {
    let watch: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-branch");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watch = args;
        return () => undefined;
      },
    });
    const onWorkspaceMetadataChanged = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: async () => workspace,
      onWorkspaceMetadataChanged,
    });
    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-branch",
          workspaceContext: { workspacePath: workspace.path },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });
    watch?.onReady?.();
    await vi.waitFor(() =>
      expect(onWorkspaceMetadataChanged).toHaveBeenCalledTimes(1),
    );
    expect(
      onWorkspaceMetadataChanged.mock.calls[0]?.[0].workspace.branchName,
    ).toBe("main");
    const change = () =>
      watch?.onChange({
        kind: "workspace-status-changed",
        environmentId: "env-branch",
        changeKinds: ["workspace-git-changed", "workspace-content-changed"],
        changedPaths: [
          workspace.path + "/.git/HEAD",
          workspace.path + "/file.txt",
        ],
      });
    workspace.setCurrentBranch("feature/new");
    change();
    await vi.waitFor(() =>
      expect(onWorkspaceMetadataChanged).toHaveBeenCalledTimes(2),
    );
    expect(
      onWorkspaceMetadataChanged.mock.calls[1]?.[0].workspace,
    ).toMatchObject({ branchName: "feature/new", defaultBranch: "main" });
    change();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(onWorkspaceMetadataChanged).toHaveBeenCalledTimes(2);
    workspace.getDefaultBranch.mockResolvedValue("trunk");
    change();
    await vi.waitFor(() =>
      expect(onWorkspaceMetadataChanged).toHaveBeenCalledTimes(3),
    );
    expect(
      onWorkspaceMetadataChanged.mock.calls[2]?.[0].workspace,
    ).toMatchObject({ branchName: "feature/new", defaultBranch: "trunk" });
    workspace.setCurrentBranch(null);
    change();
    await vi.waitFor(() =>
      expect(onWorkspaceMetadataChanged).toHaveBeenCalledTimes(4),
    );
    expect(
      onWorkspaceMetadataChanged.mock.calls[3]?.[0].workspace,
    ).toMatchObject({ branchName: null, defaultBranch: "trunk" });
    await manager.shutdown();
  });

  it("reads shared refs once per common git dir and reports only worktrees whose refs moved", async () => {
    const workspaces = [
      createFakeWorkspace("/tmp/worktree-a"),
      createFakeWorkspace("/tmp/worktree-b"),
    ];
    const watches: WatchWorkspaceArgs[] = [];
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watches.push(args);
        return () => undefined;
      },
    });
    let featureAOid = "a-1";
    const readSharedRefs = vi.fn(async () => ({
      defaultBranch: "main",
      branchNamesFingerprint: "names",
      fingerprintFor: ({ branchName }: { branchName: string | null }) =>
        branchName === "feature/a" ? featureAOid : "unchanged",
    }));
    workspaces[0]!.setCurrentBranch("feature/a");
    workspaces[1]!.setCurrentBranch("feature/b");
    for (const workspace of workspaces) {
      workspace.gitCommonDir = "/tmp/repo/.git";
      workspace.getSharedGitRefsSnapshot.mockImplementation(readSharedRefs);
    }
    const onWorkspaceStatusChanged = vi.fn();
    const onWorkspaceMetadataChanged = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: async ({ path }) =>
        workspaces.find((workspace) => workspace.path === path)!,
      onWorkspaceStatusChanged,
      onWorkspaceMetadataChanged,
    });
    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: workspaces.map((workspace, i) => ({
        environmentId: `env-${i}`,
        workspaceContext: { workspacePath: workspace.path },
        mergeBaseBranch: null,
      })),
      threadStorageTargets: [],
    });
    for (const watch of watches) watch.onReady();
    await vi.waitFor(() =>
      expect(onWorkspaceMetadataChanged).toHaveBeenCalledTimes(2),
    );
    expect(readSharedRefs).toHaveBeenCalledTimes(1);
    onWorkspaceStatusChanged.mockClear();

    featureAOid = "a-2";
    for (const watch of watches) {
      watch.onChange({
        kind: "workspace-status-changed",
        environmentId: watch.environmentId,
        changeKinds: ["shared-git-refs-changed"],
        changedPaths: ["/tmp/repo/.git/refs/heads/feature/a"],
      });
    }
    await vi.waitFor(() =>
      expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
        changeKinds: ["git-refs-changed"],
        environmentId: "env-0",
      }),
    );
    expect(readSharedRefs).toHaveBeenCalledTimes(2);
    expect(onWorkspaceStatusChanged).not.toHaveBeenCalledWith(
      expect.objectContaining({ environmentId: "env-1" }),
    );
    await manager.shutdown();
  });

  it("reports a worktree's merge-base moves and follows merge-base changes without restarting its watch", async () => {
    const workspaces = [
      createFakeWorkspace("/tmp/worktree-a"),
      createFakeWorkspace("/tmp/worktree-b"),
    ];
    const watches: WatchWorkspaceArgs[] = [];
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watches.push(args);
        return () => undefined;
      },
    });
    let baseOid = "base-1";
    const readSharedRefs = vi.fn(async () => ({
      defaultBranch: "main",
      branchNamesFingerprint: "names",
      fingerprintFor: ({
        mergeBaseBranch,
      }: {
        mergeBaseBranch: string | null;
      }) => (mergeBaseBranch === "origin/feature/base" ? baseOid : "unchanged"),
    }));
    workspaces[0]!.setCurrentBranch("feature/a");
    workspaces[1]!.setCurrentBranch("feature/b");
    for (const workspace of workspaces) {
      workspace.gitCommonDir = "/tmp/repo/.git";
      workspace.getSharedGitRefsSnapshot.mockImplementation(readSharedRefs);
    }
    const provisionWorkspace = vi.fn(
      async ({ path }: { path: string }) =>
        workspaces.find((workspace) => workspace.path === path)!,
    );
    const onWorkspaceStatusChanged = vi.fn();
    const onWorkspaceMetadataChanged = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace,
      onWorkspaceStatusChanged,
      onWorkspaceMetadataChanged,
    });
    const watchSet = (
      generation: number,
      mergeBaseBranches: (string | null)[],
    ) => ({
      generation,
      workspaceTargets: workspaces.map((workspace, i) => ({
        environmentId: `env-${i}`,
        workspaceContext: { workspacePath: workspace.path },
        mergeBaseBranch: mergeBaseBranches[i] ?? null,
      })),
      threadStorageTargets: [],
    });
    const moveBase = (oid: string) => {
      baseOid = oid;
      for (const watch of watches) {
        watch.onChange({
          kind: "workspace-status-changed",
          environmentId: watch.environmentId,
          changeKinds: ["shared-git-refs-changed"],
          changedPaths: ["/tmp/repo/.git/refs/remotes/origin/feature/base"],
        });
      }
    };
    const refsChangedEnvironments = () =>
      onWorkspaceStatusChanged.mock.calls
        .filter(([args]) => args.changeKinds.includes("git-refs-changed"))
        .map(([args]) => args.environmentId)
        .sort();

    await manager.replaceWatchSet(watchSet(1, ["origin/feature/base", null]));
    for (const watch of watches) watch.onReady();
    await vi.waitFor(() =>
      expect(onWorkspaceMetadataChanged).toHaveBeenCalledTimes(2),
    );
    onWorkspaceStatusChanged.mockClear();

    moveBase("base-2");
    await vi.waitFor(() =>
      expect(refsChangedEnvironments()).toEqual(["env-0"]),
    );
    onWorkspaceStatusChanged.mockClear();

    await manager.replaceWatchSet(
      watchSet(2, ["origin/feature/base", "origin/feature/base"]),
    );
    await vi.waitFor(() =>
      expect(refsChangedEnvironments()).toEqual(["env-1"]),
    );
    expect(provisionWorkspace).toHaveBeenCalledTimes(2);
    expect(watches).toHaveLength(2);
    onWorkspaceStatusChanged.mockClear();

    moveBase("base-3");
    await vi.waitFor(() =>
      expect(refsChangedEnvironments()).toEqual(["env-0", "env-1"]),
    );
    await manager.shutdown();
  });

  it("reports branch-name changes separately from the worktree's own ref moves", async () => {
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return () => undefined;
      },
    });
    const onWorkspaceStatusChanged = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: vi.fn(async () => workspace),
      onWorkspaceStatusChanged,
    });
    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: { workspacePath: "/tmp/env-watch" },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });
    watchWorkspaceArgs?.onReady();
    await vi.waitFor(() =>
      expect(workspace.getSharedGitRefsSnapshot).toHaveBeenCalledTimes(1),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    onWorkspaceStatusChanged.mockClear();
    const refChange = () =>
      watchWorkspaceArgs?.onChange({
        changedPaths: ["/tmp/env-watch/.git/refs/heads/other"],
        changeKinds: ["shared-git-refs-changed"],
        kind: "workspace-status-changed",
        environmentId: "env-watch",
      });

    workspace.setBranchNamesFingerprint("names:other-created");
    refChange();
    await vi.waitFor(() =>
      expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
        changeKinds: ["git-branches-changed"],
        environmentId: "env-watch",
      }),
    );
    onWorkspaceStatusChanged.mockClear();

    workspace.setSharedGitRefsFingerprint("refs:/tmp/env-watch:moved");
    refChange();
    await vi.waitFor(() =>
      expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
        changeKinds: ["git-refs-changed"],
        environmentId: "env-watch",
      }),
    );
    expect(onWorkspaceStatusChanged).toHaveBeenCalledTimes(1);
    await manager.shutdown();
  });

  it("falls back to each worktree's own ref read when the shared read fails", async () => {
    const workspaces = [
      createFakeWorkspace("/tmp/worktree-a"),
      createFakeWorkspace("/tmp/worktree-b"),
    ];
    const watches: WatchWorkspaceArgs[] = [];
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watches.push(args);
        return () => undefined;
      },
    });
    for (const workspace of workspaces) {
      workspace.gitCommonDir = "/tmp/repo/.git";
    }
    const onWorkspaceStatusChanged = vi.fn();
    const onWorkspaceMetadataChanged = vi.fn();
    const onWorkspaceStatusWatchError = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: async ({ path }) =>
        workspaces.find((workspace) => workspace.path === path)!,
      onWorkspaceStatusChanged,
      onWorkspaceMetadataChanged,
      onWorkspaceStatusWatchError,
    });
    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: workspaces.map((workspace, i) => ({
        environmentId: `env-${i}`,
        workspaceContext: { workspacePath: workspace.path },
        mergeBaseBranch: null,
      })),
      threadStorageTargets: [],
    });
    for (const watch of watches) watch.onReady();
    await vi.waitFor(() =>
      expect(onWorkspaceMetadataChanged).toHaveBeenCalledTimes(2),
    );
    onWorkspaceStatusChanged.mockClear();

    workspaces[0]!.setSharedGitRefsFingerprintError(
      new Error("worktree removed"),
    );
    workspaces[1]!.setSharedGitRefsFingerprint("refs:/tmp/worktree-b:changed");
    for (const watch of watches) {
      watch.onChange({
        kind: "workspace-status-changed",
        environmentId: watch.environmentId,
        changeKinds: ["shared-git-refs-changed"],
        changedPaths: ["/tmp/repo/.git/refs/heads/main"],
      });
    }
    await vi.waitFor(() =>
      expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
        changeKinds: ["git-refs-changed"],
        environmentId: "env-1",
      }),
    );
    await vi.waitFor(() =>
      expect(onWorkspaceStatusWatchError).toHaveBeenCalledTimes(1),
    );
    expect(onWorkspaceStatusWatchError.mock.calls[0]?.[0].error).toMatchObject({
      environmentId: "env-0",
      message: "worktree removed",
    });
    await manager.shutdown();
  });

  it("starts a fresh shared ref read for changes that arrive after a read began", async () => {
    const workspaces = [
      createFakeWorkspace("/tmp/worktree-a"),
      createFakeWorkspace("/tmp/worktree-b"),
    ];
    const watches: WatchWorkspaceArgs[] = [];
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watches.push(args);
        return () => undefined;
      },
    });
    const blockedRead = createDeferredPromise<void>();
    let blockReads = false;
    let fingerprint = "refs-1";
    const readSharedRefs = vi.fn(async () => {
      const value = fingerprint;
      if (blockReads) await blockedRead.promise;
      return {
        defaultBranch: "main",
        branchNamesFingerprint: "names",
        fingerprintFor: () => value,
      };
    });
    for (const workspace of workspaces) {
      workspace.gitCommonDir = "/tmp/repo/.git";
      workspace.getSharedGitRefsSnapshot.mockImplementation(readSharedRefs);
    }
    const onWorkspaceStatusChanged = vi.fn();
    const onWorkspaceMetadataChanged = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: async ({ path }) =>
        workspaces.find((workspace) => workspace.path === path)!,
      onWorkspaceStatusChanged,
      onWorkspaceMetadataChanged,
    });
    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: workspaces.map((workspace, i) => ({
        environmentId: `env-${i}`,
        workspaceContext: { workspacePath: workspace.path },
        mergeBaseBranch: null,
      })),
      threadStorageTargets: [],
    });
    for (const watch of watches) watch.onReady();
    await vi.waitFor(() =>
      expect(onWorkspaceMetadataChanged).toHaveBeenCalledTimes(2),
    );
    onWorkspaceStatusChanged.mockClear();
    const refChange = (watch: WatchWorkspaceArgs) =>
      watch.onChange({
        kind: "workspace-status-changed",
        environmentId: watch.environmentId,
        changeKinds: ["shared-git-refs-changed"],
        changedPaths: ["/tmp/repo/.git/refs/heads/main"],
      });

    blockReads = true;
    refChange(watches[0]!);
    await vi.waitFor(() => expect(readSharedRefs).toHaveBeenCalledTimes(2));
    blockReads = false;
    fingerprint = "refs-2";
    refChange(watches[1]!);
    await vi.waitFor(() => expect(readSharedRefs).toHaveBeenCalledTimes(3));
    await vi.waitFor(() =>
      expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
        changeKinds: ["git-refs-changed"],
        environmentId: "env-1",
      }),
    );
    blockedRead.resolve();
    await manager.shutdown();
  });

  it("reuses shared ref snapshots without rereading each worktree branch", async () => {
    const workspaces = [
      createFakeWorkspace("/tmp/worktree-a"),
      createFakeWorkspace("/tmp/worktree-b"),
    ];
    const watches: WatchWorkspaceArgs[] = [];
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watches.push(args);
        return () => undefined;
      },
    });
    workspaces[0]!.setCurrentBranch("feature/a");
    workspaces[1]!.setCurrentBranch("feature/b");
    const onWorkspaceMetadataChanged = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: async ({ path }) =>
        workspaces.find((workspace) => workspace.path === path)!,
      onWorkspaceMetadataChanged,
    });
    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: workspaces.map((workspace, i) => ({
        environmentId: `env-${i}`,
        workspaceContext: { workspacePath: workspace.path },
        mergeBaseBranch: null,
      })),
      threadStorageTargets: [],
    });
    for (const watch of watches) watch.onReady();
    await vi.waitFor(() =>
      expect(onWorkspaceMetadataChanged).toHaveBeenCalledTimes(2),
    );
    for (const workspace of workspaces) {
      workspace.getSharedGitRefsSnapshot.mockResolvedValue({
        defaultBranch: "trunk",
        branchNamesFingerprint: "names:initial",
        fingerprintFor: () => "shared:trunk",
      });
    }
    for (const watch of watches) {
      watch.onChange({
        kind: "workspace-status-changed",
        environmentId: watch.environmentId,
        changeKinds: ["shared-git-refs-changed"],
        changedPaths: ["/tmp/repo/.git/refs/remotes/origin/HEAD"],
      });
    }
    await vi.waitFor(() =>
      expect(onWorkspaceMetadataChanged).toHaveBeenCalledTimes(4),
    );
    expect(
      onWorkspaceMetadataChanged.mock.calls.slice(2).map(([event]) => ({
        branchName: event.workspace.branchName,
        defaultBranch: event.workspace.defaultBranch,
      })),
    ).toEqual([
      { branchName: "feature/a", defaultBranch: "trunk" },
      { branchName: "feature/b", defaultBranch: "trunk" },
    ]);
    for (const workspace of workspaces) {
      expect(workspace.getCurrentBranch).not.toHaveBeenCalled();
      expect(workspace.getDefaultBranch).not.toHaveBeenCalled();
    }
    await manager.shutdown();
  });

  it("does not publish a branch read after the watch was removed", async () => {
    let watch: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-branch");
    const branch =
      createDeferredPromise<
        Awaited<ReturnType<HostWorkspace["getLocalStateSnapshot"]>>
      >();
    workspace.getLocalStateSnapshot.mockImplementation(() => branch.promise);
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watch = args;
        return () => undefined;
      },
    });
    const onWorkspaceMetadataChanged = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: async () => workspace,
      onWorkspaceMetadataChanged,
    });
    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-branch",
          workspaceContext: { workspacePath: workspace.path },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });
    watch?.onReady?.();
    await vi.waitFor(() =>
      expect(workspace.getLocalStateSnapshot).toHaveBeenCalled(),
    );
    await manager.shutdown();
    branch.resolve({ fingerprint: "stale", branchName: "stale" });
    await branch.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(onWorkspaceMetadataChanged).not.toHaveBeenCalled();
  });

  it("suppresses git metadata notifications when the local fingerprint is unchanged", async () => {
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return () => undefined;
      },
    });
    const onWorkspaceStatusChanged = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: vi.fn(async () => workspace),
      onWorkspaceStatusChanged,
    });

    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: {
            workspacePath: "/tmp/env-watch",
          },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });

    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/env-watch/.git/index"],
      changeKinds: ["workspace-git-changed"],
      kind: "workspace-status-changed",
      environmentId: "env-watch",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onWorkspaceStatusChanged).not.toHaveBeenCalled();
  });

  it("ignores stale watch-set generations", async () => {
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher, watchWorkspace } = createFakeHostWatcher();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: vi.fn(async () => workspace),
    });

    await manager.replaceWatchSet({
      generation: 2,
      workspaceTargets: [],
      threadStorageTargets: [],
    });
    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: {
            workspacePath: "/tmp/env-watch",
          },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });

    expect(watchWorkspace).not.toHaveBeenCalled();
    expect(manager.workspaceWatchCount()).toBe(0);
  });

  it("applies authoritative watch-set snapshots even when generation goes backward", async () => {
    const stopWatchingStatus = vi.fn(() => undefined);
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher, watchWorkspace } = createFakeHostWatcher({
      watchWorkspaceImplementation: () => stopWatchingStatus,
    });
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: vi.fn(async () => workspace),
    });

    await manager.replaceWatchSet({
      generation: 5,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: {
            workspacePath: "/tmp/env-watch",
          },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });

    await manager.replaceAuthoritativeWatchSet({
      generation: 0,
      workspaceTargets: [],
      threadStorageTargets: [],
    });
    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: {
            workspacePath: "/tmp/env-watch",
          },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });

    expect(stopWatchingStatus).toHaveBeenCalledTimes(1);
    expect(watchWorkspace).toHaveBeenCalledTimes(2);
    expect(manager.workspaceWatchCount()).toBe(1);
  });

  it("serializes watch-set replacement while workspace watch startup is pending", async () => {
    const stopWatchingStatus = vi.fn(() => undefined);
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const pendingWorkspace = createDeferredPromise<HostWorkspace>();
    const provisionWorkspace = vi.fn(() => {
      return pendingWorkspace.promise;
    });
    const { hostWatcher, watchWorkspace } = createFakeHostWatcher({
      watchWorkspaceImplementation: () => stopWatchingStatus,
    });
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace,
    });

    const start = manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: {
            workspacePath: "/tmp/env-watch",
          },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });
    const stop = manager.replaceWatchSet({
      generation: 2,
      workspaceTargets: [],
      threadStorageTargets: [],
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(provisionWorkspace).toHaveBeenCalledTimes(1);
    expect(stopWatchingStatus).not.toHaveBeenCalled();

    pendingWorkspace.resolve(workspace);
    await Promise.all([start, stop]);

    expect(watchWorkspace).toHaveBeenCalledTimes(1);
    expect(stopWatchingStatus).toHaveBeenCalledTimes(1);
    expect(manager.workspaceWatchCount()).toBe(0);
  });

  it("reports shared git ref changes from single-dir git watcher events", async () => {
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return () => undefined;
      },
    });
    const onWorkspaceStatusChanged = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: vi.fn(async () => workspace),
      onWorkspaceStatusChanged,
    });

    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: {
            workspacePath: "/tmp/env-watch",
          },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });
    watchWorkspaceArgs?.onReady();
    await vi.waitFor(() =>
      expect(workspace.getSharedGitRefsSnapshot).toHaveBeenCalledTimes(1),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    onWorkspaceStatusChanged.mockClear();
    workspace.setSharedGitRefsFingerprint("refs:/tmp/env-watch:changed");

    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/env-watch/.git/refs/heads/feature"],
      changeKinds: ["workspace-git-changed", "shared-git-refs-changed"],
      kind: "workspace-status-changed",
      environmentId: "env-watch",
    });
    await vi.waitFor(() =>
      expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
        changeKinds: ["git-refs-changed"],
        environmentId: "env-watch",
      }),
    );
  });

  it("reports local fingerprint recomputation failures and recovers on the next change", async () => {
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return () => undefined;
      },
    });
    const onWorkspaceStatusChanged = vi.fn();
    const onWorkspaceStatusWatchError = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: vi.fn(async () => workspace),
      onWorkspaceStatusChanged,
      onWorkspaceStatusWatchError,
    });

    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: {
            workspacePath: "/tmp/env-watch",
          },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });

    watchWorkspaceArgs?.onReady();
    await vi.waitFor(() => {
      expect(workspace.getLocalStateSnapshot).toHaveBeenCalledTimes(1);
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    workspace.getLocalStateSnapshot.mockClear();
    onWorkspaceStatusChanged.mockClear();
    workspace.setLocalStateFingerprintError(new Error("workspace vanished"));
    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/env-watch/.git/index"],
      changeKinds: ["workspace-git-changed"],
      kind: "workspace-status-changed",
      environmentId: "env-watch",
    });
    await vi.waitFor(() =>
      expect(onWorkspaceStatusWatchError).toHaveBeenCalled(),
    );

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
      changedPaths: ["/tmp/env-watch/.git/index"],
      changeKinds: ["workspace-git-changed"],
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
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return () => undefined;
      },
    });
    const onWorkspaceStatusChanged = vi.fn();
    const onWorkspaceStatusWatchError = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: vi.fn(async () => workspace),
      onWorkspaceStatusChanged,
      onWorkspaceStatusWatchError,
    });

    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: {
            workspacePath: "/tmp/env-watch",
          },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
    });

    watchWorkspaceArgs?.onReady();
    await vi.waitFor(() =>
      expect(workspace.getSharedGitRefsSnapshot).toHaveBeenCalledTimes(1),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    onWorkspaceStatusChanged.mockClear();
    workspace.setSharedGitRefsFingerprintError(new Error("refs unavailable"));
    watchWorkspaceArgs?.onChange({
      changedPaths: ["/tmp/shared/.git/refs/heads/main"],
      changeKinds: ["shared-git-refs-changed"],
      kind: "workspace-status-changed",
      environmentId: "env-watch",
    });
    await vi.waitFor(() =>
      expect(onWorkspaceStatusWatchError).toHaveBeenCalled(),
    );

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
    await vi.waitFor(() =>
      expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
        changeKinds: ["git-refs-changed"],
        environmentId: "env-watch",
      }),
    );
  });

  it("forwards workspace watch errors", async () => {
    let watchWorkspaceArgs: WatchWorkspaceArgs | undefined;
    const workspace = createFakeWorkspace("/tmp/env-watch");
    const { hostWatcher } = createFakeHostWatcher({
      watchWorkspaceImplementation: (args) => {
        watchWorkspaceArgs = args;
        return () => undefined;
      },
    });
    const onWorkspaceStatusWatchError = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      provisionWorkspace: vi.fn(async () => workspace),
      onWorkspaceStatusWatchError,
    });

    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: {
            workspacePath: "/tmp/env-watch",
          },
          mergeBaseBranch: null,
        },
      ],
      threadStorageTargets: [],
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
  });

  it("keeps one storage watcher per thread across watch sets and reports the thread", async () => {
    const stopWatching = vi.fn(() => undefined);
    let watchThreadStorageArgs: WatchThreadStorageArgs | undefined;
    const { hostWatcher, watchThreadStorage } = createFakeHostWatcher({
      watchThreadStorageImplementation: (args) => {
        watchThreadStorageArgs = args;
        return stopWatching;
      },
    });
    const onThreadStorageChanged = vi.fn();
    const manager = new WatchManager({
      hostWatcher,
      onThreadStorageChanged,
      threadStorageRootPath: "/tmp/bb-data/thread-storage",
    });

    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [],
      threadStorageTargets: [{ threadId: "thread-1" }],
    });
    await manager.replaceWatchSet({
      generation: 2,
      workspaceTargets: [],
      threadStorageTargets: [{ threadId: "thread-1" }],
    });
    watchThreadStorageArgs?.onChange();

    expect(watchThreadStorage).toHaveBeenCalledTimes(1);
    expect(watchThreadStorageArgs?.threadStoragePath).toBe(
      path.resolve("/tmp/bb-data/thread-storage", "thread-1"),
    );
    expect(onThreadStorageChanged).toHaveBeenCalledWith({
      threadId: "thread-1",
    });

    await manager.replaceWatchSet({
      generation: 3,
      workspaceTargets: [],
      threadStorageTargets: [],
    });
    watchThreadStorageArgs?.onChange();

    expect(stopWatching).toHaveBeenCalledTimes(1);
    expect(onThreadStorageChanged).toHaveBeenCalledTimes(1);
  });

  it("stops only the storage watcher of a removed thread", async () => {
    const stopWatchingByPath = new Map<string, ReturnType<typeof vi.fn>>();
    const { hostWatcher } = createFakeHostWatcher({
      watchThreadStorageImplementation: (args) => {
        const stopWatching = vi.fn(() => undefined);
        stopWatchingByPath.set(args.threadStoragePath, stopWatching);
        return stopWatching;
      },
    });
    const manager = new WatchManager({
      hostWatcher,
      threadStorageRootPath: "/tmp/bb-data/thread-storage",
    });

    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [],
      threadStorageTargets: [
        { threadId: "thread-a" },
        { threadId: "thread-b" },
      ],
    });
    await manager.replaceWatchSet({
      generation: 2,
      workspaceTargets: [],
      threadStorageTargets: [{ threadId: "thread-b" }],
    });

    expect(
      stopWatchingByPath.get(
        path.resolve("/tmp/bb-data/thread-storage", "thread-a"),
      ),
    ).toHaveBeenCalledTimes(1);
    expect(
      stopWatchingByPath.get(
        path.resolve("/tmp/bb-data/thread-storage", "thread-b"),
      ),
    ).not.toHaveBeenCalled();
    expect(manager.threadStorageWatchTargetCount()).toBe(1);
  });

  it("never watches a path outside a single thread's storage directory", async () => {
    const { hostWatcher, watchThreadStorage } = createFakeHostWatcher();
    const manager = new WatchManager({
      hostWatcher,
      threadStorageRootPath: "/tmp/bb-data/thread-storage",
    });

    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [],
      threadStorageTargets: [
        { threadId: "." },
        { threadId: "../escape" },
        { threadId: "nested/thread" },
      ],
    });

    expect(watchThreadStorage).not.toHaveBeenCalled();
  });
});
