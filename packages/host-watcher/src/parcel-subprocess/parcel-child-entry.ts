import fs from "node:fs/promises";
import { realParcelWatcher } from "../real-parcel-watcher.js";
import type { ParentToChildMessage } from "./messages.js";
import { createParcelChildHandler } from "./parcel-child-handler.js";

// Child process entry: the ONLY place the native @parcel/watcher addon runs when
// BB_WATCHER_SUBPROCESS=1. Any inotify EINTR leak/deadlock is contained here and
// reclaimed wholesale when the parent SIGKILLs and respawns us.
const handler = createParcelChildHandler({
  parcel: realParcelWatcher,
  send: (message) => {
    process.send?.(message);
  },
  listEntries: (dir) => fs.readdir(dir),
});

process.on("message", (message) => {
  handler.handleMessage(message as ParentToChildMessage);
});

process.on("disconnect", () => {
  void handler.dispose().finally(() => process.exit(0));
});

process.send?.({ kind: "ready" });
