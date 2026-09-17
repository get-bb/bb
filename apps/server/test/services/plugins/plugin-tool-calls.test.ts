import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCallResponse } from "@bb/domain";
import {
  PLUGIN_TOOL_CALL_AWAITING_PERSON_RESULT_TEXT,
  PLUGIN_TOOL_CALL_DETACHED_RESULT_TEXT,
  PluginToolCallRegistry,
  detachActivePluginToolCallForPerson,
} from "../../../src/services/plugins/plugin-tool-calls.js";
import { testLogger } from "../../helpers/test-app.js";

function textResponse(text: string, success = true): ToolCallResponse {
  return { success, contentItems: [{ type: "inputText", text }] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("PluginToolCallRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function createRegistry(detachAfterMs = 1_000) {
    return new PluginToolCallRegistry({ logger: testLogger, detachAfterMs });
  }

  it("returns the tool result through the round trip when it settles in time", async () => {
    const registry = createRegistry();
    const roundTrip = new AbortController();
    const onDetachedResult = vi.fn(async () => undefined);
    const result = deferred<ToolCallResponse>();

    const response = registry.run({
      pluginId: "fixture",
      threadId: "thread",
      callId: "call",
      toolName: "ask",
      roundTrip: roundTrip.signal,
      invoke: () => result.promise,
      onDetachedResult,
    });
    result.resolve(textResponse("answered"));

    await expect(response).resolves.toEqual(textResponse("answered"));
    expect(onDetachedResult).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  it("keeps the call running after the round trip is cancelled and delivers the late result", async () => {
    const registry = createRegistry();
    const roundTrip = new AbortController();
    const onDetachedResult = vi.fn(async () => undefined);
    const result = deferred<ToolCallResponse>();
    let toolSignal: AbortSignal | undefined;

    const response = registry.run({
      pluginId: "fixture",
      threadId: "thread",
      callId: "call",
      toolName: "ask",
      roundTrip: roundTrip.signal,
      invoke: (signal) => {
        toolSignal = signal;
        return result.promise;
      },
      onDetachedResult,
    });
    roundTrip.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(toolSignal?.aborted).toBe(false);
    expect(registry.size).toBe(1);
    result.resolve(textResponse("late answer"));
    await vi.advanceTimersByTimeAsync(0);

    expect(onDetachedResult).toHaveBeenCalledWith(textResponse("late answer"));
    expect(registry.size).toBe(0);
    await expect(
      Promise.race([response, Promise.resolve("unsettled")]),
    ).resolves.toBe("unsettled");
  });

  it("answers the round trip with the still-running stub at the deadline and delivers later", async () => {
    const registry = createRegistry(500);
    const roundTrip = new AbortController();
    const onDetachedResult = vi.fn(async () => undefined);
    const result = deferred<ToolCallResponse>();

    const response = registry.run({
      pluginId: "fixture",
      threadId: "thread",
      callId: "call",
      toolName: "ask",
      roundTrip: roundTrip.signal,
      invoke: () => result.promise,
      onDetachedResult,
    });
    await vi.advanceTimersByTimeAsync(500);

    await expect(response).resolves.toEqual(
      textResponse(PLUGIN_TOOL_CALL_DETACHED_RESULT_TEXT),
    );
    expect(onDetachedResult).not.toHaveBeenCalled();

    result.resolve(textResponse("after the stub"));
    await vi.advanceTimersByTimeAsync(0);
    expect(onDetachedResult).toHaveBeenCalledWith(
      textResponse("after the stub"),
    );
  });

  it("answers the round trip at once when the tool asks the person for input", async () => {
    const registry = createRegistry();
    const roundTrip = new AbortController();
    const onDetachedResult = vi.fn(async () => undefined);
    const result = deferred<ToolCallResponse>();

    const response = registry.run({
      pluginId: "fixture",
      threadId: "thread",
      callId: "call",
      toolName: "ask",
      roundTrip: roundTrip.signal,
      invoke: async () => {
        await Promise.resolve();
        detachActivePluginToolCallForPerson();
        return result.promise;
      },
      onDetachedResult,
    });

    await expect(response).resolves.toEqual(
      textResponse(PLUGIN_TOOL_CALL_AWAITING_PERSON_RESULT_TEXT),
    );
    expect(registry.size).toBe(1);
    result.resolve(textResponse("the person answered"));
    await vi.advanceTimersByTimeAsync(0);
    expect(onDetachedResult).toHaveBeenCalledWith(
      textResponse("the person answered"),
    );
    expect(registry.size).toBe(0);
  });

  it("ignores a detach request made outside any tool call", () => {
    expect(() => detachActivePluginToolCallForPerson()).not.toThrow();
  });

  it("drops a detached result once its thread was stopped", async () => {
    const registry = createRegistry();
    const roundTrip = new AbortController();
    const onDetachedResult = vi.fn(async () => undefined);
    const result = deferred<ToolCallResponse>();
    let toolSignal: AbortSignal | undefined;

    void registry.run({
      pluginId: "fixture",
      threadId: "thread",
      callId: "call",
      toolName: "ask",
      roundTrip: roundTrip.signal,
      invoke: (signal) => {
        toolSignal = signal;
        return result.promise;
      },
      onDetachedResult,
    });
    roundTrip.abort();
    registry.abortForThreads(["other", "thread"], "thread-stopped");

    expect(toolSignal?.aborted).toBe(true);
    expect(toolSignal?.reason).toBe("thread-stopped");
    result.resolve(textResponse("dismissed", false));
    await vi.advanceTimersByTimeAsync(0);

    expect(onDetachedResult).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  it("aborts only the disposed plugin's calls", async () => {
    const registry = createRegistry();
    const signals: AbortSignal[] = [];
    for (const pluginId of ["alpha", "beta"]) {
      void registry.run({
        pluginId,
        threadId: "thread",
        callId: `call-${pluginId}`,
        toolName: "ask",
        roundTrip: new AbortController().signal,
        invoke: (signal) => {
          signals.push(signal);
          return new Promise(() => undefined);
        },
        onDetachedResult: async () => undefined,
      });
    }
    registry.abortForPlugin("alpha", "plugin-disposed");

    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
  });

  it("turns a rejected invocation into a failed tool result", async () => {
    const registry = createRegistry();
    const response = registry.run({
      pluginId: "fixture",
      threadId: "thread",
      callId: "call",
      toolName: "ask",
      roundTrip: new AbortController().signal,
      invoke: () => Promise.reject(new Error("boom")),
      onDetachedResult: async () => undefined,
    });

    await expect(response).resolves.toEqual(
      textResponse('Tool "ask" failed: boom', false),
    );
  });
});
