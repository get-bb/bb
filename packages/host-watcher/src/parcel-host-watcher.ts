import fs from "node:fs/promises";
import path from "node:path";
import { isPathWithinDirectory } from "@bb/process-utils";
import { RootSubscription } from "./root-subscription.js";
import { toWatchErrorMessage } from "./watch-error.js";
import { watchPathChanges } from "./watch-path.js";
import { watchWorkspaceStatus } from "./watch-status.js";
import type {
  HostWatcher,
  InjectedSkillsObservedChange,
  WatchDataDirSkillsRootArgs,
  WatchThreadStorageArgs,
  WatchPathRootArgs,
  WatchWorkspaceArgs,
} from "./host-watcher-types.js";

interface CollectDataDirSkillsObservedChangesArgs {
  changedPaths: string[];
  dataDirSkillsRootPath: string;
}

export function collectDataDirSkillsObservedChanges(
  args: CollectDataDirSkillsObservedChangesArgs,
): InjectedSkillsObservedChange[] {
  const changedPaths = args.changedPaths
    .filter((changedPath) =>
      isPathWithinDirectory(args.dataDirSkillsRootPath, changedPath),
    )
    .sort();
  if (changedPaths.length === 0) {
    return [];
  }
  return [
    {
      kind: "injected-skills-changed",
      changedPaths,
      sourceType: "data-dir",
    },
  ];
}

function watchWorkspace(args: WatchWorkspaceArgs): () => Promise<void> {
  return watchWorkspaceStatus(args.workspacePath, {
    onChange: (event) => {
      args.onChange({
        changedPaths: event.changedPaths,
        changeKinds: event.changeKinds,
        kind: "workspace-status-changed",
        environmentId: args.environmentId,
      });
    },
    onReady: args.onReady,
    onWatchError: (error) => {
      args.onWatchError({
        kind: "workspace-watch-error",
        environmentId: args.environmentId,
        rootPath: error.rootPath,
        message: error.message,
      });
    },
  });
}

function watchThreadStorage(args: WatchThreadStorageArgs): () => Promise<void> {
  const reportWatchError = (error: { rootPath: string; message: string }) => {
    args.onWatchError({
      kind: "thread-storage-watch-error",
      rootPath: error.rootPath,
      message: error.message,
    });
  };
  let stopped = false;
  let stopWatching: (() => Promise<void>) | null = null;
  const started = fs.mkdir(args.threadStoragePath, { recursive: true }).then(
    () => {
      if (stopped) {
        return;
      }
      stopWatching = watchPathChanges(args.threadStoragePath, {
        onChange: () => {
          args.onChange();
        },
        onWatchError: reportWatchError,
      });
    },
    (error: unknown) => {
      reportWatchError({
        rootPath: args.threadStoragePath,
        message: `Thread storage directory could not be created: ${toWatchErrorMessage(error)}`,
      });
    },
  );
  return async () => {
    stopped = true;
    await started;
    await stopWatching?.();
  };
}

function watchDataDirSkillsRoot(
  args: WatchDataDirSkillsRootArgs,
): () => Promise<void> {
  return watchPathChanges(args.dataDirSkillsRootPath, {
    onChange: ({ changedPaths }) => {
      const events = collectDataDirSkillsObservedChanges({
        changedPaths,
        dataDirSkillsRootPath: args.dataDirSkillsRootPath,
      });
      for (const event of events) {
        args.onChange(event);
      }
    },
    onWatchError: (error) => {
      args.onWatchError({
        kind: "data-dir-skills-watch-error",
        rootPath: error.rootPath,
        message: error.message,
      });
    },
  });
}

function watchPathRoot(args: WatchPathRootArgs): () => Promise<void> {
  const subscription = new RootSubscription({
    rootPath: path.resolve(args.rootPath),
    subscribeOptions:
      args.ignoredPaths.length === 0
        ? undefined
        : { ignore: [...args.ignoredPaths] },
    retryDelayMs: 250,
    maxRetryDelayMs: 30_000,
    onEvents: (events) => {
      args.onChange(
        events.map((event) => ({
          path: path.isAbsolute(event.path)
            ? path.normalize(event.path)
            : path.resolve(args.rootPath, event.path),
          type: event.type,
        })),
      );
    },
    onReady: args.onReady,
    onDroppedEvents: args.onRescanRequired,
    onWatchError: (message) => {
      args.onWatchError({ rootPath: args.rootPath, message });
    },
  });
  subscription.start();
  return () => subscription.dispose();
}

export function createParcelHostWatcher(): HostWatcher {
  return {
    watchWorkspace,
    watchPathRoot,
    watchThreadStorage,
    watchDataDirSkillsRoot,
  };
}
