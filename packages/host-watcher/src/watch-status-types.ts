export const WORKSPACE_STATUS_WATCH_CHANGE_KINDS = [
  "workspace-content-changed",
  "workspace-git-changed",
  "workspace-git-repository-created",
  "shared-git-refs-changed",
] as const;
export type WorkspaceStatusWatchChangeKind =
  (typeof WORKSPACE_STATUS_WATCH_CHANGE_KINDS)[number];

export interface WorkspaceStatusChangeEvent {
  changedPaths: string[];
  changeKinds: WorkspaceStatusWatchChangeKind[];
}

type WorkspaceStatusChangeCallback = (
  event: WorkspaceStatusChangeEvent,
) => void;

export interface WorkspaceStatusWatchError {
  message: string;
  rootPath: string;
}

type WorkspaceStatusWatchErrorCallback = (
  error: WorkspaceStatusWatchError,
) => void;

export interface WorkspaceStatusWatchArgs {
  onChange: WorkspaceStatusChangeCallback;
  onReady?: () => void;
  onWatchError: WorkspaceStatusWatchErrorCallback;
}
