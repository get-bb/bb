import fs from "node:fs";
import { setImmediate as yieldImmediate } from "node:timers/promises";
import type { ParcelWatcherBackend } from "../../src/parcel-watcher-backend.js";
import { createParcelChildHandler } from "../../src/parcel-subprocess/parcel-child-handler.js";
import { createChildMessageSender } from "../../src/parcel-subprocess/child-message-sender.js";
import type { ChildToParentMessage } from "../../src/parcel-subprocess/messages.js";

const [mode, reportPath, batchCountValue] = process.argv.slice(2);
const batchCount = Number(batchCountValue);
if (
  (mode !== "unbounded" && mode !== "bounded") ||
  !reportPath ||
  !Number.isInteger(batchCount) ||
  batchCount <= 0
) {
  throw new Error("Expected mode, report path, and positive batch count");
}
let callback: Parameters<ParcelWatcherBackend["subscribe"]>[1] | null = null;
let sent = 0;
let completed = 0;
const rawSend = (
  message: ChildToParentMessage,
  done: (error: Error | null) => void,
) => {
  if (!process.send) throw new Error("IPC channel required");
  sent += 1;
  process.send(message, (error) => {
    completed += 1;
    done(error);
  });
};
const send =
  mode === "bounded"
    ? createChildMessageSender({
        send: rawSend,
        onError: () => process.exit(1),
      })
    : (message: ChildToParentMessage) =>
        rawSend(message, (error) => {
          if (error) process.exit(1);
        });
const handler = createParcelChildHandler({
  parcel: {
    async subscribe(_dir, onEvents) {
      callback = onEvents;
      return {
        async unsubscribe() {
          callback = null;
        },
      };
    },
  },
  send,
  listEntries: async () => [],
});
handler.handleMessage({ kind: "subscribe", id: "fixture", dir: "/fixture" });
process.once("message", async (message: unknown) => {
  if (message !== "produce" || !callback)
    throw new Error("Expected produce after subscribe");
  const startRssBytes = process.memoryUsage().rss;
  const events = Array.from({ length: 1000 }, (_, index) => ({
    path: `/fixture/${"x".repeat(240)}/${index}`,
    type: "update" as const,
  }));
  const startedAt = performance.now();
  for (let index = 0; index < batchCount; index += 1) {
    callback(null, events);
    await yieldImmediate();
  }
  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      startRssBytes,
      endRssBytes: process.memoryUsage().rss,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      productionMs: performance.now() - startedAt,
      sent,
      completed,
      producedEvents: batchCount * events.length,
    }),
  );
  send({ kind: "pong", nonce: batchCount });
});
process.on("disconnect", () => process.exit(0));
