import { describe, expect, it, vi } from "vitest";
import type { ClientSocketSession } from "../../src/request-context.js";
import { createClientSocketProtocol } from "../../src/ws/client-protocol.js";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

function unrestrictedSession(): ClientSocketSession {
  return Object.freeze({
    principal: Object.freeze({
      id: "local-owner",
      kind: "human" as const,
      displayName: "Local Owner",
    }),
    expiresAtMs: null,
    clientRealtimeScope: "unrestricted",
    authorize: async () => ({ allowed: true as const }),
  });
}

function createProtocol(hub: NotificationHub) {
  const watchInterests = {
    releaseSocket: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };
  const protocol = createClientSocketProtocol({
    hub,
    watchInterests,
    // Unrestricted path does not consult the database for target mapping.
    db: null as never,
  });
  return { protocol, watchInterests };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

describe("client websocket protocol", () => {
  it("subscribes valid client messages parsed through the shared schema", async () => {
    const hub = new NotificationHub();
    const { protocol } = createProtocol(hub);
    const socket = createMockHubSocket();

    protocol.open(socket, unrestrictedSession());
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: "thread-1" },
      }),
    );
    await flushMicrotasks();
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.closed).toHaveLength(0);
    expect(socket.messages).toHaveLength(1);
    expect(JSON.parse(socket.messages[0]!)).toMatchObject({
      type: "changed",
      entity: "thread",
      id: "thread-1",
      changes: ["events-appended"],
    });
  });

  it("rejects subscribe messages whose target id is not a string", () => {
    const hub = new NotificationHub();
    const { protocol } = createProtocol(hub);
    const socket = createMockHubSocket();

    protocol.open(socket, unrestrictedSession());
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: 123 },
      }),
    );
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
    expect(socket.messages).toHaveLength(0);
  });

  it("removes subscriptions after unsubscribe messages", async () => {
    const hub = new NotificationHub();
    const { protocol } = createProtocol(hub);
    const socket = createMockHubSocket();

    protocol.open(socket, unrestrictedSession());
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: "thread-1" },
      }),
    );
    await flushMicrotasks();
    protocol.message(
      socket,
      JSON.stringify({
        type: "unsubscribe",
        target: { kind: "thread-detail", threadId: "thread-1" },
      }),
    );
    await flushMicrotasks();
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.closed).toHaveLength(0);
    expect(socket.messages).toHaveLength(0);
  });

  it("rejects subscribe messages for unknown targets", () => {
    const hub = new NotificationHub();
    const { protocol } = createProtocol(hub);
    const socket = createMockHubSocket();

    protocol.open(socket, unrestrictedSession());
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "bogus" },
      }),
    );

    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
    expect(socket.messages).toHaveLength(0);
  });

  it("rejects client messages with missing required fields", () => {
    const hub = new NotificationHub();
    const { protocol } = createProtocol(hub);
    const socket = createMockHubSocket();

    protocol.open(socket, unrestrictedSession());
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
      }),
    );

    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
    expect(socket.messages).toHaveLength(0);
  });

  it("closes the socket instead of throwing on malformed JSON", () => {
    const hub = new NotificationHub();
    const { protocol } = createProtocol(hub);
    const socket = createMockHubSocket();

    protocol.open(socket, unrestrictedSession());

    expect(() => protocol.message(socket, "{")).not.toThrow();
    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
  });

  it("updates watch interests from subscribe and unsubscribe messages", async () => {
    const hub = new NotificationHub();
    const { protocol, watchInterests } = createProtocol(hub);
    const socket = createMockHubSocket();

    protocol.open(socket, unrestrictedSession());
    protocol.message(
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "environment-detail", environmentId: "env-1" },
      }),
    );
    await flushMicrotasks();
    protocol.message(
      socket,
      JSON.stringify({
        type: "unsubscribe",
        target: { kind: "environment-detail", environmentId: "env-1" },
      }),
    );
    await flushMicrotasks();

    expect(watchInterests.subscribe).toHaveBeenCalledWith(socket, {
      kind: "environment-detail",
      environmentId: "env-1",
    });
    expect(watchInterests.unsubscribe).toHaveBeenCalledWith(socket, {
      kind: "environment-detail",
      environmentId: "env-1",
    });
  });

  it("rejects direct watch messages", () => {
    const hub = new NotificationHub();
    const { protocol, watchInterests } = createProtocol(hub);
    const socket = createMockHubSocket();

    protocol.open(socket, unrestrictedSession());
    protocol.message(
      socket,
      JSON.stringify({
        type: "watch.acquire",
        target: {
          kind: "environment-workspace",
          environmentId: "env-1",
        },
      }),
    );

    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
    expect(watchInterests.subscribe).not.toHaveBeenCalled();
  });
});
