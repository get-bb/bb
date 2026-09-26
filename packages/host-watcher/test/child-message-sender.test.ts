import { describe, expect, it, vi } from "vitest";
import { createChildMessageSender } from "../src/parcel-subprocess/child-message-sender.js";
import type { ChildToParentMessage } from "../src/parcel-subprocess/messages.js";
import { isRescanRequiredMessage } from "../src/watch-recovery.js";

function createHarness() {
  const messages: ChildToParentMessage[] = [];
  const callbacks: Array<(error: Error | null) => void> = [];
  const onError = vi.fn();
  const send = createChildMessageSender({
    send: (message, callback) => {
      messages.push(message);
      callbacks.push(callback);
    },
    onError,
  });
  return {
    messages,
    onError,
    send,
    completeNext() {
      callbacks.shift()?.(null);
    },
    drain(error: Error | null = null) {
      while (callbacks.length > 0) {
        callbacks.shift()?.(error);
      }
    },
  };
}

function batch(id: string): ChildToParentMessage {
  return {
    kind: "events",
    id,
    events: Array.from({ length: 1000 }, (_, index) => ({
      path: `/fixture/${"x".repeat(240)}/${index}`,
      type: "update",
    })),
  };
}

describe("watcher child message flow control", () => {
  it("reuses only the budget released by completed sends", () => {
    const harness = createHarness();
    harness.send(batch("a"));
    harness.send(batch("b"));
    harness.completeNext();
    harness.send(batch("c"));
    expect(harness.messages.map((message) => message.kind)).toEqual([
      "events",
      "events",
      "events",
    ]);
    harness.send(batch("d"));
    expect(harness.messages.at(-1)).toMatchObject({
      kind: "watch-error",
      id: "d",
    });
  });

  it("bounds serialized bytes even for escaped and non-ASCII paths", () => {
    const harness = createHarness();
    const message: ChildToParentMessage = {
      kind: "events",
      id: "unicode",
      events: Array.from({ length: 1000 }, () => ({
        path: '/fixture/\u0000\n"\\😀'.repeat(20),
        type: "update",
      })),
    };
    for (let index = 0; index < 100; index += 1) harness.send(message);
    const eventMessages = harness.messages.filter(
      (entry) => entry.kind === "events",
    );
    expect(eventMessages.length).toBeGreaterThan(0);
    expect(
      eventMessages.reduce(
        (bytes, entry) => bytes + Buffer.byteLength(JSON.stringify(entry)),
        0,
      ),
    ).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(
      harness.messages.filter((entry) => entry.kind === "watch-error"),
    ).toHaveLength(1);
  });

  it("bounds a stalled transport and recovers each affected subscription once", () => {
    const harness = createHarness();
    const batches = [batch("a"), batch("b")];
    for (let index = 0; index < 500; index += 1) {
      for (const message of batches) {
        harness.send(message);
      }
    }
    expect(
      harness.messages.filter((message) => message.kind === "events"),
    ).toEqual(batches);
    harness.drain();
    const rescans = harness.messages.filter(
      (message) => message.kind === "watch-error",
    );
    expect(rescans.map((message) => message.id)).toEqual(["a", "b"]);
    for (const message of rescans) {
      expect(message.recovery).toBe("rescan-subscription");
      expect(isRescanRequiredMessage(message.message)).toBe(true);
    }
    harness.send(batch("a"));
    expect(harness.messages).toHaveLength(4);
    harness.send({ kind: "unsubscribed", id: "a" });
    harness.send(batch("replacement"));
    expect(harness.messages.at(-1)).toEqual(batch("replacement"));
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it("preserves exact events and their order when the transport drains", () => {
    const harness = createHarness();
    const messages: ChildToParentMessage[] = [
      { kind: "ready" },
      {
        kind: "events",
        id: "a",
        events: [
          { path: "/fixture/new", type: "create" },
          { path: "/fixture/old", type: "delete" },
        ],
      },
      batch("b"),
      { kind: "pong", nonce: 7 },
    ];
    for (const message of messages) {
      harness.send(message);
      harness.drain();
    }
    expect(harness.messages).toEqual(messages);
  });

  it("replaces a single oversized batch with recovery before serialization", () => {
    const harness = createHarness();
    harness.send({
      kind: "events",
      id: "a",
      events: [{ path: "x".repeat(1024 * 1024), type: "update" }],
    });
    expect(harness.messages).toEqual([
      expect.objectContaining({
        kind: "watch-error",
        id: "a",
        recovery: "rescan-subscription",
      }),
    ]);
  });

  it("keeps control messages flowing while event delivery is congested", () => {
    const harness = createHarness();
    for (let index = 0; index < 5; index += 1) {
      harness.send(batch("a"));
    }
    harness.send({ kind: "unsubscribed", id: "a" });
    harness.send({ kind: "pong", nonce: 42 });
    expect(harness.messages.at(-1)).toEqual({ kind: "pong", nonce: 42 });
    harness.drain();
    harness.send(batch("a"));
    expect(harness.messages.at(-1)).toEqual(batch("a"));
  });

  it("stops sending and reports an asynchronous transport failure once", () => {
    const harness = createHarness();
    harness.send(batch("a"));
    harness.send(batch("b"));
    harness.send(batch("a"));
    const error = new Error("IPC disconnected");
    harness.drain(error);
    harness.send(batch("c"));
    expect(harness.messages).toHaveLength(3);
    expect(harness.onError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("reports a synchronous send failure", () => {
    const onError = vi.fn();
    const error = new Error("IPC disconnected");
    const send = createChildMessageSender({
      send: () => {
        throw error;
      },
      onError,
    });
    send(batch("a"));
    send(batch("a"));
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });
});
