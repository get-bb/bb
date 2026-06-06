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

interface ApplicationDataPathArgs {
  appDataRootPath: string;
  changedPath: string;
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
}

interface CollectApplicationDataObservedChangesArgs {
  appDataRootPath: string;
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

function isApplicationSkillsSubtreePath(path: ApplicationStoragePath): boolean {
  return path.parts[1] === "skills";
}

function isApplicationPublicSubtreePath(path: ApplicationStoragePath): boolean {
  return path.parts[1] === "public";
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

/**
 * App data lives at {appDataRootPath}/<applicationId>/<dataPath...> — the
 * per-app directory is itself the data subtree (no `data/` segment). Returns
 * the parsed app id and parts relative to the app-data root, or null when the
 * change is outside the root or names an invalid application id.
 */
function toApplicationDataStoragePath(
  args: ApplicationDataPathArgs,
): ApplicationStoragePath | null {
  const relativePath = path.relative(args.appDataRootPath, args.changedPath);
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
    return null;
  }
  const parsed = applicationIdSchema.safeParse(rawApplicationId);
  if (!parsed.success) {
    return null;
  }
  return { applicationId: parsed.data, parts };
}

function toApplicationDataPath(
  storagePath: ApplicationStoragePath,
): ApplicationDataPath | null {
  if (!storagePath.applicationId || storagePath.parts.length < 2) {
    return null;
  }
  const dataPath = appDataPathSchema.safeParse(
    storagePath.parts.slice(1).join("/"),
  );
  if (!dataPath.success) {
    return null;
  }
  return {
    applicationId: storagePath.applicationId,
    path: dataPath.data,
  };
}

function toApplicationDataRootPath(
  storagePath: ApplicationStoragePath,
): ApplicationDataRootPath | null {
  if (!storagePath.applicationId) {
    return null;
  }
  return { applicationId: storagePath.applicationId };
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

/**
 * Classifies changes under the apps root (app code): manifest/folder changes
 * become targets-changed, public/ becomes content-changed, skills/ becomes
 * injected-skills-changed. App data is NOT here — it lives under the app-data
 * root and is classified by collectApplicationDataObservedChanges.
 */
export function collectApplicationStorageObservedChanges(
  args: CollectApplicationStorageObservedChangesArgs,
): ApplicationStorageObservedChange[] {
  let targetsChanged = false;
  const appContentChanges = new Map<string, ApplicationStorageObservedChange>();
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
    if (isApplicationPublicSubtreePath(storagePath)) {
      // Served browser content changed (e.g. a rebuild into public/). One
      // event per app per flush batch; consumers use it to live-reload open
      // app surfaces. Changes under source/ deliberately stay unclassified —
      // nothing served changes until a build writes into public/.
      appContentChanges.set(storagePath.applicationId, {
        kind: "application-content-changed",
        applicationId: storagePath.applicationId,
      });
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
  }

  const observedChanges: ApplicationStorageObservedChange[] = [];
  if (targetsChanged) {
    observedChanges.push({ kind: "application-storage-targets-changed" });
  }
  observedChanges.push(...appContentChanges.values());
  observedChanges.push(...appSkillChanges.values());
  return observedChanges;
}

/**
 * Classifies changes under the app-data root ({dataDir}/app-data). A change to
 * a known data file emits application-data-changed; a change to the per-app
 * directory itself (or an unrepresentable path) emits application-data-resync
 * so subscribers re-read the whole app's data.
 */
export function collectApplicationDataObservedChanges(
  args: CollectApplicationDataObservedChangesArgs,
): ApplicationStorageObservedChange[] {
  const appDataChanges = new Map<string, ApplicationStorageObservedChange>();
  const appDataResyncs = new Map<string, ApplicationStorageObservedChange>();

  for (const changedPath of args.changedPaths) {
    const storagePath = toApplicationDataStoragePath({
      changedPath,
      appDataRootPath: args.appDataRootPath,
    });
    if (!storagePath) {
      continue;
    }
    const appDataPath = toApplicationDataPath(storagePath);
    if (appDataPath) {
      // A precise per-file change needs the tracked target's resolved data
      // path; an untracked app has no subscriber, so skip it.
      const target = args.resolveApplicationTarget(appDataPath.applicationId);
      if (!target) {
        continue;
      }
      appDataChanges.set(`${appDataPath.applicationId}:${appDataPath.path}`, {
        kind: "application-data-changed",
        applicationId: appDataPath.applicationId,
        appDataPath: target.appDataPath,
        path: appDataPath.path,
      });
      continue;
    }
    // Whole-dir or unrepresentable change: emit a resync hint so subscribers
    // re-read. No target lookup — the hint carries only the application id.
    const appDataRootPath = toApplicationDataRootPath(storagePath);
    if (appDataRootPath) {
      appDataResyncs.set(appDataRootPath.applicationId, {
        kind: "application-data-resync",
        applicationId: appDataRootPath.applicationId,
      });
    }
  }

  const observedChanges: ApplicationStorageObservedChange[] = [];
  observedChanges.push(...appDataChanges.values());
  observedChanges.push(...appDataResyncs.values());
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
  const onWatchError = (error: { rootPath: string; message: string }) => {
    args.onWatchError({
      kind: "application-storage-watch-error",
      rootPath: error.rootPath,
      message: error.message,
    });
  };
  // App code (apps/) and app data (app-data/) live in sibling roots, so each
  // needs its own watch. Code changes drive targets/content/skills events;
  // data changes drive app-data broadcasts.
  const stopWatchingApps = watchPathChanges(args.appsRootPath, {
    onChange: ({ changedPaths }) => {
      const events = collectApplicationStorageObservedChanges({
        changedPaths,
        appsRootPath: args.appsRootPath,
      });
      for (const event of events) {
        args.onChange(event);
      }
    },
    onWatchError,
  });
  const stopWatchingAppData = watchPathChanges(args.appDataRootPath, {
    onChange: ({ changedPaths }) => {
      const events = collectApplicationDataObservedChanges({
        changedPaths,
        appDataRootPath: args.appDataRootPath,
        resolveApplicationTarget: args.resolveApplicationTarget,
      });
      for (const event of events) {
        args.onChange(event);
      }
    },
    onWatchError,
  });
  return async () => {
    await stopWatchingApps();
    await stopWatchingAppData();
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

export function createParcelHostWatcher(): HostWatcher {
  return {
    watchWorkspace,
    watchThreadStorageRoot,
    watchApplicationStorageRoot,
    watchDataDirSkillsRoot,
  };
}
