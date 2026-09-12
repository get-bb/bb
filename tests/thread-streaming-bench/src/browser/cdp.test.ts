import { afterEach, describe, expect, it, vi } from "vitest";
import { CdpCommandError, CdpConnection, type CdpSocket } from "./cdp.js";

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

  it("matches responses by id and surfaces protocol errors", async () => {
    const socket = new FakeSocket();
    const connection = new CdpConnection(socket);
    const first = connection.send(
      "Runtime.evaluate",
      { expression: "1" },
      "S1",
    );
    const second = settle(
      connection.send("Page.navigate", { url: "about:blank" }),
    );
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
    const error = await second;
    expect(error).toBeInstanceOf(CdpCommandError);
    expect(String(error)).toContain(
      "Page.navigate failed (-32000): Cannot navigate",
    );
  });

  it("routes events to the matching session only and supports unsubscribe", () => {
    const socket = new FakeSocket();
    const connection = new CdpConnection(socket);
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
    expect(pageEvents).toEqual([{ timestamp: 1 }]);
    expect(browserEvents).toEqual([{ timestamp: 3 }]);
  });

  it("rejects pending commands when the socket closes and refuses later sends", async () => {
    const socket = new FakeSocket();
    const connection = new CdpConnection(socket);
    const pending = connection.send("Tracing.end");
    socket.emit("close", {});
    await expect(pending).rejects.toThrow(
      "CDP connection closed while waiting for Tracing.end",
    );
    await expect(connection.send("Browser.close")).rejects.toThrow(
      "cannot send Browser.close",
    );
  });

  it("resolves a waiter with event params and times out otherwise", async () => {
    const socket = new FakeSocket();
    const connection = new CdpConnection(socket);
    const load = connection.waitForEvent("Page.loadEventFired", "S1", 1_000);
    socket.receive({
      method: "Page.loadEventFired",
      params: { timestamp: 9 },
      sessionId: "S1",
    });
    await expect(load).resolves.toEqual({ timestamp: 9 });
    await expect(
      connection.waitForEvent("Page.frameNavigated", "S1", 10),
    ).rejects.toThrow("Timed out after 10 ms waiting for Page.frameNavigated");
  });

  it("rejects commands that exceed the default or per-call timeout and ignores late responses", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const connection = new CdpConnection(socket);
    const byDefault = settle(connection.send("Runtime.evaluate", {}, "S1"));
    const perCall = settle(
      connection.send("Page.navigate", {}, "S1", { timeoutMs: 50 }),
    );
    const answered = connection.send("Browser.getVersion");
    await vi.advanceTimersByTimeAsync(50);
    expect(String(await perCall)).toContain(
      "Page.navigate did not respond within 50 ms",
    );
    socket.receive({ id: 3, result: { product: "Chrome" } });
    await expect(answered).resolves.toEqual({ product: "Chrome" });
    await vi.advanceTimersByTimeAsync(119_950);
    expect(String(await byDefault)).toContain(
      "Runtime.evaluate did not respond within 120000 ms",
    );
    socket.receive({ id: 1, result: { late: true } });
    socket.receive({ id: 2, result: { late: true } });
    expect(vi.getTimerCount()).toBe(0);
  });
});
