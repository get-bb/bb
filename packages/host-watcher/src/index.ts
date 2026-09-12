import type { HostWatcher } from "./host-watcher-types.js";
import { createParcelHostWatcher } from "./parcel-host-watcher.js";

export {
  createSubprocessParcelWatcherBackend,
  disposeParcelWatcherBackend,
  setParcelWatcherBackend,
} from "./parcel-watcher-backend.js";

export type {
  HostWatcher,
  DataDirSkillsWatchError,
  ThreadStorageWatchError,
  InjectedSkillsObservedChange,
  WatchThreadStorageRootArgs,
  WatchWorkspaceArgs,
  WorkspaceWatchError,
  WatchPathRootArgs,
  HostPathWatchChange,
} from "./host-watcher-types.js";
export type { WorkspaceStatusWatchChangeKind } from "./watch-status-types.js";

export function createHostWatcher(): HostWatcher {
  return createParcelHostWatcher();
}
