import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { z } from "zod";

const metricsSchema = z.object({
  startRssBytes: z.number(),
  endRssBytes: z.number(),
  peakRssBytes: z.number(),
  productionMs: z.number(),
  sent: z.number(),
  completed: z.number(),
  producedEvents: z.number(),
});
const messageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("subscribed") }),
  z.object({
    kind: z.literal("events"),
    events: z.array(z.object({ path: z.string(), type: z.literal("update") })),
  }),
  z.object({
    kind: z.literal("watch-error"),
    id: z.string(),
    recovery: z.literal("rescan-subscription"),
  }),
  z.object({ kind: z.literal("pong"), nonce: z.number() }),
]);

async function measure(mode: "unbounded" | "bounded", batchCount: number) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "bb-watcher-ipc-benchmark-"),
  );
  const reportPath = path.join(root, "metrics.json");
  const child = fork(
    fileURLToPath(
      new URL("./fixtures/ipc-backpressure-child.ts", import.meta.url),
    ),
    [mode, reportPath, String(batchCount)],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    },
  );
  let deliveredEvents = 0;
  let recoveryRequests = 0;
  const exit = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Benchmark IPC timed out")),
        30000,
      );
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      child.once("error", finish);
      child.once("exit", () =>
        finish(new Error("Benchmark child exited early")),
      );
      child.on("message", (raw: unknown) => {
        try {
          const message = messageSchema.parse(raw);
          if (message.kind === "subscribed") {
            child.send("produce");
            const deadline = performance.now() + 15000;
            const waitArray = new Int32Array(new SharedArrayBuffer(4));
            while (!fs.existsSync(reportPath)) {
              if (performance.now() > deadline)
                throw new Error(
                  "Production did not finish while receiver stalled",
                );
              Atomics.wait(waitArray, 0, 0, 10);
            }
          } else if (message.kind === "events") {
            deliveredEvents += message.events.length;
          } else if (message.kind === "watch-error") {
            recoveryRequests += 1;
          } else {
            expect(message.nonce).toBe(batchCount);
            finish();
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
    const metrics = metricsSchema.parse(
      JSON.parse(fs.readFileSync(reportPath, "utf8")),
    );
    return {
      mode,
      batchCount,
      ...metrics,
      rssGrowthBytes: metrics.endRssBytes - metrics.startRssBytes,
      deliveredEvents,
      recoveryRequests,
    };
  } finally {
    child.kill("SIGKILL");
    await exit;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

it.runIf(process.env.BB_WATCHER_IPC_BENCHMARK === "1")(
  "measures bounded IPC retention against the upstream sender",
  async () => {
    const results = [];
    for (const batchCount of [100, 500]) {
      for (let repetition = 0; repetition < 3; repetition += 1) {
        const before = await measure("unbounded", batchCount);
        const after = await measure("bounded", batchCount);
        expect(before.producedEvents).toBe(after.producedEvents);
        expect(before.deliveredEvents).toBe(before.producedEvents);
        expect(before.recoveryRequests).toBe(0);
        expect(before.sent - before.completed).toBe(batchCount);
        expect(after.sent - after.completed).toBeLessThanOrEqual(4);
        expect(after.deliveredEvents).toBe(2000);
        expect(after.recoveryRequests).toBe(1);
        results.push({ repetition, before, after });
      }
    }
    const report = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      results,
    };
    const output = process.env.BB_WATCHER_IPC_BENCHMARK_OUTPUT;
    if (output)
      fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`WATCHER_IPC_BENCHMARK ${JSON.stringify(report)}\n`);
  },
  180000,
);
