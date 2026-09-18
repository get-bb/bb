import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCallResponse } from "@bb/domain";
import {
  PLUGIN_TOOL_CALL_AWAITING_USER_RESULT_TEXT,
  PluginToolCallRegistry,
  detachActivePluginToolCallForUserInput,
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

  function createRegistry() {
    return new PluginToolCallRegistry({ logger: testLogger });
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

  it("aborts an ordinary tool when its round trip is cancelled and never delivers its late result", async () => {
    const registry = createRegistry();
    const roundTrip = new AbortController();
    const onDetachedResult = vi.fn(async () => undefined);
    const result = deferred<ToolCallResponse>();
    let toolSignal: AbortSignal | undefined;
    const response = registry.run({
      pluginId: "fixture",
      threadId: "thread",
      callId: "call",
      toolName: "ordinary",
      roundTrip: roundTrip.signal,
      invoke: async (signal) => {
        toolSignal = signal;
        const value = await result.promise;
        detachActivePluginToolCallForUserInput();
        return value;
      },
      onDetachedResult,
    });
    roundTrip.abort("request-ended");
    expect(toolSignal?.aborted).toBe(true);
    expect(toolSignal?.reason).toBe("request-ended");
    await expect(response).resolves.toMatchObject({ success: false });
    result.resolve(textResponse("late answer"));
    await vi.advanceTimersByTimeAsync(0);
    expect(onDetachedResult).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  it("does not invoke a tool whose round trip was already aborted", async () => {
    const registry = createRegistry();
    const invoke = vi.fn(async () => textResponse("answer"));
    const onDetachedResult = vi.fn(async () => undefined);
    const response = registry.run({
      pluginId: "fixture",
      threadId: "thread",
      callId: "call",
      toolName: "ordinary",
      roundTrip: AbortSignal.abort(),
      invoke,
      onDetachedResult,
    });
    await expect(response).resolves.toMatchObject({ success: false });
    expect(invoke).not.toHaveBeenCalled();
    expect(onDetachedResult).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  it("keeps a slow tool on its round trip beyond the former deadline", async () => {
    const registry = createRegistry();
    const onDetachedResult = vi.fn(async () => undefined);
    const result = deferred<ToolCallResponse>();
    const response = registry.run({
      pluginId: "fixture",
      threadId: "thread",
      callId: "call",
      toolName: "ordinary",
      roundTrip: new AbortController().signal,
      invoke: () => result.promise,
      onDetachedResult,
    });
    const received = vi.fn();
    void response.then(received);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(received).not.toHaveBeenCalled();
    result.resolve(textResponse("finished"));
    await expect(response).resolves.toEqual(textResponse("finished"));
    expect(onDetachedResult).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  it("answers the round trip at once when the tool asks the user for input", async () => {
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
      invoke: async (signal) => {
        toolSignal = signal;
        await Promise.resolve();
        detachActivePluginToolCallForUserInput();
        return result.promise;
      },
      onDetachedResult,
    });

    await expect(response).resolves.toEqual(
      textResponse(PLUGIN_TOOL_CALL_AWAITING_USER_RESULT_TEXT),
    );
    roundTrip.abort();
    expect(toolSignal?.aborted).toBe(false);
    expect(registry.size).toBe(1);
    result.resolve(textResponse("the user answered"));
    await vi.advanceTimersByTimeAsync(0);
    expect(onDetachedResult).toHaveBeenCalledWith(
      textResponse("the user answered"),
    );
    expect(registry.size).toBe(0);
  });

  it("ignores a detach request made outside any tool call", () => {
    expect(() => detachActivePluginToolCallForUserInput()).not.toThrow();
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
        detachActivePluginToolCallForUserInput();
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
