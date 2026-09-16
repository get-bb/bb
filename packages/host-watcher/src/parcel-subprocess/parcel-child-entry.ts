import fs from "node:fs/promises";
import { realParcelWatcher } from "../real-parcel-watcher.js";
import type { ParentToChildMessage } from "./messages.js";
import { createParcelChildHandler } from "./parcel-child-handler.js";
import { createChildMessageSender } from "./child-message-sender.js";

const send = createChildMessageSender({
  send: (message, callback) => {
    if (!process.send || !process.connected) {
      callback(new Error("Watcher IPC channel is disconnected"));
      return;
    }
    process.send(message, callback);
  },
  onError: () => process.exit(1),
});

const handler = createParcelChildHandler({
  parcel: realParcelWatcher,
  send,
  listEntries: (dir) => fs.readdir(dir),
});

process.on("message", (message) => {
  handler.handleMessage(message as ParentToChildMessage);
});

process.on("disconnect", () => {
  void handler.dispose().finally(() => process.exit(0));
});

send({ kind: "ready" });
