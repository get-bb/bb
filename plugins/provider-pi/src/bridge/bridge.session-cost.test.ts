import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FULL_PERMISSION_OPTIONS,
  type FakePiBridgeHarness,
  startFakePiBridge,
} from "./test-support.js";

const SESSION_COST_TEST_TIMEOUT_MS = 60_000;

let harness: FakePiBridgeHarness;

beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-session-cost-",
    initialize: true,
  });
}, 30_000);

afterEach(async () => {
  await harness.teardown();
}, 30_000);

function contextWindowDeltas(threadId: string): Record<string, unknown>[] {
  return harness
    .deltasOf(threadId)
    .filter((delta) => delta.kind === "contextWindow");
}

async function runTurns(threadId: string, count: number): Promise<void> {
  const start = await harness.startThread(threadId);
  const providerThreadId = (start.result as { providerThreadId?: unknown })
    .providerThreadId;
  if (typeof providerThreadId !== "string")
    throw new Error("missing providerThreadId");
  let seen = 0;
  for (let turn = 1; turn <= count; turn += 1) {
    const response = await harness.request(turn, "turn/start", {
      threadId,
      providerThreadId,
      clientRequestId: `creq_${String(turn + 1).repeat(10)}`,
      input: [{ type: "text", text: `turn ${turn}`, mentions: [] }],
      options: FULL_PERMISSION_OPTIONS,
    });
    expect(response.error).toBeUndefined();
    seen = await harness.waitForTurnBoundary(threadId, seen);
  }
}

it(
  "repeats the session's cumulative cost on every context window update",
  async () => {
    const threadId = "thr_session_cost";
    await runTurns(threadId, 2);

    expect(contextWindowDeltas(threadId)).toEqual([
      expect.objectContaining({ cost: { amount: 0.25, currency: "USD" } }),
      expect.objectContaining({ cost: { amount: 0.5, currency: "USD" } }),
    ]);
  },
  SESSION_COST_TEST_TIMEOUT_MS,
);

it(
  "omits the cost while pi reports none",
  async () => {
    vi.stubEnv("FAKE_PI_SESSION_COST", "0");
    const threadId = "thr_session_cost_free";
    await runTurns(threadId, 1);

    const deltas = contextWindowDeltas(threadId);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).not.toHaveProperty("cost");
  },
  SESSION_COST_TEST_TIMEOUT_MS,
);
