import { describe, expect, it } from "vitest";
import {
  onClientSocketMessage,
  onClientSocketOpen,
} from "../../src/ws/client-protocol.js";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

describe("client websocket protocol", () => {
  it("subscribes valid client messages parsed through the shared schema", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      hub,
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

  it("skips a subscribe target whose id is not a string and keeps the socket", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      hub,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: 123 },
      }),
    );
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.closed).toEqual([]);
    expect(socket.messages).toHaveLength(0);
  });

  it("subscribes the valid targets of a batch that also holds an oversized plugin read", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    const watched: unknown[] = [];
    hub.onWatchedTargets(["thread-detail", "plugin-read"], (change) => {
      watched.push(change);
    });
    const thread = { kind: "thread-detail", threadId: "thread-1" };

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      hub,
      socket,
      JSON.stringify({
        type: "subscribe",
        targets: [
          {
            kind: "plugin-read",
            pluginId: "usage",
            method: "getUsage",
            read: { input: "x".repeat(17_000) },
          },
          thread,
        ],
      }),
    );
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.closed).toEqual([]);
    expect(watched).toEqual([{ started: [thread], stopped: [] }]);
    expect(socket.messages).toHaveLength(1);
  });

  it("removes subscriptions after unsubscribe messages", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      hub,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: "thread-1" },
      }),
    );
    onClientSocketMessage(
      hub,
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

  it("ignores unknown targets without disconnecting the client", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      hub,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "bogus" },
      }),
    );

    expect(socket.closed).toEqual([]);
    expect(socket.messages).toHaveLength(0);
  });

  it("rejects client messages with missing required fields", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      hub,
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
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);

    expect(() => onClientSocketMessage(hub, socket, "{")).not.toThrow();
    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
  });

  it("starts and stops watched targets from subscribe, visibility and unsubscribe messages", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    const changes: unknown[] = [];
    hub.onWatchedTargets(["environment-detail"], (change) => {
      changes.push(change);
    });

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      hub,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "environment-detail", environmentId: "env-1" },
      }),
    );
    for (const visible of [false, true])
      onClientSocketMessage(
        hub,
        socket,
        JSON.stringify({ type: "visibility", visible }),
      );
    onClientSocketMessage(
      hub,
      socket,
      JSON.stringify({
        type: "unsubscribe",
        target: { kind: "environment-detail", environmentId: "env-1" },
      }),
    );

    const target = { kind: "environment-detail", environmentId: "env-1" };
    expect(socket.closed).toHaveLength(0);
    expect(changes).toEqual([
      { started: [target], stopped: [] },
      { started: [], stopped: [target] },
      { started: [target], stopped: [] },
      { started: [], stopped: [target] },
    ]);
  });

  it("answers a ping with a pong on the same socket only", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    const otherSocket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketOpen(hub, otherSocket);
    onClientSocketMessage(hub, socket, JSON.stringify({ type: "ping" }));

    expect(socket.closed).toHaveLength(0);
    expect(socket.messages.map((message) => JSON.parse(message))).toEqual([
      { type: "pong" },
    ]);
    expect(otherSocket.messages).toHaveLength(0);
  });

  it("rejects direct watch messages", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      hub,
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
  });
});

it("routes batched plugin subscriptions and invalidate-all to the subscribed sockets", () => {
  const hub = new NotificationHub();
  const socket = createMockHubSocket();
  const idle = createMockHubSocket();
  onClientSocketOpen(hub, socket);
  onClientSocketOpen(hub, idle);
  onClientSocketMessage(
    hub,
    socket,
    JSON.stringify({
      type: "subscribe",
      targets: [
        { kind: "future-target" },
        { kind: "plugin", pluginId: "push-notifications" },
      ],
    }),
  );
  hub.notifyPluginChanged("other", {
    entity: "settings",
    changes: ["updated"],
  });
  hub.notifyPluginChanged("push-notifications", {
    entity: "settings",
    changes: ["updated"],
  });
  expect(socket.closed).toEqual([]);
  expect(socket.messages.map((message) => JSON.parse(message))).toEqual([
    {
      type: "changed",
      entity: "plugin",
      pluginId: "push-notifications",
      change: { entity: "settings", changes: ["updated"] },
    },
  ]);
  expect(idle.messages).toEqual([]);
});
