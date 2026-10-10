import { expect, it, vi } from "vitest";
import { PiRpcSession, type PiRpcEvent } from "./rpc-session.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(settlement = true) {
  const events: PiRpcEvent[] = [];
  const aDelivered = deferred();
  const requestOk = vi.fn(async () => undefined);
  const session = new PiRpcSession(
    {
      cwd: ".",
      sessionFilePath: "unused",
      sessionDir: ".",
      scratchDir: ".",
      extensionPath: "unused",
      recordThreadId: "settlement-test",
    },
    async () => ({ content: "" }),
    (event) => {
      events.push(event);
      if (event.type === "agent_settled") aDelivered.resolve();
    },
    () => undefined,
  );
  const control = session as unknown as {
    child: unknown;
    isProcessing: boolean;
    handleEvent(event: PiRpcEvent): void;
    handleChannelMessage(message: Record<string, unknown>): void;
    deliveryChain: Promise<void>;
    runs: Map<number, unknown>;
    pendingRunSettlements: unknown[];
  };
  control.child = { exited: false, requestOk };
  control.handleChannelMessage({ kind: "ready", agentSettled: settlement });
  const event = (value: PiRpcEvent) => control.handleEvent(value);
  const leaf = (kind: string, leafId: string) =>
    control.handleChannelMessage({ kind, leafId });
  const end = (name: string, stopReason = "stop", willRetry = false) => {
    leaf("agent-end-leaf", `end-${name}`);
    event({
      type: "agent_end",
      willRetry,
      messages: [
        { role: "assistant", stopReason, errorMessage: `failure-${name}` },
      ],
    });
  };
  const settle = (name: string, fields: Record<string, unknown> = {}) => {
    leaf("agent-settled-leaf", `checkpoint-${name}`);
    event({ type: "agent_settled", ...fields });
  };
  return {
    session,
    control,
    events,
    event,
    leaf,
    end,
    settle,
    aDelivered,
    requestOk,
  };
}

it("keeps B processing and checkpoints run-local when A delivery is delayed", async () => {
  const h = harness();
  const a = h.session.prompt("A");
  await a.consumed;
  h.event({ type: "agent_start", name: "A" });
  h.end("A", "error");
  h.event({ type: "agent_settled" });
  const b = h.session.prompt("B");
  await b.consumed;
  h.event({ type: "agent_start", name: "B" });
  h.end("B");
  h.event({ type: "agent_settled" });
  expect(h.events.filter((e) => e.settlementOnly)).toHaveLength(0);
  expect(h.control.isProcessing).toBe(true);
  h.leaf("agent-settled-leaf", "checkpoint-A");
  await h.aDelivered.promise;
  expect(await a.settled).toEqual({
    boundaryDelivered: true,
    error: new Error("failure-A"),
  });
  expect(h.control.isProcessing).toBe(true);
  expect(h.control.runs.has(2)).toBe(true);
  h.leaf("agent-settled-leaf", "checkpoint-B");
  expect(await b.settled).toEqual({ boundaryDelivered: true });
  await h.control.deliveryChain;
  expect(
    h.events.filter((e) => e.settlementOnly).map((e) => e.providerCheckpointId),
  ).toEqual(["checkpoint-A", "checkpoint-B"]);
  expect(
    h.events
      .filter((e) => e.type === "agent_start" || e.settlementOnly)
      .map((e) => e.name ?? e.providerCheckpointId),
  ).toEqual(["A", "checkpoint-A", "B", "checkpoint-B"]);
  expect(h.control.isProcessing).toBe(false);
  expect(h.control.pendingRunSettlements).toHaveLength(0);
  expect(h.control.runs.size).toBe(0);
  expect(h.requestOk.mock.calls).toHaveLength(2);
});

