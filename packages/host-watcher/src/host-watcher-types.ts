import type { HostType } from "@bb/domain";
import type { AppDataPath, ApplicationId } from "@bb/domain";
import type { WorkspaceStatusWatchChangeKind } from "./watch-status-types.js";

export type HostObservedChange =
  | {
      kind: "workspace-status-changed";
      changedPaths: string[];
      changeKinds: WorkspaceStatusWatchChangeKind[];
      environmentId: string;
    }
  | {
      kind: "thread-storage-changed";
      environmentId: string;
      threadId: string;
    }
  | {
      kind: "application-storage-targets-changed";
    }
  | {
      kind: "application-data-changed";
      applicationId: ApplicationId;
      appDataPath: string;
      path: AppDataPath;
    }
  | {
      kind: "application-data-resync";
      applicationId: ApplicationId;
    }
  | {
      kind: "injected-skills-changed";
      applicationId: ApplicationId | null;
      changedPaths: string[];
      sourceType: "data-dir" | "global-app";
    };

export type WorkspaceObservedChange = Extract<
  HostObservedChange,
  { kind: "workspace-status-changed" }
>;

export type ThreadStorageObservedChange = Extract<
  HostObservedChange,
  {
    kind: "thread-storage-changed";
  }
>;

export type ApplicationStorageObservedChange = Extract<
  HostObservedChange,
  {
    kind:
      | "application-storage-targets-changed"
      | "application-data-changed"
      | "application-data-resync"
      | "injected-skills-changed";
  }
>;

export type InjectedSkillsObservedChange = Extract<
  HostObservedChange,
  {
    kind: "injected-skills-changed";
  }
>;

export interface WorkspaceWatchError {
  kind: "workspace-watch-error";
  environmentId: string;
  rootPath: string;
  message: string;
}

export interface ThreadStorageWatchError {
  kind: "thread-storage-watch-error";
  rootPath: string;
  message: string;
  environmentId?: string;
  threadId?: string;
}

export interface ApplicationStorageWatchError {
  kind: "application-storage-watch-error";
  rootPath: string;
  message: string;
}

export interface DataDirSkillsWatchError {
  kind: "data-dir-skills-watch-error";
  rootPath: string;
  message: string;
}

export type HostWatchError =
  | WorkspaceWatchError
  | ThreadStorageWatchError
  | ApplicationStorageWatchError
  | DataDirSkillsWatchError;

export interface ThreadStorageWatchTarget {
  environmentId: string;
  threadId: string;
}

export interface WatchWorkspaceArgs {
  environmentId: string;
  workspacePath: string;
  onChange: (event: WorkspaceObservedChange) => void;
  onWatchError: (error: WorkspaceWatchError) => void;
}

export interface WatchThreadStorageRootArgs {
  threadStorageRootPath: string;
  resolveThreadTarget: (threadId: string) => ThreadStorageWatchTarget | null;
  onChange: (event: ThreadStorageObservedChange) => void;
  onWatchError: (error: ThreadStorageWatchError) => void;
}

export interface ApplicationDataWatchTarget {
  applicationId: ApplicationId;
  appDataPath: string;
}

export interface WatchApplicationStorageRootArgs {
  appsRootPath: string;
  resolveApplicationTarget: (
    applicationId: ApplicationId,
  ) => ApplicationDataWatchTarget | null;
  onChange: (event: ApplicationStorageObservedChange) => void;
  onWatchError: (error: ApplicationStorageWatchError) => void;
}

export interface WatchDataDirSkillsRootArgs {
  dataDirSkillsRootPath: string;
  onChange: (event: InjectedSkillsObservedChange) => void;
  onWatchError: (error: DataDirSkillsWatchError) => void;
}

export interface HostWatcher {
  watchWorkspace(args: WatchWorkspaceArgs): () => void | Promise<void>;
  watchThreadStorageRoot(
    args: WatchThreadStorageRootArgs,
  ): () => void | Promise<void>;
  watchApplicationStorageRoot(
    args: WatchApplicationStorageRootArgs,
  ): () => void | Promise<void>;
  watchDataDirSkillsRoot?(
    args: WatchDataDirSkillsRootArgs,
  ): () => void | Promise<void>;
}

export interface CreateHostWatcherArgs {
  hostType: HostType;
}
