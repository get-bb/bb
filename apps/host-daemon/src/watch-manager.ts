import path from "node:path";
import type { DiscoveredWorkspaceProperties } from "@bb/domain";
import {
  provisionWorkspace,
  type HostWorkspace,
  type LocalStateSnapshot,
  type ProvisionWorkspaceArgs,
  type SharedGitRefsSnapshot,
} from "@bb/host-workspace";
import type {
  HostDaemonEnvironmentChange,
  HostDaemonWatchSet,
  HostDaemonWatchSetThreadStorageTarget,
  HostDaemonWatchSetWorkspaceTarget,
} from "@bb/host-daemon-contract";
import type {
  HostWatcher,
  ThreadStorageWatchError,
  WorkspaceStatusWatchChangeKind,
  WorkspaceWatchError,
} from "@bb/host-watcher";
import { userExecutableProcessOptions } from "./user-executable-env.js";

type StopWatching = () => void | Promise<void>;

const STOP_WATCHING: StopWatching = () => undefined;
const LOCAL_WORKSPACE_WATCH_CHANGE_KINDS: readonly WorkspaceStatusWatchChangeKind[] =
  [
    "workspace-content-changed",
    "workspace-git-changed",
    "workspace-git-repository-created",
  ];

interface WorkspaceWatchState {
  lastBranchName: string | null | undefined;
  lastDefaultBranch: string | null | undefined;
  lastLocalFingerprint: string | null;
  lastSharedRefsFingerprint: string | null;
  pendingKinds: Set<WorkspaceStatusWatchChangeKind>;
  processing: Promise<void> | null;
}

interface WorkspaceWatchEntry {
  stopWatchingStatus: StopWatching;
  target: HostDaemonWatchSetWorkspaceTarget;
  watchState: WorkspaceWatchState;
  workspace: HostWorkspace;
}

interface ThreadStorageWatchEntry {
  stopWatching: StopWatching;
  target: HostDaemonWatchSetThreadStorageTarget;
}

interface RefreshWorkspaceArgs {
  environmentId: string;
  provision: ProvisionWorkspaceArgs;
  workspacePath: string;
}

export interface WatchManagerOptions {
  hostWatcher?: HostWatcher;
  provisionWorkspace?: (
    options: ProvisionWorkspaceArgs,
  ) => Promise<HostWorkspace>;
  refreshWorkspace?: (args: RefreshWorkspaceArgs) => Promise<HostWorkspace>;
  shellEnv?: () => NodeJS.ProcessEnv;
  threadStorageRootPath?: string | null;
  onThreadStorageChanged?: (args: {
    environmentId: string;
    threadId: string;
  }) => void;
  onThreadStorageWatchError?: (args: {
    error: ThreadStorageWatchError;
  }) => void;
  onWorkspaceStatusChanged?: (args: {
    changeKinds: HostDaemonEnvironmentChange[];
    environmentId: string;
  }) => void;
  onWorkspaceMetadataChanged?: (args: {
    environmentId: string;
    workspace: DiscoveredWorkspaceProperties;
  }) => void;
  onWorkspaceStatusWatchError?: (args: { error: WorkspaceWatchError }) => void;
}

function toErrorMessage(error: Error): string {
  return error.message.trim().length > 0
    ? error.message
    : "Unknown workspace watch error";
}

function workspaceWatchKindsIncludeLocalState(
  changeKinds: readonly WorkspaceStatusWatchChangeKind[],
): boolean {
  return changeKinds.some((changeKind) =>
    LOCAL_WORKSPACE_WATCH_CHANGE_KINDS.includes(changeKind),
  );
}

function sameWorkspaceTarget(
  current: HostDaemonWatchSetWorkspaceTarget,
  next: HostDaemonWatchSetWorkspaceTarget,
): boolean {
  return (
    current.environmentId === next.environmentId &&
    current.workspaceContext.workspacePath ===
      next.workspaceContext.workspacePath
  );
}

