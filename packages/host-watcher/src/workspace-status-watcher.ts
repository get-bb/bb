import path from "node:path";
import {
  calculateExponentialBackoffDelay,
  createDebouncedCallbackScheduler,
} from "@bb/domain";
import {
  RootSubscription,
  type ParcelWatcherEventBatch,
} from "./root-subscription.js";
import { pathExists } from "./path-exists.js";
import { toWatchErrorMessage } from "./watch-error.js";
import {
  canonicalizePath,
  collectWorkspaceStatusChanges,
  resolveMetadataWatchSpecs,
  type WatchSubscriptionSpec,
} from "./watch-specs.js";
import {
  WORKSPACE_STATUS_WATCH_CHANGE_KINDS,
  type WorkspaceStatusWatchChangeKind,
  type WorkspaceStatusWatchArgs,
  type WorkspaceStatusWatchError,
} from "./watch-status-types.js";
import { resolveWorkspaceRootIgnores } from "./workspace-root-ignores.js";

const WORKSPACE_STATUS_WATCH_DEBOUNCE_MS = 75;
const WORKSPACE_STATUS_WATCH_MAX_WAIT_MS = 500;
const WORKSPACE_STATUS_WATCH_RETRY_DELAY_MS = 250;
const WORKSPACE_STATUS_WATCH_MAX_RETRY_DELAY_MS = 30_000;
const WORKSPACE_STATUS_WATCH_MAX_SETUP_RETRY_ATTEMPTS = 10;

interface WorkspaceStatusWatcherArgs extends WorkspaceStatusWatchArgs {
  cwd: string;
  debounceMs: number;
  maxRetryDelayMs: number;
  maxWaitMs: number;
  retryDelayMs: number;
}

function createWorkspaceStatusCallbackError(
  cwd: string,
  error: unknown,
): WorkspaceStatusWatchError {
  return {
    message: `Workspace status callback failed: ${toWatchErrorMessage(error)}`,
    rootPath: cwd,
  };
}

function isPathInsideDotGit(cwd: string, candidatePath: string): boolean {
  const relativePath = path.relative(cwd, candidatePath);
  return relativePath === ".git" || relativePath.startsWith(`.git${path.sep}`);
}

class WorkspaceStatusWatcher {
  private readonly changedPaths = new Set<string>();
  private readonly changeKinds = new Set<WorkspaceStatusWatchChangeKind>();
  private disposed = false;
  private gitWorkspace = false;
  private metadataRetryAttempt = 0;
  private metadataStartRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private gitWorkspacePromotion: Promise<void> | null = null;
  private readonly subscriptions = new Map<string, RootSubscription>();
  private readonly changeScheduler;

  constructor(private readonly args: WorkspaceStatusWatcherArgs) {
    this.changeScheduler = createDebouncedCallbackScheduler({
      debounceMs: args.debounceMs,
      maxWaitMs: args.maxWaitMs,
      onFlush: () => {
        if (this.disposed) {
          return;
        }
        try {
          const changedPaths = Array.from(this.changedPaths).sort();
          const changeKinds = Array.from(this.changeKinds);
          this.changedPaths.clear();
          this.changeKinds.clear();
          if (changedPaths.length === 0 || changeKinds.length === 0) {
            return;
          }
          this.args.onChange({
            changedPaths,
            changeKinds,
          });
        } catch (error) {
          this.args.onWatchError(
            createWorkspaceStatusCallbackError(this.args.cwd, error),
          );
        }
      },
    });
  }

  start(): void {
    void this.startAsync();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.changeScheduler.dispose();
    this.changedPaths.clear();
    this.changeKinds.clear();
    if (this.metadataStartRetryTimer !== null) {
      clearTimeout(this.metadataStartRetryTimer);
      this.metadataStartRetryTimer = null;
    }
    await Promise.all(
      [...this.subscriptions.values()].map((subscription) =>
        subscription.dispose(),
      ),
    );
    this.subscriptions.clear();
  }

  private async startAsync(): Promise<void> {
    const rootPath = await canonicalizePath(this.args.cwd);
    if (this.disposed) {
      return;
    }
    this.gitWorkspace = await pathExists(path.join(this.args.cwd, ".git"));
    this.startWorkspaceRootWatchSubscription(rootPath);
    if (this.gitWorkspace) {
      this.startMetadataWatchSubscriptions();
    }
  }

  private startWorkspaceRootWatchSubscription(rootPath: string): void {
    void this.startWorkspaceRootWatchSubscriptionAsync(rootPath);
  }

  private async startWorkspaceRootWatchSubscriptionAsync(
    rootPath: string,
  ): Promise<void> {
    if (this.disposed || this.subscriptions.has(rootPath)) {
      return;
    }
    const { failures, ignore } = await resolveWorkspaceRootIgnores({
      cwd: this.args.cwd,
      gitRoot: this.gitWorkspace,
    });
    if (this.disposed) {
      return;
    }
    for (const failure of failures) {
      this.args.onWatchError({
        message: `Workspace root ignore discovery failed: ${failure}`,
        rootPath,
      });
    }
    this.startWatchSubscription({
      kind: "workspace-root",
      options: { ignore },
      rootPath,
    });
  }

