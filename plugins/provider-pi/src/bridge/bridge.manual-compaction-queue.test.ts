import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  FULL_PERMISSION_OPTIONS,
  startFakePiBridge,
  type FakePiBridgeHarness,
} from "./test-support.js";

const THREAD_ID = "thr_manualcompactq";

let harness: FakePiBridgeHarness | undefined;
let nextId = 3000;

afterEach(async () => {
  await harness?.teardown();
  harness = undefined;
});

async function start() {
  const bridge = await startFakePiBridge({
    prefix: "bb-pi-manual-compaction-",
    initialize: true,
  });
  harness = bridge;
  const releasePath = join(bridge.workspaceDir, "release-compaction");
  const commandLogPath = join(bridge.workspaceDir, "commands.log");
  vi.stubEnv("FAKE_PI_COMPACTION_RELEASE_FILE", releasePath);
  vi.stubEnv("FAKE_PI_COMMAND_LOG", commandLogPath);
  const started = await bridge.startThread(THREAD_ID);
  const result = started.result;
  if (
    !result ||
    typeof result !== "object" ||
    !("providerThreadId" in result) ||
    typeof result.providerThreadId !== "string"
  )
    throw new Error("missing provider identity");
  const providerThreadId = result.providerThreadId;
  const turn = (clientRequestId: string, text: string) =>
    bridge.request(++nextId, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId,
      clientRequestId,
      input: [{ type: "text", text, mentions: [] }],
      options: FULL_PERMISSION_OPTIONS,
    });
  const promptCount = () =>
    readFileSync(commandLogPath, "utf8")
      .split("\n")
      .filter((line) => line === "prompt").length;
  const releaseCompaction = () => writeFileSync(releasePath, "");
  const boundaries = () =>
    bridge.deltasOf(THREAD_ID).filter((d) => d.kind === "turn.boundary");
  const settledAfterReply = (text: string) => {
    const deltas = bridge.deltasOf(THREAD_ID);
    const reply = deltas.findIndex(
      (d) => d.kind === "item.textClose" && d.text === `Response to: ${text}`,
    );
    return (
      reply !== -1 &&
      deltas.slice(reply).some((d) => d.kind === "turn.boundary")
    );
  };
  return {
    bridge,
    providerThreadId,
    turn,
    promptCount,
    releaseCompaction,
    boundaries,
    settledAfterReply,
  };
}

it("holds a prompt sent while a Pi extension compacts and sends it when compaction ends", async () => {
  const t = await start();
  expect(
    (await t.turn("creq_ab23456789", "/compact-on-settle")).error,
  ).toBeUndefined();
  await t.bridge.waitFor(
    () => t.boundaries().length >= 1,
    "the compacting turn to settle",
  );

  const queued = await t.turn("creq_cd23456789", "sent during compaction");
  expect(queued.error).toBeUndefined();
  expect(t.promptCount()).toBe(1);

  t.releaseCompaction();
  await t.bridge.waitFor(
    () => t.settledAfterReply("sent during compaction"),
    "the queued prompt to run",
  );
  expect(t.boundaries().map((d) => d.status)).not.toContain("failed");
  expect(t.promptCount()).toBe(2);
}, 30_000);

it("retries a prompt Pi rejected before the bridge saw the compaction start", async () => {
  const t = await start();
  expect(
    (await t.turn("creq_ab23456789", "/compact-on-settle-late")).error,
  ).toBeUndefined();
  await t.bridge.waitFor(
    () => t.boundaries().length >= 1,
    "the compacting turn to settle",
  );

  const queued = await t.turn("creq_cd23456789", "raced with compaction");
  expect(queued.error).toBeUndefined();
  expect(t.promptCount()).toBe(2);

  t.releaseCompaction();
  await t.bridge.waitFor(
    () => t.settledAfterReply("raced with compaction"),
    "the retried prompt to run",
  );
  expect(t.boundaries().map((d) => d.status)).not.toContain("failed");
  expect(t.promptCount()).toBe(3);
}, 30_000);

it("drops a prompt held behind compaction when the thread is released", async () => {
  const t = await start();
  expect(
    (await t.turn("creq_ab23456789", "/compact-on-settle")).error,
  ).toBeUndefined();
  await t.bridge.waitFor(
    () => t.boundaries().length >= 1,
    "the compacting turn to settle",
  );
  expect((await t.turn("creq_cd23456789", "never sent")).error).toBeUndefined();

  const released = await t.bridge.request(++nextId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: t.providerThreadId,
    intent: "release",
    activeTurnId: null,
  });
  expect(released.error).toBeUndefined();
  expect(t.promptCount()).toBe(1);
}, 30_000);
