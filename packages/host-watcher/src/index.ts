import type { HostWatcher } from "./host-watcher-types.js";
import { createParcelHostWatcher } from "./parcel-host-watcher.js";

export type {
  HostObservedChange,
  HostWatchError,
  HostWatcher,
  ApplicationDataWatchTarget,
  ApplicationStorageObservedChange,
  ApplicationStorageWatchError,
  DataDirSkillsWatchError,
  ThreadStorageWatchError,
  ThreadStorageWatchTarget,
  InjectedSkillsObservedChange,
  WatchApplicationStorageRootArgs,
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