export class WatchManager {
  private readonly hostWatcher;
  private readonly provisionWorkspace;
  private readonly refreshWorkspace;
  private readonly threadStorageEntries = new Map<
    string,
    ThreadStorageWatchEntry
  >();
  private readonly workspaceEntries = new Map<string, WorkspaceWatchEntry>();
  private latestAppliedWatchSetGeneration = -1;
  private watchSetMutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: WatchManagerOptions = {}) {
    this.hostWatcher = options.hostWatcher;
    const provision = options.provisionWorkspace ?? provisionWorkspace;
    this.provisionWorkspace = (args: ProvisionWorkspaceArgs) =>
      provision({
        ...args,
        ...userExecutableProcessOptions(options.shellEnv?.() ?? {}),
      });
    this.refreshWorkspace =
      options.refreshWorkspace ??
      ((args: RefreshWorkspaceArgs) => this.provisionWorkspace(args.provision));
  }

  async replaceWatchSet(watchSet: HostDaemonWatchSet): Promise<void> {
    await this.enqueueWatchSetMutation(async () => {
      if (watchSet.generation <= this.latestAppliedWatchSetGeneration) {
        return;
      }
      await this.applyWatchSet(watchSet);
    });
  }

  async replaceAuthoritativeWatchSet(
    watchSet: HostDaemonWatchSet,
  ): Promise<void> {
    await this.enqueueWatchSetMutation(async () => {
      await this.applyWatchSet(watchSet);
    });
  }

  async shutdown(): Promise<void> {
    await this.enqueueWatchSetMutation(async () => {
      const entries = [...this.workspaceEntries.values()];
      const threadStorageEntries = [...this.threadStorageEntries.values()];
      this.workspaceEntries.clear();
      this.threadStorageEntries.clear();
      await Promise.all([
        ...entries.map((entry) => this.stopWorkspaceWatch(entry)),
        ...threadStorageEntries.map((entry) => entry.stopWatching()),
      ]);
    });
  }

  workspaceWatchCount(): number {
    return this.workspaceEntries.size;
  }

  threadStorageWatchTargetCount(): number {
    return this.threadStorageEntries.size;
  }

  private async replaceWorkspaceTargets(
    targets: readonly HostDaemonWatchSetWorkspaceTarget[],
  ): Promise<void> {
    const nextTargets = new Map<string, HostDaemonWatchSetWorkspaceTarget>();
    for (const target of targets) {
      nextTargets.set(target.environmentId, target);
    }

    const stops: Promise<void>[] = [];
    for (const [environmentId, entry] of this.workspaceEntries) {
      const nextTarget = nextTargets.get(environmentId);
      if (nextTarget && sameWorkspaceTarget(entry.target, nextTarget)) {
        nextTargets.delete(environmentId);
        continue;
      }
      this.workspaceEntries.delete(environmentId);
      stops.push(this.stopWorkspaceWatch(entry));
    }
    await Promise.all(stops);

    for (const target of nextTargets.values()) {
      await this.startWorkspaceWatch(target);
    }
  }

  private async replaceThreadStorageTargets(
    targets: readonly HostDaemonWatchSetThreadStorageTarget[],
  ): Promise<void> {
    const nextTargets = new Map<
      string,
      HostDaemonWatchSetThreadStorageTarget
    >();
    for (const target of targets) {
      nextTargets.set(target.threadId, target);
    }

    const stops: (void | Promise<void>)[] = [];
    for (const [threadId, entry] of this.threadStorageEntries) {
      const nextTarget = nextTargets.get(threadId);
      if (nextTarget) {
        entry.target = nextTarget;
        nextTargets.delete(threadId);
        continue;
      }
      this.threadStorageEntries.delete(threadId);
      stops.push(entry.stopWatching());
    }
    await Promise.all(stops);

    for (const target of nextTargets.values()) {
      this.startThreadStorageWatch(target);
    }
  }

  private enqueueWatchSetMutation(work: () => Promise<void>): Promise<void> {
    const next = this.watchSetMutationTail.then(work, work);
    this.watchSetMutationTail = next.catch(() => undefined);
    return next;
  }

  private async applyWatchSet(watchSet: HostDaemonWatchSet): Promise<void> {
    await this.replaceWorkspaceTargets(watchSet.workspaceTargets);
    await this.replaceThreadStorageTargets(watchSet.threadStorageTargets);
    this.latestAppliedWatchSetGeneration = watchSet.generation;
  }

  private async startWorkspaceWatch(
    target: HostDaemonWatchSetWorkspaceTarget,
  ): Promise<void> {
    if (!this.hostWatcher) {
      return;
    }

    try {
      const workspace = await this.provisionWorkspace({
        path: target.workspaceContext.workspacePath,
      });
      const entry: WorkspaceWatchEntry = {
        stopWatchingStatus: STOP_WATCHING,
        target,
        watchState: {
          lastBranchName: undefined,
          lastDefaultBranch: undefined,
          lastLocalFingerprint: null,
          lastSharedRefsFingerprint: null,
          pendingKinds: new Set(),
          processing: null,
        },
        workspace,
      };
      this.workspaceEntries.set(target.environmentId, entry);
      entry.stopWatchingStatus = this.hostWatcher.watchWorkspace({
        environmentId: target.environmentId,
        workspacePath: workspace.path,
        onChange: (event) => {
          this.queueWorkspaceWatchChange({
            changeKinds: event.changeKinds,
            entry,
          });
        },
        onReady: () => {
          this.queueWorkspaceWatchChange({
            changeKinds: ["workspace-content-changed"],
            entry,
          });
        },
        onWatchError: (error) => {
          this.options.onWorkspaceStatusWatchError?.({ error });
        },
      });
    } catch (error) {
      this.workspaceEntries.delete(target.environmentId);
      this.options.onWorkspaceStatusWatchError?.({
        error: {
          environmentId: target.environmentId,
          kind: "workspace-watch-error",
          message:
            error instanceof Error
              ? toErrorMessage(error)
              : "Unknown workspace watch error",
          rootPath: target.workspaceContext.workspacePath,
        },
      });
    }
  }

  private queueWorkspaceWatchChange(args: {
    changeKinds: readonly WorkspaceStatusWatchChangeKind[];
    entry: WorkspaceWatchEntry;
  }): void {
    if (
      this.workspaceEntries.get(args.entry.target.environmentId) !== args.entry
    ) {
      return;
    }
    if (args.changeKinds.includes("workspace-content-changed")) {
      this.options.onWorkspaceStatusChanged?.({
        changeKinds: ["work-status-changed"],
        environmentId: args.entry.target.environmentId,
      });
    }
    for (const changeKind of args.changeKinds) {
      args.entry.watchState.pendingKinds.add(changeKind);
    }
    if (args.entry.watchState.processing) {
      return;
    }
    this.flushWorkspaceWatchChanges(args);
  }

  private flushWorkspaceWatchChanges(args: {
    entry: WorkspaceWatchEntry;
  }): void {
    const processing = this.processWorkspaceWatchChanges(args).finally(() => {
      if (args.entry.watchState.processing === processing) {
        args.entry.watchState.processing = null;
      }
      if (args.entry.watchState.pendingKinds.size > 0) {
        this.flushWorkspaceWatchChanges(args);
      }
    });
    args.entry.watchState.processing = processing;
  }

  private async processWorkspaceWatchChanges(args: {
    entry: WorkspaceWatchEntry;
  }): Promise<void> {
    const pendingKinds = Array.from(args.entry.watchState.pendingKinds);
    args.entry.watchState.pendingKinds.clear();

    try {
      const changeKinds: HostDaemonEnvironmentChange[] = [];
      let localState: LocalStateSnapshot | undefined;
      let sharedRefs: SharedGitRefsSnapshot | undefined;
      if (
        args.entry.workspace.isGitRepo &&
        args.entry.watchState.lastBranchName === undefined
      ) {
        [localState, sharedRefs] = await Promise.all([
          args.entry.workspace.getLocalStateSnapshot(),
          args.entry.workspace.getSharedGitRefsSnapshot(),
        ]);
        if (
          this.workspaceEntries.get(args.entry.target.environmentId) !==
          args.entry
        )
          return;
        args.entry.watchState.lastLocalFingerprint = localState.fingerprint;
        args.entry.watchState.lastSharedRefsFingerprint =
          sharedRefs.fingerprint;
      }
      if (workspaceWatchKindsIncludeLocalState(pendingKinds)) {
        if (
          pendingKinds.includes("workspace-git-repository-created") &&
          !args.entry.workspace.isGitRepo
        ) {
          await this.refreshGitWorkspaceMetadata(args.entry);
        }
        const workspaceContentChanged = pendingKinds.includes(
          "workspace-content-changed",
        );
        if (args.entry.workspace.isGitRepo && !workspaceContentChanged) {
          localState ??= await args.entry.workspace.getLocalStateSnapshot();
          const nextLocalFingerprint = localState.fingerprint;
          if (
            args.entry.watchState.lastLocalFingerprint !== nextLocalFingerprint
          ) {
            args.entry.watchState.lastLocalFingerprint = nextLocalFingerprint;
            changeKinds.push("work-status-changed");
          }
        }
      }
      if (
        args.entry.workspace.isGitRepo &&
        pendingKinds.includes("shared-git-refs-changed")
      ) {
        sharedRefs ??= await args.entry.workspace.getSharedGitRefsSnapshot();
        const nextSharedRefsFingerprint = sharedRefs.fingerprint;
        if (
          args.entry.watchState.lastSharedRefsFingerprint !==
          nextSharedRefsFingerprint
        ) {
          args.entry.watchState.lastSharedRefsFingerprint =
            nextSharedRefsFingerprint;
          changeKinds.push("git-refs-changed");
        }
      }
      if (
        this.workspaceEntries.get(args.entry.target.environmentId) !==
        args.entry
      )
        return;
      if (changeKinds.length > 0) {
        this.options.onWorkspaceStatusChanged?.({
          changeKinds,
          environmentId: args.entry.target.environmentId,
        });
      }
      if (
        args.entry.workspace.isGitRepo &&
        (args.entry.watchState.lastBranchName === undefined ||
          pendingKinds.includes("workspace-git-changed") ||
          pendingKinds.includes("shared-git-refs-changed"))
      ) {
        await this.reportCurrentBranch(
          args.entry,
          pendingKinds.includes("workspace-git-changed"),
          sharedRefs,
          localState,
        );
      }
    } catch (error) {
      this.reportWorkspaceWatchError(args.entry, error);
    }
  }

  private async reportCurrentBranch(
    entry: WorkspaceWatchEntry,
    localGitChanged: boolean,
    sharedRefs: SharedGitRefsSnapshot | undefined,
    localState: LocalStateSnapshot | undefined,
  ): Promise<void> {
    const [branchName, resolvedDefaultBranch] = await Promise.all([
      localState !== undefined
        ? localState.branchName
        : localGitChanged || entry.watchState.lastBranchName === undefined
          ? entry.workspace.getCurrentBranch()
          : entry.watchState.lastBranchName,
      sharedRefs === undefined
        ? entry.workspace.getDefaultBranch()
        : sharedRefs.defaultBranch,
    ]);
    const defaultBranch = resolvedDefaultBranch ?? branchName;
    if (
      this.workspaceEntries.get(entry.target.environmentId) !== entry ||
      (entry.watchState.lastBranchName === branchName &&
        entry.watchState.lastDefaultBranch === defaultBranch)
    )
      return;
    entry.watchState.lastBranchName = branchName;
    entry.watchState.lastDefaultBranch = defaultBranch;
    this.options.onWorkspaceMetadataChanged?.({
      environmentId: entry.target.environmentId,
      workspace: {
        path: entry.workspace.path,
        isGitRepo: true,
        isWorktree: entry.workspace.isWorktree,
        branchName,
        defaultBranch,
      },
    });
  }

  private reportWorkspaceWatchError(
    entry: WorkspaceWatchEntry,
    error: unknown,
  ): void {
    this.options.onWorkspaceStatusWatchError?.({
      error: {
        environmentId: entry.target.environmentId,
        kind: "workspace-watch-error",
        message:
          error instanceof Error
            ? toErrorMessage(error)
            : "Unknown workspace watch error",
        rootPath: entry.target.workspaceContext.workspacePath,
      },
    });
  }

  private async refreshGitWorkspaceMetadata(
    entry: WorkspaceWatchEntry,
  ): Promise<void> {
    if (entry.workspace.isGitRepo) {
      return;
    }
    const provision = { path: entry.target.workspaceContext.workspacePath };
    const workspace = await this.refreshWorkspace({
      environmentId: entry.target.environmentId,
      provision,
      workspacePath: entry.target.workspaceContext.workspacePath,
    });
    if (!workspace.isGitRepo) {
      return;
    }

    const [branchName, resolvedDefaultBranch, sharedRefsFingerprint] =
      await Promise.all([
        workspace.getCurrentBranch(),
        workspace.getDefaultBranch(),
        workspace.getSharedGitRefsSnapshot(),
      ]);
    if (this.workspaceEntries.get(entry.target.environmentId) !== entry) return;
    entry.workspace = workspace;
    entry.watchState.lastBranchName = branchName;
    entry.watchState.lastDefaultBranch = resolvedDefaultBranch ?? branchName;
    entry.watchState.lastSharedRefsFingerprint =
      sharedRefsFingerprint.fingerprint;
    this.options.onWorkspaceMetadataChanged?.({
      environmentId: entry.target.environmentId,
      workspace: {
        path: workspace.path,
        isGitRepo: true,
        isWorktree: workspace.isWorktree,
        branchName,
        defaultBranch: resolvedDefaultBranch ?? branchName,
      },
    });
  }

  private async stopWorkspaceWatch(entry: WorkspaceWatchEntry): Promise<void> {
    const stopWatchingStatus = entry.stopWatchingStatus;
    entry.stopWatchingStatus = STOP_WATCHING;
    await stopWatchingStatus();
  }

  private startThreadStorageWatch(
    target: HostDaemonWatchSetThreadStorageTarget,
  ): void {
    const entry: ThreadStorageWatchEntry = {
      stopWatching: STOP_WATCHING,
      target,
    };
    this.threadStorageEntries.set(target.threadId, entry);

    const threadStorageRootPath = this.options.threadStorageRootPath;
    if (!this.hostWatcher || !threadStorageRootPath) {
      return;
    }
    const threadStoragePath = path.resolve(
      threadStorageRootPath,
      target.threadId,
    );
    if (
      path.dirname(threadStoragePath) !== path.resolve(threadStorageRootPath)
    ) {
      return;
    }

    entry.stopWatching = this.hostWatcher.watchThreadStorage({
      threadStoragePath,
      onChange: () => {
        if (this.threadStorageEntries.get(entry.target.threadId) !== entry) {
          return;
        }
        this.options.onThreadStorageChanged?.({
          environmentId: entry.target.environmentId,
          threadId: entry.target.threadId,
        });
      },
      onWatchError: (error) => {
        this.options.onThreadStorageWatchError?.({
          error,
        });
      },
    });
  }
}
