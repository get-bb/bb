import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { calculateExponentialBackoffDelay } from "@bb/domain";
import {
  RootSubscription,
  type ParcelWatcherEventBatch,
} from "./root-subscription.js";
import { createDebouncedCallbackScheduler } from "./watch-callback-scheduler.js";
import { pathExists } from "./path-exists.js";
import {
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

const WORKSPACE_STATUS_WATCH_DEBOUNCE_MS = 75;
const WORKSPACE_STATUS_WATCH_MAX_WAIT_MS = 500;
const WORKSPACE_STATUS_WATCH_RETRY_DELAY_MS = 250;
const WORKSPACE_STATUS_WATCH_MAX_RETRY_DELAY_MS = 30_000;
// Setup runs `git` (ignore discovery, metadata resolution). When a worktree is
// deleted out from under us, that git command fails every time, so without a
// cap we re-spawn git forever. Give up after a bounded number of attempts; the
// server recreates this watch (resetting the count) when the watch set changes.
const WORKSPACE_STATUS_WATCH_MAX_SETUP_RETRY_ATTEMPTS = 10;
const WORKSPACE_ROOT_ALWAYS_IGNORED_PATHS = [".git"];
const WORKSPACE_ROOT_IGNORE_STATUS_TIMEOUT_MS = 5_000;
const WORKSPACE_ROOT_IGNORE_STATUS_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

interface WorkspaceStatusWatcherArgs extends WorkspaceStatusWatchArgs {
  cwd: string;
  debounceMs: number;
  maxRetryDelayMs: number;
  maxWaitMs: number;
  retryDelayMs: number;
}

interface GitStatusCommandArgs {
  cwd: string;
}

interface GitStatusCommandResult {
  stdout: string;
}

interface WorkspaceRootWatchSpecArgs {
  cwd: string;
  rootPath: string;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown watch error";
}

function runGitIgnoredMatchingStatus(
  args: GitStatusCommandArgs,
): Promise<GitStatusCommandResult> {
  return new Promise<GitStatusCommandResult>((resolve, reject) => {
    execFile(
      "git",
      [
        "--no-optional-locks",
        "status",
        "--porcelain=v1",
        "-z",
        "--ignored=matching",
        "--untracked-files=normal",
      ],
      {
        cwd: args.cwd,
        encoding: "utf8",
        maxBuffer: WORKSPACE_ROOT_IGNORE_STATUS_MAX_BUFFER_BYTES,
        timeout: WORKSPACE_ROOT_IGNORE_STATUS_TIMEOUT_MS,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout });
      },
    );
  });
}

function collectIgnoredDirectoryPaths(statusOutput: string): string[] {
  const ignoredDirectoryPaths = new Set<string>();
  for (const record of statusOutput.split("\0")) {
    if (!record.startsWith("!! ")) {
      continue;
    }
    const ignoredPath = record.slice("!! ".length);
    if (!ignoredPath.endsWith("/")) {
      continue;
    }
    ignoredDirectoryPaths.add(ignoredPath.replace(/\/+$/u, ""));
  }
  return Array.from(ignoredDirectoryPaths).sort();
}

function mergeWorkspaceRootIgnores(gitIgnoredPaths: string[]): string[] {
  const ignoredPaths = new Set<string>();
  for (const ignoredPath of [
    ...WORKSPACE_ROOT_ALWAYS_IGNORED_PATHS,
    ...gitIgnoredPaths,
  ]) {
    ignoredPaths.add(ignoredPath);
  }
  return Array.from(ignoredPaths);
}

async function resolveWorkspaceRootIgnores(cwd: string): Promise<string[]> {
  const status = await runGitIgnoredMatchingStatus({ cwd });
  return mergeWorkspaceRootIgnores(collectIgnoredDirectoryPaths(status.stdout));
}

function createWorkspaceStatusCallbackError(
  cwd: string,
  error: unknown,
): WorkspaceStatusWatchError {
  return {
    message: `Workspace status callback failed: ${toErrorMessage(error)}`,
    rootPath: cwd,
  };
}

