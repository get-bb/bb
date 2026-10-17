import fs from "node:fs/promises";
import { realParcelWatcher } from "../real-parcel-watcher.js";
import type { ParentToChildMessage } from "./messages.js";
import {
  createParcelChildHandler,
  disposeThenExit,
} from "./parcel-child-handler.js";

const DISCONNECT_EXIT_DEADLINE_MS = 2_000;

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
  disposeThenExit({
    deadlineMs: DISCONNECT_EXIT_DEADLINE_MS,
    dispose: () => handler.dispose(),
    exit: () => process.exit(0),
  });
});

process.send?.({ kind: "ready" });
