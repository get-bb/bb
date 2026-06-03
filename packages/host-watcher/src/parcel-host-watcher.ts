import path from "node:path";
import {
  appDataPathSchema,
  applicationIdSchema,
  type AppDataPath,
  type ApplicationId,
} from "@bb/domain";
import { watchPathChanges } from "./watch-path.js";
import { watchWorkspaceStatus } from "./watch-status.js";
import type {
  HostWatcher,
  ApplicationStorageObservedChange,
  ApplicationDataWatchTarget,
  InjectedSkillsObservedChange,
  ThreadStorageObservedChange,
  ThreadStorageWatchTarget,
  WatchApplicationStorageRootArgs,
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

interface ApplicationStoragePathArgs {
  appsRootPath: string;
  changedPath: string;
}

interface ApplicationStoragePath {
  applicationId: ApplicationId | null;
  parts: string[];
}

interface ApplicationDataPath {
  applicationId: ApplicationId;
  path: AppDataPath;
}

interface ApplicationDataRootPath {
  applicationId: ApplicationId;
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

interface CollectApplicationStorageObservedChangesArgs {
  appsRootPath: string;
  changedPaths: string[];
  resolveApplicationTarget: (
    applicationId: ApplicationId,
  ) => ApplicationDataWatchTarget | null;
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

function toApplicationStoragePath(
  args: ApplicationStoragePathArgs,
): ApplicationStoragePath | null {
  const relativePath = path.relative(args.appsRootPath, args.changedPath);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }
  const parts = relativePath.split(path.sep).filter(Boolean);
  const rawApplicationId = parts[0];
  if (!rawApplicationId) {
    return {
      applicationId: null,
      parts,
    };
  }
  const parsed = applicationIdSchema.safeParse(rawApplicationId);
  return {
    applicationId: parsed.success ? parsed.data : null,
    parts,
  };
}

function isApplicationDataSubtreePath(path: ApplicationStoragePath): boolean {
  return path.parts[1] === "data";
}

function isApplicationSkillsSubtreePath(path: ApplicationStoragePath): boolean {
  return path.parts[1] === "skills";
}

function isApplicationManifestPath(path: ApplicationStoragePath): boolean {
  return path.parts.length === 2 && path.parts[1] === "manifest.json";
}

function isApplicationFolderPath(path: ApplicationStoragePath): boolean {
  return path.parts.length === 1;
}

function isIgnoredApplicationStorageEntry(path: ApplicationStoragePath): boolean {
  const firstPart = path.parts[0] ?? "";
  return (
    firstPart.startsWith(".tmp-app_") || firstPart.startsWith(".delete-app_")
  );
}

function toApplicationDataPath(
  path: ApplicationStoragePath,
): ApplicationDataPath | null {
  const rootPath = toApplicationDataRootPath(path);
  if (!rootPath || path.parts.length < 3) {
    return null;
  }
  const dataPath = appDataPathSchema.safeParse(path.parts.slice(2).join("/"));
  if (!dataPath.success) {
    return null;
  }
  return {
    applicationId: rootPath.applicationId,
    path: dataPath.data,
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

function toApplicationDataRootPath(
  path: ApplicationStoragePath,
): ApplicationDataRootPath | null {
  if (!path.applicationId || !isApplicationDataSubtreePath(path)) {
    return null;
  }
  return {
    applicationId: path.applicationId,
  };
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

export function collectApplicationStorageObservedChanges(
  args: CollectApplicationStorageObservedChangesArgs,
): ApplicationStorageObservedChange[] {
  let targetsChanged = false;
  const appDataChanges = new Map<string, ApplicationStorageObservedChange>();
  const appDataResyncs = new Map<string, ApplicationStorageObservedChange>();
  const appSkillChanges = new Map<string, InjectedSkillsObservedChange>();

  for (const changedPath of args.changedPaths) {
    const storagePath = toApplicationStoragePath({
      changedPath,
      appsRootPath: args.appsRootPath,
    });
    if (!storagePath || isIgnoredApplicationStorageEntry(storagePath)) {
      continue;
    }
    if (
      storagePath.applicationId === null ||
      isApplicationFolderPath(storagePath) ||
      isApplicationManifestPath(storagePath)
    ) {
      targetsChanged = true;
      continue;
    }
    if (isApplicationSkillsSubtreePath(storagePath)) {
      appSkillChanges.set(storagePath.applicationId, {
        kind: "injected-skills-changed",
        applicationId: storagePath.applicationId,
        changedPaths: [
          ...(appSkillChanges.get(storagePath.applicationId)?.changedPaths ??
            []),
          changedPath,
        ].sort(),
        sourceType: "global-app",
      });
      continue;
    }
    if (isApplicationDataSubtreePath(storagePath)) {
      const appDataRootPath = toApplicationDataRootPath(storagePath);
      const appDataPath = toApplicationDataPath(storagePath);
      if (appDataPath) {
        const target = args.resolveApplicationTarget(
          appDataPath.applicationId,
        );
        if (!target) {
          continue;
        }
        appDataChanges.set(
          `${appDataPath.applicationId}:${appDataPath.path}`,
          {
            kind: "application-data-changed",
            applicationId: appDataPath.applicationId,
            appDataPath: target.appDataPath,
            path: appDataPath.path,
          },
        );
      } else if (appDataRootPath) {
        appDataResyncs.set(appDataRootPath.applicationId, {
          kind: "application-data-resync",
          applicationId: appDataRootPath.applicationId,
        });
      }
      continue;
    }
  }

  const observedChanges: ApplicationStorageObservedChange[] = [];
  if (targetsChanged) {
    observedChanges.push({ kind: "application-storage-targets-changed" });
  }
  observedChanges.push(...appDataChanges.values());
  observedChanges.push(...appDataResyncs.values());
  observedChanges.push(...appSkillChanges.values());
  return observedChanges;
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
      applicationId: null,
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

function watchApplicationStorageRoot(
  args: WatchApplicationStorageRootArgs,
): () => Promise<void> {
  return watchPathChanges(args.appsRootPath, {
    onChange: ({ changedPaths }) => {
      const events = collectApplicationStorageObservedChanges({
        changedPaths,
        appsRootPath: args.appsRootPath,
        resolveApplicationTarget: args.resolveApplicationTarget,
      });
      for (const event of events) {
        args.onChange(event);
      }
    },
    onWatchError: (error) => {
      args.onWatchError({
        kind: "application-storage-watch-error",
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
    watchApplicationStorageRoot,
    watchDataDirSkillsRoot,
  };
}
