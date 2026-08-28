import fs from "node:fs/promises";
import { realParcelWatcher } from "../real-parcel-watcher.js";
import type { ParentToChildMessage } from "./messages.js";
import { createParcelChildHandler } from "./parcel-child-handler.js";

const handler = createParcelChildHandler({
  parcel: realParcelWatcher,
  send: (message) => {
    process.send?.(message);
  },
  listEntries: (dir) => fs.readdir(dir),
});

process.on("message", (message) => {
  /* SAFETY: The fork channel sends only ParentToChildMessage values from the parent watcher. */
  handler.handleMessage(message as ParentToChildMessage);
});

process.on("disconnect", () => {
  void handler.dispose().finally(() => process.exit(0));
});

process.send?.({ kind: "ready" });
