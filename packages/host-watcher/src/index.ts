import type {
  HostWatcher,
  CreateHostWatcherArgs,
} from "./host-watcher-types.js";
import { createParcelHostWatcher } from "./parcel-host-watcher.js";

export type {
  HostObservedChange,
  HostWatchError,
  HostWatcher,
  ApplicationDataWatchTarget,
  ApplicationStorageObservedChange,
  ApplicationStorageWatchError,
  ThreadStorageWatchError,
  ThreadStorageWatchTarget,
  WatchApplicationStorageRootArgs,
  WatchThreadStorageRootArgs,
  WatchWorkspaceArgs,
  WorkspaceWatchError,
} from "./host-watcher-types.js";
export type {
  WorkspaceStatusChangeEvent,
  WorkspaceStatusWatchChangeKind,
} from "./watch-status-types.js";

export async function createHostWatcher(
  _args: CreateHostWatcherArgs,
): Promise<HostWatcher | undefined> {
  return createParcelHostWatcher();
}
