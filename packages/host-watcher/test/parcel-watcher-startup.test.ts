import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChildToParentMessage } from "../src/parcel-subprocess/messages.js";
import {
  createParcelWatcherProxy,
  type ChildChannel,
} from "../src/parcel-subprocess/parcel-watcher-proxy.js";

function harness() {
  const children: {
    exit: () => void;
    message: (message: ChildToParentMessage) => void;
    send: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
  }[] = [];
  const log = vi.fn();
  const proxy = createParcelWatcherProxy({
    spawnChannel() {
      const child = {
        exit: () => {},
        message: (_message: ChildToParentMessage) => {},
        send: vi.fn(),
        kill: vi.fn(),
      };
      children.push(child);
      const channel: ChildChannel = {
        send: child.send,
        kill: child.kill,
        onMessage(listener) {
          child.message = listener;
        },
        onExit(listener) {
          child.exit = listener;
        },
      };
      return channel;
    },
    log,
  });
  return { proxy, children, log };
}

afterEach(() => vi.useRealTimers());

describe("watcher child failure budget", () => {
  it("stops pre-ready crash loops, reports all subscribers once, and rejects retry bypasses", async () => {
    vi.useFakeTimers();
    const { proxy, children, log } = harness();
    const callback = vi.fn();
    const removed = vi.fn();
    try {
      await proxy.subscribe("/first", callback);
      await proxy.subscribe("/second", callback);
      await (await proxy.subscribe("/removed", removed)).unsubscribe();
      for (let failure = 0; failure < 6; failure += 1) {
        children.at(-1)!.exit();
        await vi.advanceTimersByTimeAsync(2_000);
      }
      expect(children).toHaveLength(6);
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback.mock.calls[0]?.[0].message).toContain(
        "restart the BB host daemon",
      );
      expect(removed).not.toHaveBeenCalled();
      expect(
        children
          .flatMap((child) => child.send.mock.calls)
          .filter(([message]) => message.kind === "subscribe"),
      ).toEqual([]);
      expect(
        log.mock.calls.filter(([level]) => level === "error"),
      ).toHaveLength(1);
      const late = vi.fn();
      await proxy.subscribe("/late", late);
      expect(late).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(children).toHaveLength(6);
      expect(callback).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      proxy.dispose();
    }
  });

  it("times out children that never become ready and stops after the same budget", async () => {
    vi.useFakeTimers();
    const { proxy, children } = harness();
    const callback = vi.fn();
    try {
      await proxy.subscribe("/root", callback);
      await vi.advanceTimersByTimeAsync(180_000);
      expect(children).toHaveLength(6);
      expect(
        children.every((child) => child.kill.mock.calls.length === 1),
      ).toBe(true);
      expect(callback).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      proxy.dispose();
    }
  });

  it("recovers before exhaustion, resets after a pong, and ignores stale exits", async () => {
    vi.useFakeTimers();
    const { proxy, children } = harness();
    const callback = vi.fn();
    try {
      await proxy.subscribe("/root", callback);
      for (let failure = 0; failure < 5; failure += 1) {
        children.at(-1)!.exit();
        await vi.advanceTimersByTimeAsync(2_000);
      }
      const healthy = children.at(-1)!;
      healthy.message({ kind: "ready" });
      expect(healthy.send).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "subscribe", rescan: true }),
      );
      healthy.message({ kind: "pong", nonce: 1 });
      children[0]!.exit();
      expect(children).toHaveLength(6);
      healthy.exit();
      expect(children).toHaveLength(7);
      expect(callback).not.toHaveBeenCalled();
    } finally {
      proxy.dispose();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds synchronous spawn failures without throwing from a retry timer", async () => {
    vi.useFakeTimers();
    const spawnChannel = vi.fn(() => {
      throw new Error("entry missing");
    });
    const proxy = createParcelWatcherProxy({ spawnChannel });
    const callback = vi.fn();
    try {
      await proxy.subscribe("/root", callback);
      await vi.advanceTimersByTimeAsync(180_000);
      expect(spawnChannel).toHaveBeenCalledTimes(6);
      expect(callback).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      proxy.dispose();
    }
  });

  it("reports other subscribers even if one error callback throws", async () => {
    vi.useFakeTimers();
    const { proxy, children } = harness();
    const callback = vi.fn();
    try {
      await proxy.subscribe("/throwing", () => {
        throw new Error("callback failed");
      });
      await proxy.subscribe("/root", callback);
      for (let failure = 0; failure < 6; failure += 1) {
        children.at(-1)!.exit();
        await vi.advanceTimersByTimeAsync(2_000);
      }
      expect(callback).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      proxy.dispose();
    }
  });

  it("cancels a delayed respawn on disposal", async () => {
    vi.useFakeTimers();
    const { proxy, children } = harness();
    await proxy.subscribe("/root", vi.fn());
    children[0]!.exit();
    children[1]!.exit();
    proxy.dispose();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(children).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels startup deadlines on disposal", async () => {
    vi.useFakeTimers();
    const { proxy, children } = harness();
    await proxy.subscribe("/root", vi.fn());
    proxy.dispose();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(children).toHaveLength(1);
    expect(children[0]!.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
