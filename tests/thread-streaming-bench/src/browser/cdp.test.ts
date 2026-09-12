import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CdpCommandError,
  CdpConnection,
  CdpSessionError,
  CdpTimeoutError,
  type CdpSocket,
} from "./cdp.js";

type Listener = (event: { data?: unknown }) => void;

class FakeSocket implements CdpSocket {
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.emit("close", {});
  }

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  receive(message: unknown): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const OPTIONS = { commandTimeoutMs: 60_000 };

function settle(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => "resolved",
    (reason: unknown) => reason,
  );
}

describe("CdpConnection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches responses by id and surfaces protocol errors with method and code", async () => {
    const socket = new FakeSocket();
    const connection = new CdpConnection(socket, OPTIONS);
    const first = connection.send(
      "Runtime.evaluate",
      { expression: "1" },
      "S1",
    );
    const second = connection.send("Page.navigate", { url: "about:blank" });
    expect(socket.sent).toEqual([
      {
        id: 1,
        method: "Runtime.evaluate",
        params: { expression: "1" },
        sessionId: "S1",
      },
      { id: 2, method: "Page.navigate", params: { url: "about:blank" } },
    ]);
    socket.receive({
      id: 2,
      error: { code: -32000, message: "Cannot navigate" },
    });
    socket.receive({ id: 1, result: { result: { type: "number", value: 1 } } });
    await expect(first).resolves.toEqual({
      result: { type: "number", value: 1 },
    });
    const error = await second.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(CdpCommandError);
    expect(error).toMatchObject({ method: "Page.navigate", code: -32000 });
  });

  it("routes events to the matching session only and supports unsubscribe", () => {
    const socket = new FakeSocket();
    const connection = new CdpConnection(socket, OPTIONS);
    const pageEvents: unknown[] = [];
    const browserEvents: unknown[] = [];
    const unsubscribe = connection.on(
      "Page.loadEventFired",
      (params) => pageEvents.push(params),
      "S1",
    );
    connection.on("Page.loadEventFired", (params) =>
      browserEvents.push(params),
    );
    socket.receive({
      method: "Page.loadEventFired",
      params: { timestamp: 1 },
      sessionId: "S1",
    });
    socket.receive({
      method: "Page.loadEventFired",
      params: { timestamp: 2 },
      sessionId: "S2",
    });
    socket.receive({ method: "Page.loadEventFired", params: { timestamp: 3 } });
    unsubscribe();
    socket.receive({
      method: "Page.loadEventFired",
      params: { timestamp: 4 },
      sessionId: "S1",
    });
    socket.emit("message", { data: "not json" });
    expect(pageEvents).toEqual([{ timestamp: 1 }]);
    expect(browserEvents).toEqual([{ timestamp: 3 }]);
  });

  it("rejects pending commands and event waiters when the socket closes", async () => {
    const socket = new FakeSocket();
    const connection = new CdpConnection(socket, OPTIONS);
    const pending = connection.send("Tracing.end");
    const waiter = connection.waitForEvent("Tracing.tracingComplete", {
      timeoutMs: 60_000,
    });
    const cancelled = connection.waitForEvent("Page.loadEventFired", {
      timeoutMs: 60_000,
    });
    cancelled.cancel();
    socket.emit("close", {});
    await expect(pending).rejects.toThrow(
      "CDP connection closed while waiting for Tracing.end",
    );
    await expect(waiter.promise).rejects.toThrow(
      "CDP connection closed while waiting for Tracing.tracingComplete",
    );
    expect(connection.isClosed).toBe(true);
    await expect(connection.send("Browser.close")).rejects.toThrow(
      "cannot send Browser.close",
    );
    await expect(
      connection.waitForEvent("Page.loadEventFired", { timeoutMs: 10 }).promise,
    ).rejects.toThrow("cannot wait for Page.loadEventFired");
  });

  it("resolves a waiter with event params and times out otherwise", async () => {
    const socket = new FakeSocket();
    const connection = new CdpConnection(socket, OPTIONS);
    const load = connection.waitForEvent("Page.loadEventFired", {
      sessionId: "S1",
      timeoutMs: 1_000,
    });
    socket.receive({
      method: "Page.loadEventFired",
      params: { timestamp: 9 },
      sessionId: "S1",
    });
    await expect(load.promise).resolves.toEqual({ timestamp: 9 });
    await expect(
      connection.waitForEvent("Page.frameNavigated", { timeoutMs: 10 }).promise,
    ).rejects.toThrow("Timed out after 10 ms waiting for Page.frameNavigated");
  });

  it("rejects commands that exceed the default or per-call timeout and ignores late responses", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const connection = new CdpConnection(socket, { commandTimeoutMs: 1_000 });
    const byDefault = settle(connection.send("Runtime.evaluate", {}, "S1"));
    const perCall = settle(
      connection.send("Page.navigate", {}, "S1", { timeoutMs: 50 }),
    );
    const answered = connection.send("Browser.getVersion");
    await vi.advanceTimersByTimeAsync(50);
    const perCallError = await perCall;
    expect(perCallError).toBeInstanceOf(CdpTimeoutError);
    expect(perCallError).toMatchObject({
      method: "Page.navigate",
      timeoutMs: 50,
      message: "Page.navigate did not respond within 50 ms",
    });
    socket.receive({ id: 3, result: { product: "Chrome" } });
    await expect(answered).resolves.toEqual({ product: "Chrome" });
    await vi.advanceTimersByTimeAsync(950);
    expect(await byDefault).toBeInstanceOf(CdpTimeoutError);
    socket.receive({ id: 1, result: { late: true } });
    socket.receive({ id: 2, result: { late: true } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects pending commands and waiters of a crashed session and refuses new ones", async () => {
    const socket = new FakeSocket();
    const connection = new CdpConnection(socket, OPTIONS);
    const crashed = settle(connection.send("Runtime.evaluate", {}, "S1"));
    const crashedLoad = settle(
      connection.waitForEvent("Page.loadEventFired", {
        sessionId: "S1",
        timeoutMs: 60_000,
      }).promise,
    );
    const otherSession = connection.send("Runtime.evaluate", {}, "S2");
    const browserLevel = connection.send("Target.getTargets");
    socket.receive({
      method: "Inspector.targetCrashed",
      params: {},
      sessionId: "S1",
    });
    const crashError = await crashed;
    expect(crashError).toBeInstanceOf(CdpSessionError);
    expect(crashError).toMatchObject({
      method: "Runtime.evaluate",
      sessionId: "S1",
    });
    expect(String(crashError)).toContain("Target crashed");
    expect(await crashedLoad).toBeInstanceOf(CdpSessionError);
    await expect(
      connection.send("Page.captureScreenshot", {}, "S1"),
    ).rejects.toThrow("Target crashed; Page.captureScreenshot on session S1");
    socket.receive({ id: 2, result: { ok: 2 } });
    socket.receive({ id: 3, result: { targetInfos: [] } });
    await expect(otherSession).resolves.toEqual({ ok: 2 });
    await expect(browserLevel).resolves.toEqual({ targetInfos: [] });
  });

  it("fails a session when the browser reports it detached", async () => {
    const socket = new FakeSocket();
    const connection = new CdpConnection(socket, OPTIONS);
    const pending = settle(
      connection.send("Runtime.evaluate", { awaitPromise: true }, "S7"),
    );
    socket.receive({
      method: "Target.detachedFromTarget",
      params: { sessionId: "S7", targetId: "T7" },
    });
    const error = await pending;
    expect(error).toBeInstanceOf(CdpSessionError);
    expect(String(error)).toContain("Target detached");
    await expect(
      connection.waitForEvent("Page.loadEventFired", {
        sessionId: "S7",
        timeoutMs: 10,
      }).promise,
    ).rejects.toThrow("Target detached");
  });
});
