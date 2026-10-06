import type { PluginCliExecutionResult } from "@get-bb/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pluginCliResponse } from "../../src/routes/plugins.js";

const RESULT: PluginCliExecutionResult = {
  exitCode: 0,
  stdout: '{"ok":true}\n',
  stderr: "",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("pluginCliResponse", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("answers a command that finishes quickly with a plain JSON body", async () => {
    const response = await pluginCliResponse(Promise.resolve(RESULT), 50);

    expect(response.headers.get("content-type")).toMatch(/^application\/json/u);
    expect(response.headers.get("cache-control")).toBeNull();
    expect(await response.text()).toBe(JSON.stringify(RESULT));
  });

  it("sends headers and keepalive bytes before a slow command settles", async () => {
    const pending = deferred<PluginCliExecutionResult>();
    const responsePromise = pluginCliResponse(pending.promise, 5);
    await vi.advanceTimersByTimeAsync(5);
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-transform");
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("\n");
    await vi.advanceTimersByTimeAsync(5);
    const keepalive = await reader.read();
    expect(new TextDecoder().decode(keepalive.value)).toBe("\n");
    pending.resolve(RESULT);

    let text =
      new TextDecoder().decode(first.value) +
      new TextDecoder().decode(keepalive.value);
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    expect(text.trim()).toBe(JSON.stringify(RESULT));
    expect(text.indexOf("{")).toBeGreaterThan(1);
    expect(JSON.parse(text)).toEqual(RESULT);
  });

  it("reports a command that rejects after streaming began as a failed exit", async () => {
    const pending = deferred<PluginCliExecutionResult>();
    const responsePromise = pluginCliResponse(pending.promise, 5);
    await vi.advanceTimersByTimeAsync(5);
    const response = await responsePromise;
    pending.reject(new Error("plugin stopped"));

    expect(await response.json()).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "plugin stopped",
    });
  });

  it("stops writing once the client goes away", async () => {
    const pending = deferred<PluginCliExecutionResult>();
    const responsePromise = pluginCliResponse(pending.promise, 5);
    await vi.advanceTimersByTimeAsync(5);
    const response = await responsePromise;
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    expect(vi.getTimerCount()).toBe(0);

    pending.resolve(RESULT);
    await vi.advanceTimersByTimeAsync(50);
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(vi.getTimerCount()).toBe(0);
  });
});
