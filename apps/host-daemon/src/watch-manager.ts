import { getPersonalWorkspaceRoot } from "@bb/host-workspace";
import {
  provisionWorkspace,
  type HostWorkspace,
  type ProvisionWorkspaceArgs,
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
import { reconnectProvisionArgsFromWorkspaceContext } from "./workspace-provision-target.js";

type StopWatching = () => void | Promise<void>;

const STOP_WATCHING: StopWatching = () => undefined;
const LOCAL_WORKSPACE_WATCH_CHANGE_KINDS: readonly WorkspaceStatusWatchChangeKind[] =
  ["workspace-content-changed", "workspace-git-changed"];

interface WorkspaceWatchState {
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

export interface WatchManagerOptions {
  dataDir?: string;
  hostWatcher?: HostWatcher;
  provisionWorkspace?: (
    options: ProvisionWorkspaceArgs,
  ) => Promise<HostWorkspace>;
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

function workspaceWatchKindsIncludeSharedRefs(
  changeKinds: readonly WorkspaceStatusWatchChangeKind[],
): boolean {
  return changeKinds.includes("shared-git-refs-changed");
}

function sameWorkspaceTarget(
  current: HostDaemonWatchSetWorkspaceTarget,
  next: HostDaemonWatchSetWorkspaceTarget,
): boolean {
  return (
    current.environmentId === next.environmentId &&
    current.workspaceContext.workspacePath ===
      next.workspaceContext.workspacePath &&
    current.workspaceContext.workspaceProvisionType ===
      next.workspaceContext.workspaceProvisionType
  );
}

export class WatchManager {
  private readonly hostWatcher;
  private readonly provisionWorkspace;
  private readonly threadStorageTargets = new Map<
    string,
    HostDaemonWatchSetThreadStorageTarget
  >();
  private readonly workspaceEntries = new Map<string, WorkspaceWatchEntry>();
  private latestAppliedWatchSetGeneration = -1;
  private watchSetMutationTail: Promise<void> = Promise.resolve();
  private stopWatchingThreadStorageRoot: StopWatching = STOP_WATCHING;

  constructor(private readonly options: WatchManagerOptions = {}) {
    this.hostWatcher = options.hostWatcher;
    this.provisionWorkspace = options.provisionWorkspace ?? provisionWorkspace;
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

  async removeEnvironmentWorkspaceWatch(environmentId: string): Promise<void> {
    await this.enqueueWatchSetMutation(async () => {
      await this.removeWorkspaceWatch(environmentId);
    });
  }

  async shutdown(): Promise<void> {
    await this.enqueueWatchSetMutation(async () => {
      const entries = [...this.workspaceEntries.values()];
      this.workspaceEntries.clear();
      this.threadStorageTargets.clear();
      await Promise.all(entries.map((entry) => this.stopWorkspaceWatch(entry)));
      await this.stopThreadStorageWatcher();
    });
  }

  workspaceWatchCount(): number {
    return this.workspaceEntries.size;
  }

  threadStorageWatchTargetCount(): number {
    return this.threadStorageTargets.size;
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
    this.threadStorageTargets.clear();
    for (const target of targets) {
      this.threadStorageTargets.set(target.threadId, target);
    }

    if (this.threadStorageTargets.size > 0) {
      this.ensureThreadStorageWatcher();
      return;
    }
    await this.stopThreadStorageWatcher();
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
      const workspace = await this.provisionWorkspace(
        reconnectProvisionArgsFromWorkspaceContext({
          environmentId: target.environmentId,
          ...(this.options.dataDir
            ? {
                personalWorkspaceRoot: getPersonalWorkspaceRoot(
                  this.options.dataDir,
                ),
              }
            : {}),
          workspaceContext: target.workspaceContext,
        }),
      );
      const watchState = await this.createWorkspaceWatchState(workspace);
      const stopWatchingStatus = this.hostWatcher.watchWorkspace({
        environmentId: target.environmentId,
        workspacePath: workspace.path,
        onChange: (event) => {
          this.queueWorkspaceWatchChange({
            changeKinds: event.changeKinds,
            environmentId: target.environmentId,
            workspace,
            workspacePath: workspace.path,
            workspaceWatchState: watchState,
          });
        },
        onWatchError: (error) => {
          this.options.onWorkspaceStatusWatchError?.({ error });
        },
      });
      this.workspaceEntries.set(target.environmentId, {
        stopWatchingStatus,
        target,
        watchState,
        workspace,
      });
    } catch (error) {
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

  private async createWorkspaceWatchState(
    workspace: HostWorkspace,
  ): Promise<WorkspaceWatchState> {
    if (!workspace.isGitRepo) {
      return {
        lastLocalFingerprint: null,
        lastSharedRefsFingerprint: null,
        pendingKinds: new Set(),
        processing: null,
      };
    }

    const [lastLocalFingerprint, lastSharedRefsFingerprint] = await Promise.all(
      [
        workspace.getLocalStateFingerprint(),
        workspace.getSharedGitRefsFingerprint(),
      ],
    );
    return {
      lastLocalFingerprint,
      lastSharedRefsFingerprint,
      pendingKinds: new Set(),
      processing: null,
    };
  }

  private queueWorkspaceWatchChange(args: {
    changeKinds: readonly WorkspaceStatusWatchChangeKind[];
    environmentId: string;
    workspace: HostWorkspace;
    workspacePath: string;
    workspaceWatchState: WorkspaceWatchState;
  }): void {
    for (const changeKind of args.changeKinds) {
      args.workspaceWatchState.pendingKinds.add(changeKind);
    }
    if (args.workspaceWatchState.processing) {
      return;
    }
    this.flushWorkspaceWatchChanges(args);
  }

  private flushWorkspaceWatchChanges(args: {
    environmentId: string;
    workspace: HostWorkspace;
    workspacePath: string;
    workspaceWatchState: WorkspaceWatchState;
  }): void {
    const processing = this.processWorkspaceWatchChanges(args).finally(() => {
      if (args.workspaceWatchState.processing === processing) {
        args.workspaceWatchState.processing = null;
      }
      if (args.workspaceWatchState.pendingKinds.size > 0) {
        this.flushWorkspaceWatchChanges(args);
      }
    });
    args.workspaceWatchState.processing = processing;
  }

  private async processWorkspaceWatchChanges(args: {
    environmentId: string;
    workspace: HostWorkspace;
    workspacePath: string;
    workspaceWatchState: WorkspaceWatchState;
  }): Promise<void> {
    const pendingKinds = Array.from(args.workspaceWatchState.pendingKinds);
    args.workspaceWatchState.pendingKinds.clear();

    try {
      const changeKinds: HostDaemonEnvironmentChange[] = [];
      if (workspaceWatchKindsIncludeLocalState(pendingKinds)) {
        const nextLocalFingerprint =
          await args.workspace.getLocalStateFingerprint();
        if (
          args.workspaceWatchState.lastLocalFingerprint !== nextLocalFingerprint
        ) {
          args.workspaceWatchState.lastLocalFingerprint = nextLocalFingerprint;
          changeKinds.push("work-status-changed");
        }
      }
      if (workspaceWatchKindsIncludeSharedRefs(pendingKinds)) {
        const nextSharedRefsFingerprint =
          await args.workspace.getSharedGitRefsFingerprint();
        if (
          args.workspaceWatchState.lastSharedRefsFingerprint !==
          nextSharedRefsFingerprint
        ) {
          args.workspaceWatchState.lastSharedRefsFingerprint =
            nextSharedRefsFingerprint;
          changeKinds.push("git-refs-changed");
        }
      }
      if (changeKinds.length === 0) {
        return;
      }
      this.options.onWorkspaceStatusChanged?.({
        changeKinds,
        environmentId: args.environmentId,
      });
    } catch (error) {
      this.options.onWorkspaceStatusWatchError?.({
        error: {
          environmentId: args.environmentId,
          kind: "workspace-watch-error",
          message:
            error instanceof Error
              ? toErrorMessage(error)
              : "Unknown workspace watch error",
          rootPath: args.workspacePath,
        },
      });
    }
  }

  private async stopWorkspaceWatch(entry: WorkspaceWatchEntry): Promise<void> {
    const stopWatchingStatus = entry.stopWatchingStatus;
    entry.stopWatchingStatus = STOP_WATCHING;
    await stopWatchingStatus();
  }

  private async removeWorkspaceWatch(environmentId: string): Promise<void> {
    const entry = this.workspaceEntries.get(environmentId);
    if (!entry) {
      return;
    }
    this.workspaceEntries.delete(environmentId);
    await this.stopWorkspaceWatch(entry);
  }

  private ensureThreadStorageWatcher(): void {
    if (
      !this.hostWatcher ||
      this.stopWatchingThreadStorageRoot !== STOP_WATCHING
    ) {
      return;
    }

    const threadStorageRootPath = this.options.threadStorageRootPath;
    if (!threadStorageRootPath) {
      return;
    }

    this.stopWatchingThreadStorageRoot =
      this.hostWatcher.watchThreadStorageRoot({
        threadStorageRootPath,
        resolveThreadTarget: (threadId) =>
          this.threadStorageTargets.get(threadId) ?? null,
        onChange: (event) => {
          if (event.kind === "thread-storage-changed") {
            this.options.onThreadStorageChanged?.({
              environmentId: event.environmentId,
              threadId: event.threadId,
            });
          }
        },
        onWatchError: (error) => {
          this.options.onThreadStorageWatchError?.({
            error,
          });
        },
      });
  }

  private async stopThreadStorageWatcher(): Promise<void> {
    const stopWatchingThreadStorageRoot = this.stopWatchingThreadStorageRoot;
    this.stopWatchingThreadStorageRoot = STOP_WATCHING;
    await stopWatchingThreadStorageRoot();
  }
}
