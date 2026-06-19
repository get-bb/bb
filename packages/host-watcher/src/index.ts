import type { HostWatcher } from "./host-watcher-types.js";
import { createParcelHostWatcher } from "./parcel-host-watcher.js";

export {
  createSubprocessParcelWatcherBackend,
  disposeParcelWatcherBackend,
  setParcelWatcherBackend,
  type ParcelWatcherBackendLogger,
} from "./parcel-watcher-backend.js";

export type {
  HostObservedChange,
  HostWatchError,
  HostWatcher,
  DataDirSkillsWatchError,
  ThreadStorageWatchError,
  ThreadStorageWatchTarget,
  InjectedSkillsObservedChange,
  WatchDataDirSkillsRootArgs,
  WatchThreadStorageRootArgs,
  WatchWorkspaceArgs,
  WorkspaceWatchError,
} from "./host-watcher-types.js";
export type {
  WorkspaceStatusChangeEvent,
  WorkspaceStatusWatchChangeKind,
} from "./watch-status-types.js";

export async function createHostWatcher(): Promise<HostWatcher | undefined> {
  return createParcelHostWatcher();
}
