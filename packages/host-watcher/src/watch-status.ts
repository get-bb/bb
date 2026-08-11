import { createWorkspaceStatusWatcher } from "./workspace-status-watcher.js";
import type { WorkspaceStatusWatchArgs } from "./watch-status-types.js";

export type {
  WorkspaceStatusChangeCallback,
  WorkspaceStatusChangeEvent,
  WorkspaceStatusWatchArgs,
  WorkspaceStatusWatchChangeKind,
  WorkspaceStatusWatchError,
  WorkspaceStatusWatchErrorCallback,
} from "./watch-status-types.js";

export function watchWorkspaceStatus(
  cwd: string,
  args: WorkspaceStatusWatchArgs,
): () => Promise<void> {
  const watcher = createWorkspaceStatusWatcher({
    cwd,
    onChange: args.onChange,
    onReady: args.onReady,
    onWatchError: args.onWatchError,
  });
  watcher.start();
  return () => watcher.dispose();
}
