import { describe, expect, it } from "vitest";
import { RuntimeToolCalls } from "./runtime-provider-requests.js";

const request = {
  requestId: 1,
  threadId: "thread-a",
  providerThreadId: "provider-a",
  turnId: "turn-a",
  callId: "call-a",
  tool: "question",
};

describe("runtime tool cancellation ownership", () => {
  it("scopes cancellation to the requesting process and preserves JSON-RPC id types", () => {
    const calls = new RuntimeToolCalls();
    const first = calls.start("process-a", request)!;
    const otherProcess = calls.start("process-b", request)!;
    const stringId = calls.start("process-a", { ...request, requestId: "1" })!;
    calls.cancel("process-a", 1);
    expect(first.signal.aborted).toBe(true);
    expect(otherProcess.signal.aborted).toBe(false);
    expect(stringId.signal.aborted).toBe(false);
    expect(calls.start("process-b", request)).toBeNull();
    const next = calls.start("process-a", request)!;
    calls.finish("process-a", 1, first);
    calls.cancel("process-a", 1);
    expect(next.signal.aborted).toBe(true);
  });

  it("cancels only the finishing turn and cancels all requests on thread detach", () => {
    const calls = new RuntimeToolCalls();
    const old = calls.start("process", request)!;
    const next = calls.start("process", {
      ...request,
      requestId: 2,
      turnId: "turn-b",
    })!;
    const sibling = calls.start("process", {
      ...request,
      requestId: 3,
      threadId: "thread-b",
    })!;
    calls.cancelThread("thread-a", "turn-a");
    expect(old.signal.aborted).toBe(true);
    expect(next.signal.aborted).toBe(false);
    calls.cancelThread("thread-a");
    expect(next.signal.aborted).toBe(true);
    expect(sibling.signal.aborted).toBe(false);
  });
});
