import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import {
  FULL_PERMISSION_OPTIONS,
  type FakePiBridgeHarness,
  startFakePiBridge,
} from "./test-support.js";

let harness: FakePiBridgeHarness;

beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-recovery-",
    initialize: true,
    processLog: true,
  });
});

afterEach(async () => {
  await harness.teardown();
});

it("resumes the same provider thread on the next turn after a clean child exit", async () => {
  const threadId = "thr_recovery";
  const started = await harness.startThread(threadId);
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(started.result);

  await harness.request(2001, "turn/start", {
    threadId,
    providerThreadId,
    clientRequestId: "creq_ab23456789",
    input: [{ type: "text", text: "/die", mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  await harness.waitForDelta(
    threadId,
    (delta) => delta.kind === "turn.boundary" && delta.status === "failed",
  );
  await harness.waitFor(
    () => harness.runningChildPids().length === 0,
    "the original Pi child to exit",
  );
  const before = harness.deltasOf(threadId).length;
  const messagesBefore = harness.messages.length;

  const response = await harness.request(2002, "turn/start", {
    threadId,
    providerThreadId,
    clientRequestId: "creq_cd23456789",
    input: [{ type: "text", text: "continue after exit", mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  expect(response.error).toBeUndefined();
  expect(response.result).toMatchObject({ threadId });
  await harness.waitForDelta(
    threadId,
    (delta) => delta.kind === "turn.boundary" && delta.status === "completed",
    before,
  );
  expect(harness.readProcessLog().spawned).toHaveLength(2);
  expect(harness.messages.slice(messagesBefore)).toContainEqual(
    expect.objectContaining({
      method: "thread/identity",
      params: expect.objectContaining({ threadId, providerThreadId }),
    }),
  );
}, 90_000);