it.each(["retry", "overflow", "followUp"])(
  "waits for authoritative settlement through native %s",
  async (kind) => {
    const h = harness();
    const dispatch = h.session.prompt("native recovery");
    await dispatch.consumed;
    const settled = vi.fn();
    void dispatch.settled.then(settled);
    h.event({ type: "agent_start" });
    h.end("attempt", "error", kind === "retry");
    if (kind === "overflow")
      h.event({
        type: "compaction_end",
        reason: "overflow",
        aborted: false,
        willRetry: true,
      });
    if (kind === "retry")
      h.event({ type: "auto_retry_start", attempt: 1, maxAttempts: 3 });
    await h.control.deliveryChain;
    expect(settled).not.toHaveBeenCalled();
    expect(h.control.isProcessing).toBe(true);
    expect(
      h.events
        .filter((e) => e.type === "agent_end")
        .every((e) => e.deferSettlement),
    ).toBe(true);
    h.event({ type: "agent_start" });
    h.end("continuation");
    h.settle("final");
    expect(await dispatch.settled).toEqual({ boundaryDelivered: true });
    await h.control.deliveryChain;
    expect(h.events.filter((e) => e.settlementOnly)).toHaveLength(1);
    expect(h.control.runs.size).toBe(0);
    expect(h.requestOk).toHaveBeenCalledTimes(kind === "overflow" ? 2 : 1);
  },
);

it.each([false, true])(
  "preserves exhausted overflow failure after length, aborted=%s",
  async (aborted) => {
    const h = harness();
    const dispatch = h.session.prompt("overflow");
    await dispatch.consumed;
    h.event({ type: "agent_start" });
    h.end("length", "length");
    h.event({
      type: "compaction_end",
      reason: "overflow",
      willRetry: false,
      aborted,
      ...(!aborted ? { errorMessage: "exhausted" } : {}),
    });
    h.settle("failed");
    expect(await dispatch.settled).toEqual({
      boundaryDelivered: true,
      error: new Error(
        aborted ? "Automatic context compaction was interrupted" : "exhausted",
      ),
    });
    expect(h.events.filter((e) => e.settlementOnly)).toEqual([
      expect.objectContaining({ settlementError: expect.any(String) }),
    ]);
  },
);

it("clears an earlier overflow failure only when native work continues", async () => {
  const h = harness();
  const dispatch = h.session.prompt("native recovery");
  await dispatch.consumed;
  h.event({ type: "agent_start" });
  h.end("attempt", "length");
  h.event({
    type: "compaction_end",
    reason: "overflow",
    willRetry: false,
    errorMessage: "exhausted",
  });
  h.event({ type: "agent_start" });
  h.end("continuation");
  h.settle("final");
  expect(await dispatch.settled).toEqual({ boundaryDelivered: true });
  expect(h.control.runs.size).toBe(0);
});

it.each([undefined, false, true, "false", null, 0])(
  "validates authoritative aborted=%s without inventing retries",
  async (aborted) => {
    const h = harness();
    const dispatch = h.session.prompt("hello");
    await dispatch.consumed;
    h.event({ type: "agent_start" });
    h.end("A");
    h.settle("A", aborted === undefined ? {} : { aborted });
    const outcome = await dispatch.settled;
    expect(outcome?.boundaryDelivered).toBe(true);
    expect(outcome?.error instanceof Error).toBe(
      aborted !== undefined && aborted !== false,
    );
    expect(h.requestOk).toHaveBeenCalledTimes(1);
  },
);

it("ignores duplicate authoritative settlement without duplicate delivery", async () => {
  const h = harness();
  const dispatch = h.session.prompt("hello");
  await dispatch.consumed;
  h.event({ type: "agent_start" });
  h.end("A");
  h.settle("A");
  h.settle("A");
  await dispatch.settled;
  await h.control.deliveryChain;
  expect(h.events.filter((e) => e.settlementOnly)).toHaveLength(1);
});

it.each(["stop", "aborted", "error"])(
  "retains legacy agent_end fallback for %s",
  async (reason) => {
    const h = harness(false);
    const dispatch = h.session.prompt("legacy");
    await dispatch.consumed;
    h.event({ type: "agent_start" });
    h.end("legacy", reason);
    const outcome = await dispatch.settled;
    expect(outcome?.boundaryDelivered).toBe(true);
    expect(outcome?.error instanceof Error).toBe(reason !== "stop");
    await h.control.deliveryChain;
    expect(h.control.runs.size).toBe(0);
    expect(h.events.some((e) => e.deferSettlement)).toBe(false);
  },
);