  private startWatchSubscription(spec: WatchSubscriptionSpec): void {
    if (this.disposed || this.subscriptions.has(spec.rootPath)) {
      return;
    }
    const subscription = new RootSubscription({
      rootPath: spec.rootPath,
      subscribeOptions: spec.options,
      retryDelayMs: this.args.retryDelayMs,
      maxRetryDelayMs: this.args.maxRetryDelayMs,
      onEvents: (events) => {
        this.handleWorkspaceEvents(spec, events);
      },
      onReady: spec.kind === "workspace-root" ? this.args.onReady : undefined,
      onDroppedEvents: () => {
        this.queueConservativeWorkspaceStatusChange(spec);
      },
      onWatchError: (message) => {
        this.args.onWatchError({ message, rootPath: spec.rootPath });
      },
    });
    this.subscriptions.set(spec.rootPath, subscription);
    subscription.start();
  }

  private handleWorkspaceEvents(
    spec: WatchSubscriptionSpec,
    events: ParcelWatcherEventBatch,
  ): void {
    if (events.length === 0) {
      return;
    }
    const changeEvent = collectWorkspaceStatusChanges({ events, spec });
    if (!changeEvent) {
      return;
    }
    for (const changedPath of changeEvent.changedPaths) {
      this.changedPaths.add(changedPath);
    }
    for (const changeKind of changeEvent.changeKinds) {
      this.changeKinds.add(changeKind);
    }
    const repositoryCreated =
      spec.kind === "workspace-root" &&
      spec.options?.ignore?.includes(".git") !== true &&
      changeEvent.changedPaths.some((changedPath) =>
        isPathInsideDotGit(spec.rootPath, changedPath),
      );
    if (repositoryCreated) {
      this.changeKinds.add("workspace-git-repository-created");
      this.promoteToGitWorkspace(spec.rootPath);
    }
    this.changeScheduler.schedule();
  }

  private promoteToGitWorkspace(rootPath: string): void {
    if (
      this.disposed ||
      this.gitWorkspace ||
      this.gitWorkspacePromotion !== null
    ) {
      return;
    }
    const promotion = this.promoteToGitWorkspaceAsync(rootPath).finally(() => {
      if (this.gitWorkspacePromotion === promotion) {
        this.gitWorkspacePromotion = null;
      }
    });
    this.gitWorkspacePromotion = promotion;
  }

  private async promoteToGitWorkspaceAsync(rootPath: string): Promise<void> {
    if (!(await pathExists(path.join(this.args.cwd, ".git")))) {
      return;
    }
    const initialRootSubscription = this.subscriptions.get(rootPath);
    if (initialRootSubscription) {
      this.subscriptions.delete(rootPath);
      await initialRootSubscription.dispose();
    }
    if (this.disposed) {
      return;
    }
    this.gitWorkspace = true;
    this.startWorkspaceRootWatchSubscription(rootPath);
    this.startMetadataWatchSubscriptions();
  }

  private queueConservativeWorkspaceStatusChange(
    spec: WatchSubscriptionSpec,
  ): void {
    this.changedPaths.add(spec.rootPath);
    for (const changeKind of WORKSPACE_STATUS_WATCH_CHANGE_KINDS) {
      this.changeKinds.add(changeKind);
    }
    this.changeScheduler.schedule();
  }

  private scheduleMetadataWatchRetry(): void {
    if (this.disposed || this.metadataStartRetryTimer !== null) {
      return;
    }
    if (
      this.metadataRetryAttempt >=
      WORKSPACE_STATUS_WATCH_MAX_SETUP_RETRY_ATTEMPTS
    ) {
      this.args.onWatchError({
        message: `Workspace metadata watch setup failed ${this.metadataRetryAttempt} times (the worktree may have been deleted); giving up until the watch is reconfigured`,
        rootPath: this.args.cwd,
      });
      return;
    }
    this.metadataRetryAttempt += 1;
    this.metadataStartRetryTimer = setTimeout(
      () => {
        this.metadataStartRetryTimer = null;
        this.startMetadataWatchSubscriptions();
      },
      calculateExponentialBackoffDelay({
        attempt: this.metadataRetryAttempt,
        baseDelayMs: this.args.retryDelayMs,
        maxDelayMs: this.args.maxRetryDelayMs,
      }),
    );
  }

  private startMetadataWatchSubscriptions(
    metadataSpecs?: WatchSubscriptionSpec[] | null,
  ): void {
    void this.startMetadataWatchSubscriptionsAsync(metadataSpecs);
  }

  private async startMetadataWatchSubscriptionsAsync(
    metadataSpecs?: WatchSubscriptionSpec[] | null,
  ): Promise<void> {
    try {
      const resolvedMetadataSpecs =
        metadataSpecs ?? (await resolveMetadataWatchSpecs(this.args.cwd));
      if (this.disposed) {
        return;
      }
      if (!resolvedMetadataSpecs) {
        this.scheduleMetadataWatchRetry();
        return;
      }
      this.metadataRetryAttempt = 0;
      for (const spec of resolvedMetadataSpecs) {
        this.startWatchSubscription(spec);
      }
    } catch {
      if (this.disposed) {
        return;
      }
      this.scheduleMetadataWatchRetry();
    }
  }
}

export function createWorkspaceStatusWatcher(
  args: WorkspaceStatusWatchArgs & { cwd: string },
): WorkspaceStatusWatcher {
  return new WorkspaceStatusWatcher({
    cwd: args.cwd,
    debounceMs: WORKSPACE_STATUS_WATCH_DEBOUNCE_MS,
    maxRetryDelayMs: WORKSPACE_STATUS_WATCH_MAX_RETRY_DELAY_MS,
    maxWaitMs: WORKSPACE_STATUS_WATCH_MAX_WAIT_MS,
    onChange: args.onChange,
    onReady: args.onReady,
    onWatchError: args.onWatchError,
    retryDelayMs: WORKSPACE_STATUS_WATCH_RETRY_DELAY_MS,
  });
}
