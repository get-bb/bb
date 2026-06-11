import path from "node:path";
import { watchPathChanges } from "./watch-path.js";
import { watchWorkspaceStatus } from "./watch-status.js";
import type {
  HostWatcher,
  InjectedSkillsObservedChange,
  ThreadStorageObservedChange,
  ThreadStorageWatchTarget,
  WatchDataDirSkillsRootArgs,
  WatchThreadStorageRootArgs,
  WatchWorkspaceArgs,
} from "./host-watcher-types.js";

interface ThreadStoragePathArgs {
  changedPath: string;
  threadStorageRootPath: string;
}

interface ThreadStoragePath {
  parts: string[];
  threadId: string;
}

interface DataDirSkillsPathArgs {
  changedPath: string;
  dataDirSkillsRootPath: string;
}

interface CollectThreadStorageObservedChangesArgs {
  changedPaths: string[];
  threadStorageRootPath: string;
  resolveThreadTarget: (threadId: string) => ThreadStorageWatchTarget | null;
}

interface CollectDataDirSkillsObservedChangesArgs {
  changedPaths: string[];
  dataDirSkillsRootPath: string;
}

function toThreadStoragePath(
  args: ThreadStoragePathArgs,
): ThreadStoragePath | null {
  const relativePath = path.relative(
    args.threadStorageRootPath,
    args.changedPath,
  );
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }
  const parts = relativePath.split(path.sep).filter(Boolean);
  const threadId = parts[0];
  if (!threadId) {
    return null;
  }
  return {
    parts,
    threadId,
  };
}

function isDataDirSkillsPath(args: DataDirSkillsPathArgs): boolean {
  const relativePath = path.relative(
    args.dataDirSkillsRootPath,
    args.changedPath,
  );
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

export function collectThreadStorageObservedChanges(
  args: CollectThreadStorageObservedChangesArgs,
): ThreadStorageObservedChange[] {
  const storageChanges = new Map<string, ThreadStorageWatchTarget>();
  for (const changedPath of args.changedPaths) {
    const storagePath = toThreadStoragePath({
      changedPath,
      threadStorageRootPath: args.threadStorageRootPath,
    });
    if (!storagePath) {
      continue;
    }
    const target = args.resolveThreadTarget(storagePath.threadId);
    if (!target) {
      continue;
    }
    storageChanges.set(`${target.environmentId}:${target.threadId}`, target);
  }

  return Array.from(storageChanges.values()).map((target) => ({
      kind: "thread-storage-changed",
      environmentId: target.environmentId,
      threadId: target.threadId,
    }));
}

export function collectDataDirSkillsObservedChanges(
  args: CollectDataDirSkillsObservedChangesArgs,
): InjectedSkillsObservedChange[] {
  const changedPaths = args.changedPaths
    .filter((changedPath) =>
      isDataDirSkillsPath({
        changedPath,
        dataDirSkillsRootPath: args.dataDirSkillsRootPath,
      }),
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

function watchThreadStorageRoot(
  args: WatchThreadStorageRootArgs,
): () => Promise<void> {
  return watchPathChanges(args.threadStorageRootPath, {
    onChange: ({ changedPaths }) => {
      const events = collectThreadStorageObservedChanges({
        changedPaths,
        threadStorageRootPath: args.threadStorageRootPath,
        resolveThreadTarget: args.resolveThreadTarget,
      });
      for (const event of events) {
        args.onChange(event);
      }
    },
    onWatchError: (error) => {
      args.onWatchError({
        kind: "thread-storage-watch-error",
        rootPath: error.rootPath,
        message: error.message,
      });
    },
  });
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

export function createParcelHostWatcher(): HostWatcher {
  return {
    watchWorkspace,
    watchThreadStorageRoot,
    watchDataDirSkillsRoot,
  };
}
