import { describe, expect, it, vi } from "vitest";
import {
  onClientSocketMessage,
  onClientSocketOpen,
} from "../../src/ws/client-protocol.js";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

function createProtocolDeps(hub: NotificationHub) {
  return {
    hub,
    watchInterests: {
      releaseSocket: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    },
  };
}

describe("client websocket protocol", () => {
  it("subscribes valid client messages parsed through the shared schema", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: "thread-1" },
      }),
    );
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.closed).toHaveLength(0);
    expect(socket.messages).toHaveLength(1);
    expect(JSON.parse(socket.messages[0])).toMatchObject({
      type: "changed",
      entity: "thread",
      id: "thread-1",
      changes: ["events-appended"],
    });
  });

  it("rejects subscribe messages whose target id is not a string", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
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

  it("removes subscriptions after unsubscribe messages", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: "thread-1" },
      }),
    );
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "unsubscribe",
        target: { kind: "thread-detail", threadId: "thread-1" },
      }),
    );
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.closed).toHaveLength(0);
    expect(socket.messages).toHaveLength(0);
  });

  it("rejects subscribe messages for unknown targets", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
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
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
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
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);

    expect(() => onClientSocketMessage(deps, socket, "{")).not.toThrow();
    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
  });

  it("updates watch interests from subscribe and unsubscribe messages", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "environment-detail", environmentId: "env-1" },
      }),
    );
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "unsubscribe",
        target: { kind: "environment-detail", environmentId: "env-1" },
      }),
    );

    expect(deps.watchInterests.subscribe).toHaveBeenCalledWith(socket, {
      kind: "environment-detail",
      environmentId: "env-1",
    });
    expect(deps.watchInterests.unsubscribe).toHaveBeenCalledWith(socket, {
      kind: "environment-detail",
      environmentId: "env-1",
    });
  });

  it("rejects direct watch messages", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
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
    expect(deps.watchInterests.subscribe).not.toHaveBeenCalled();
  });
});