async function createWorkspaceRootWatchSpec(
  args: WorkspaceRootWatchSpecArgs,
): Promise<WatchSubscriptionSpec> {
  return {
    kind: "workspace-root",
    options: {
      ignore: await resolveWorkspaceRootIgnores(args.cwd),
    },
    rootPath: args.rootPath,
  };
}

async function resolveWatchRootPath(rootPath: string): Promise<string> {
  try {
    return await fs.realpath(rootPath);
  } catch {
    return rootPath;
  }
}

export class WorkspaceStatusWatcher {
  private readonly changedPaths = new Set<string>();
  private readonly changeKinds = new Set<WorkspaceStatusWatchChangeKind>();
  private disposed = false;
  private metadataRetryAttempt = 0;
  private metadataStartRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private workspaceRootRetryAttempt = 0;
  private workspaceRootStartRetryTimer: ReturnType<typeof setTimeout> | null =
    null;
  private workspaceRootSetupWarned = false;
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
    if (this.workspaceRootStartRetryTimer !== null) {
      clearTimeout(this.workspaceRootStartRetryTimer);
      this.workspaceRootStartRetryTimer = null;
    }
    await Promise.all(
      [...this.subscriptions.values()].map((subscription) =>
        subscription.dispose(),
      ),
    );
    this.subscriptions.clear();
  }

  private async startAsync(): Promise<void> {
    if (!(await pathExists(path.join(this.args.cwd, ".git")))) {
      return;
    }
    if (this.disposed) {
      return;
    }
    const rootPath = await resolveWatchRootPath(this.args.cwd);
    this.startWorkspaceRootWatchSubscription(rootPath);
    this.startMetadataWatchSubscriptions();
  }

  private reportWorkspaceRootSetupError(
    rootPath: string,
    error: unknown,
  ): void {
    if (this.workspaceRootSetupWarned) {
      return;
    }
    this.workspaceRootSetupWarned = true;
    this.args.onWatchError({
      message: `Workspace root ignore discovery failed: ${toErrorMessage(error)}`,
      rootPath,
    });
  }

  private scheduleWorkspaceRootWatchRetry(rootPath: string): void {
    if (this.disposed || this.workspaceRootStartRetryTimer !== null) {
      return;
    }
    if (
      this.workspaceRootRetryAttempt >=
      WORKSPACE_STATUS_WATCH_MAX_SETUP_RETRY_ATTEMPTS
    ) {
      this.args.onWatchError({
        message: `Workspace root watch setup failed ${this.workspaceRootRetryAttempt} times (the worktree may have been deleted); giving up until the watch is reconfigured`,
        rootPath,
      });
      return;
    }
    this.workspaceRootRetryAttempt += 1;
    this.workspaceRootStartRetryTimer = setTimeout(
      () => {
        this.workspaceRootStartRetryTimer = null;
        this.startWorkspaceRootWatchSubscription(rootPath);
      },
      calculateExponentialBackoffDelay({
        attempt: this.workspaceRootRetryAttempt,
        baseDelayMs: this.args.retryDelayMs,
        maxDelayMs: this.args.maxRetryDelayMs,
      }),
    );
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
    try {
      const spec = await createWorkspaceRootWatchSpec({
        cwd: this.args.cwd,
        rootPath,
      });
      if (this.disposed) {
        return;
      }
      this.workspaceRootRetryAttempt = 0;
      this.workspaceRootSetupWarned = false;
      this.startWatchSubscription(spec);
    } catch (error) {
      if (this.disposed) {
        return;
      }
      this.reportWorkspaceRootSetupError(rootPath, error);
      this.scheduleWorkspaceRootWatchRetry(rootPath);
    }
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
      onDroppedEvents: () => {
        // Dropped events are recoverable for workspace status: conservatively
        // mark the whole spec changed so consumers re-read current state.
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
    this.changeScheduler.schedule();
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
    onWatchError: args.onWatchError,
    retryDelayMs: WORKSPACE_STATUS_WATCH_RETRY_DELAY_MS,
  });
}
