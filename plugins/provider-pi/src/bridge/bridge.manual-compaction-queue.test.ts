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
      apply: { settings: [], sessionOptions: [], providerOptions: [] },
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

function compactionTurnKinds(deltas: Record<string, unknown>[]): string[] {
  return deltas
    .filter((d) =>
      ["turn.open", "turn.boundary", "item.open", "item.close"].includes(
        String(d.kind),
      ),
    )
    .map((d) =>
      d.kind === "item.open" || d.kind === "item.close"
        ? `${String(d.kind)}:${String((d.item as { type?: unknown }).type)}`
        : String(d.kind),
    );
}

it("answers busy while a Pi extension compacts after a run, and gives the compaction its own turn", async () => {
  const t = await start();
  expect(
    (await t.turn("creq_ab23456789", "/compact-on-settle")).result,
  ).toEqual({ admission: "accepted" });
  await t.bridge.waitFor(
    () =>
      compactionTurnKinds(t.bridge.deltasOf(THREAD_ID)).includes(
        "item.open:compaction",
      ),
    "the compaction to open",
  );
  expect(compactionTurnKinds(t.bridge.deltasOf(THREAD_ID))).toEqual([
    "turn.open",
    "turn.open",
    "turn.boundary",
    "turn.open",
    "item.open:compaction",
  ]);

  const steer = await t.bridge.request(++nextId, "turn/steer", {
    threadId: THREAD_ID,
    providerThreadId: t.providerThreadId,
    clientRequestId: "creq_cd2345678a",
    expectedTurnId: "turn-2",
    input: [{ type: "text", text: "steer during compaction", mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  expect(steer.result).toEqual({
    admission: "busy",
    message: "Pi is compacting the context.",
  });

  const refused = await t.turn("creq_cd23456789", "sent during compaction");
  expect(refused.result).toEqual({
    admission: "busy",
    message: "Pi is compacting the context.",
  });
  expect(
    t.bridge
      .deltasOf(THREAD_ID)
      .filter((d) => d.kind === "input.accepted")
      .map((d) => d.clientRequestId),
  ).toEqual(["creq_ab23456789"]);
  expect(t.promptCount()).toBe(1);

  t.releaseCompaction();
  await t.bridge.waitFor(
    () => t.boundaries().length >= 2,
    "the compaction turn to settle",
  );
  expect(compactionTurnKinds(t.bridge.deltasOf(THREAD_ID)).slice(3)).toEqual([
    "turn.open",
    "item.open:compaction",
    "item.close:compaction",
    "turn.boundary",
  ]);

  expect((await t.turn("creq_ef23456789", "after compaction")).result).toEqual({
    admission: "accepted",
  });
  await t.bridge.waitFor(
    () => t.settledAfterReply("after compaction"),
    "the next prompt to run",
  );
  expect(t.boundaries().map((d) => d.status)).not.toContain("failed");
  expect(t.promptCount()).toBe(2);
}, 30_000);

it("answers busy when Pi refuses a prompt for a compaction the bridge had not seen start", async () => {
  const t = await start();
  expect(
    (await t.turn("creq_ab23456789", "/compact-on-settle-late")).error,
  ).toBeUndefined();
  await t.bridge.waitFor(() => t.boundaries().length >= 1, "the run to settle");

  const refused = await t.turn("creq_cd23456789", "raced with compaction");
  expect(refused.result).toMatchObject({ admission: "busy" });
  expect(t.promptCount()).toBe(2);
  await t.bridge.waitFor(
    () =>
      compactionTurnKinds(t.bridge.deltasOf(THREAD_ID)).includes(
        "item.open:compaction",
      ),
    "Pi to report the compaction",
  );

  t.releaseCompaction();
  await t.bridge.waitFor(
    () => t.boundaries().length >= 2,
    "the compaction turn to settle",
  );
  expect(
    (await t.turn("creq_ef23456789", "raced with compaction")).result,
  ).toEqual({ admission: "accepted" });
  await t.bridge.waitFor(
    () => t.settledAfterReply("raced with compaction"),
    "the resent prompt to run",
  );
  expect(t.boundaries().map((d) => d.status)).not.toContain("failed");
  expect(t.promptCount()).toBe(3);
}, 30_000);
