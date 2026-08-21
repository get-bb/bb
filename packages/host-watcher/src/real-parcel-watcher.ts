import parcelWatcher from "@parcel/watcher";
import type { ParcelWatcherBackend } from "./parcel-watcher-backend.js";

// Static handle on the native @parcel/watcher addon for the forked watcher
// child (parcel-child-entry.ts). Do NOT dynamically import this module from
// code that ends up in the daemon bundle: esbuild inlines internal dynamic
// imports and hoists this static import to the bundle's top level, which loads
// watcher.node in the parent at startup (get-bb/bb#1873). The in-process
// fallback in parcel-watcher-backend.ts imports "@parcel/watcher" directly.
export const realParcelWatcher: ParcelWatcherBackend = parcelWatcher;
