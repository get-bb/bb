import parcelWatcher from "@parcel/watcher";
import type { ParcelWatcherBackend } from "./parcel-watcher-backend.js";

// The only module that loads the native @parcel/watcher addon in the parent
// process. Kept in its own file so it can be dynamically imported on demand,
// leaving the parent parcel-free under BB_WATCHER_SUBPROCESS=1.
export const realParcelWatcher: ParcelWatcherBackend = parcelWatcher;
