import { Buffer } from "node:buffer";
import {
  ENVIRONMENT_CHANGE_KINDS,
  HOST_CHANGE_KINDS,
  PROJECT_CHANGE_KINDS,
  SYSTEM_CHANGE_KINDS,
  THREAD_CHANGE_KINDS,
  type ThreadChangeKind,
} from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import { TRANSPORT_TEST_BRIDGE_LAUNCH } from "../helpers/provider-registry.js";

function appendRawChangeKind(changes: string[], kind: string): void {
  changes.push(kind);
}

describe("NotificationHub", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes thread notification metadata when provided", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    hub.subscribe(socket, { kind: "thread-detail", threadId: "thread-1" });
    hub.notifyThread("thread-1", ["archived-changed"], {
      projectId: "project-1",
    });

    expect(socket.messages).toHaveLength(1);
    expect(JSON.parse(socket.messages[0])).toMatchObject({
      type: "changed",
      entity: "thread",
      id: "thread-1",
      metadata: { projectId: "project-1" },
      changes: ["archived-changed"],
    });
  });

  it("subscribes clients and delivers environment notifications", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    hub.subscribe(socket, {
      kind: "environment-detail",
      environmentId: "environment-1",
    });
    hub.notifyEnvironment("environment-1", ["metadata-changed"]);

    expect(socket.messages).toHaveLength(1);
    expect(JSON.parse(socket.messages[0])).toMatchObject({
      type: "changed",
      entity: "environment",
      id: "environment-1",
      changes: ["metadata-changed"],
    });
  });

  it("cleans up subscriptions on client disconnect", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    hub.subscribe(socket, { kind: "thread-detail", threadId: "thread-1" });
    hub.subscribe(socket, { kind: "project-detail", projectId: "project-1" });
    hub.unregisterClient(socket);
    hub.notifyThread("thread-1", ["events-appended"]);
    hub.notifyProject("project-1", ["threads-changed"]);

    expect(socket.messages).toHaveLength(0);
  });

  it("watches a target from its first subscriber until its last one leaves", () => {
    const hub = new NotificationHub();
    const first = createMockHubSocket();
    const second = createMockHubSocket();
    const environment = {
      kind: "environment-detail",
      environmentId: "environment-1",
    } as const;
    const thread = { kind: "thread-detail", threadId: "thread-1" } as const;
    const changes: unknown[] = [];
    hub.onWatchedTargets(["environment-detail", "thread-detail"], (change) => {
      changes.push(change);
    });

    hub.subscribe(first, environment);
    hub.subscribe(second, { ...environment });
    hub.subscribe(first, thread);
    hub.subscribe(first, { kind: "project-detail", projectId: "project-1" });
    hub.unsubscribe(first, environment);
    expect(hub.listWatchedTargets("environment-detail")).toEqual([environment]);
    hub.subscribe(second, thread);
    hub.subscribe(second, { kind: "host-list" });
    hub.unregisterClient(first);
    hub.unregisterClient(second);

    expect(changes).toEqual([
      { started: [environment], stopped: [] },
      { started: [thread], stopped: [] },
      { started: [], stopped: [environment, thread] },
    ]);
    expect(hub.listWatchedTargets("environment-detail")).toEqual([]);
    expect(hub.listWatchedTargets("thread-detail")).toEqual([]);
  });

  it("replays already watched targets to a late listener", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    const target = {
      kind: "thread-timeline",
      threadId: "thread-1",
      segmentLimit: null,
      deferContent: false,
    } as const;
    hub.subscribe(socket, target);
    hub.subscribe(socket, { kind: "thread-detail", threadId: "thread-1" });
    const changes: unknown[] = [];

    const stop = hub.onWatchedTargets(["thread-timeline"], (change) => {
      changes.push(change);
    });
    stop();
    hub.unregisterClient(socket);

    expect(changes).toEqual([{ started: [target], stopped: [] }]);
  });

  it("watches only for visible clients while still routing changes to hidden ones", () => {
    const hub = new NotificationHub();
    const first = createMockHubSocket();
    const second = createMockHubSocket();
    const environment = {
      kind: "environment-detail",
      environmentId: "environment-1",
    } as const;
    const pullRequest = {
      kind: "plugin-read",
      pluginId: "bb--github-pr-status",
      method: "pullRequests",
      read: { key: "environment-1" },
    } as const;
    const changes: unknown[] = [];
    hub.onWatchedTargets(["environment-detail", "plugin-read"], (change) => {
      changes.push(change);
    });

    hub.subscribe(first, environment);
    hub.subscribe(second, { ...environment });
    hub.setClientVisible(first, false);
    hub.setClientVisible(first, false);
    expect(hub.listWatchedTargets("environment-detail")).toEqual([environment]);
    hub.setClientVisible(second, false);
    hub.subscribe(second, pullRequest);
    hub.notifyEnvironment("environment-1", ["metadata-changed"]);
    hub.setClientVisible(second, true);
    hub.unregisterClient(second);
    hub.unregisterClient(first);

    expect(changes).toEqual([
      { started: [environment], stopped: [] },
      { started: [], stopped: [environment] },
      { started: [environment, pullRequest], stopped: [] },
      { started: [], stopped: [environment, pullRequest] },
    ]);
    for (const socket of [first, second]) {
      expect(socket.messages.map((message) => JSON.parse(message))).toEqual([
        expect.objectContaining({ entity: "environment", id: "environment-1" }),
      ]);
    }
  });

  it("registers terminal clients and removes them when the socket disconnects", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    hub.registerTerminalClient("term-1", socket);
    hub.sendTerminalClientMessage("term-1", {
      type: "output",
      chunk: {
        seq: 0,
        dataBase64: "aGVsbG8=",
      },
    });
    hub.unregisterTerminalClientSocket(socket);
    hub.sendTerminalClientMessage("term-1", {
      type: "output",
      chunk: {
        seq: 1,
        dataBase64: "d29ybGQ=",
      },
    });

    expect(socket.messages.map((message) => JSON.parse(message))).toEqual([
      {
        type: "output",
        chunk: {
          seq: 0,
          dataBase64: "aGVsbG8=",
        },
      },
    ]);
  });

  it("gives terminal resize ownership to the latest client and restores it on detach", () => {
    const hub = new NotificationHub();
    const first = createMockHubSocket();
    const second = createMockHubSocket();

    hub.registerTerminalClient("term-1", first);
    hub.claimTerminalResizeOwnership("term-1", first);
    hub.registerTerminalClient("term-1", second);
    hub.claimTerminalResizeOwnership("term-1", second);

    expect(hub.isTerminalResizeOwner("term-1", first)).toBe(false);
    expect(hub.isTerminalResizeOwner("term-1", second)).toBe(true);

    hub.unregisterTerminalClient("term-1", second);
    expect(hub.isTerminalResizeOwner("term-1", first)).toBe(true);
  });

  it("queues terminal output while a browser socket is above high water", () => {
    vi.useFakeTimers();
    const hub = new NotificationHub();
    const socket = {
      ...createMockHubSocket(),
      raw: { bufferedAmount: 2 * 1024 * 1024 },
    };
    hub.registerTerminalClient("term-1", socket);

    hub.sendTerminalClientMessage("term-1", {
      type: "output",
      chunk: { seq: 0, dataBase64: "YQ==" },
    });
    hub.sendTerminalClientMessage("term-1", {
      type: "output",
      chunk: { seq: 1, dataBase64: "Yg==" },
    });
    expect(socket.messages).toEqual([]);

    socket.raw.bufferedAmount = 0;
    vi.advanceTimersByTime(10);
    expect(socket.messages.map((message) => JSON.parse(message))).toEqual([
      {
        type: "output",
        chunk: { seq: 0, dataBase64: "YQ==" },
      },
      {
        type: "output",
        chunk: { seq: 1, dataBase64: "Yg==" },
      },
    ]);
  });

  it("isolates a throwing terminal browser socket from healthy clients", () => {
    const hub = new NotificationHub();
    const healthy = createMockHubSocket();
    const closed: Array<{ code?: number; reason?: string }> = [];
    const failing = {
      close(code?: number, reason?: string) {
        closed.push({ code, reason });
      },
      send() {
        throw new Error("socket send failed");
      },
    };
    hub.registerTerminalClient("term-1", failing);
    hub.registerTerminalClient("term-1", healthy);

    expect(() =>
      hub.sendTerminalClientMessage("term-1", {
        type: "output",
        chunk: { seq: 0, dataBase64: "YQ==" },
      }),
    ).not.toThrow();
    hub.sendTerminalClientMessage("term-1", {
      type: "output",
      chunk: { seq: 1, dataBase64: "Yg==" },
    });

    expect(closed).toEqual([{ code: 1013, reason: "terminal-send-failed" }]);
    expect(healthy.messages.map((message) => JSON.parse(message))).toEqual([
      {
        type: "output",
        chunk: { seq: 0, dataBase64: "YQ==" },
      },
      {
        type: "output",
        chunk: { seq: 1, dataBase64: "Yg==" },
      },
    ]);
  });

  it("closes a terminal browser whose bounded output queue overflows", () => {
    vi.useFakeTimers();
    const hub = new NotificationHub();
    const socket = {
      ...createMockHubSocket(),
      raw: { bufferedAmount: 2 * 1024 * 1024 },
    };
    hub.registerTerminalClient("term-1", socket);
    const dataBase64 = Buffer.alloc(64 * 1024).toString("base64");

    for (let seq = 0; seq < 512; seq += 1) {
      hub.sendTerminalClientMessage("term-1", {
        type: "output",
        chunk: { seq, dataBase64 },
      });
    }

    expect(socket.closed).toContainEqual({
      code: 1013,
      reason: "terminal-backpressure",
    });
    expect(socket.messages).toEqual([]);
  });

  it("notifies all clients subscribed to the same thread", () => {
    const hub = new NotificationHub();
    const socket1 = createMockHubSocket();
    const socket2 = createMockHubSocket();
    const socket3 = createMockHubSocket();

    hub.subscribe(socket1, { kind: "thread-detail", threadId: "thread-1" });
    hub.subscribe(socket2, { kind: "thread-detail", threadId: "thread-1" });
    hub.subscribe(socket3, { kind: "thread-detail", threadId: "thread-2" });
    hub.notifyThread("thread-1", ["status-changed"]);

    expect(socket1.messages).toHaveLength(1);
    expect(socket2.messages).toHaveLength(1);
    expect(socket3.messages).toHaveLength(0);
  });

  it("cancels the replaced daemon session's pending disconnect timer", async () => {
    vi.useFakeTimers();
    try {
      const hub = new NotificationHub();
      const socket1 = createMockHubSocket();
      const socket2 = createMockHubSocket();
      const callback = vi.fn();

      hub.registerDaemon("session-1", "host-1", socket1);
      hub.scheduleDaemonDisconnect("session-1", 1_000, callback);

      hub.registerDaemon("session-2", "host-1", socket2);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(callback).not.toHaveBeenCalled();
      expect(socket1.messages).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends host RPC requests to the active daemon and resolves responses", async () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.registerDaemon("session-1", "host-1", socket);

    const wait = hub.requestHostOnlineRpc({
      hostId: "host-1",
      timeoutMs: 1_000,
      message: {
        type: "host-rpc.request",
        requestId: "rpc-1",
        command: {
          type: "provider.list_models",
          contributedEnv: [],
          providerId: "codex",
          bridgeLaunch: TRANSPORT_TEST_BRIDGE_LAUNCH,
        },
      },
    });

    expect(socket.messages.map((message) => JSON.parse(message))).toEqual([
      {
        type: "host-rpc.request",
        requestId: "rpc-1",
        command: {
          type: "provider.list_models",
          contributedEnv: [],
          providerId: "codex",
          bridgeLaunch: TRANSPORT_TEST_BRIDGE_LAUNCH,
        },
      },
    ]);
    const disposition = hub.recordHostOnlineRpcResponse({
      message: {
        type: "host-rpc.response",
        requestId: "rpc-1",
        commandType: "provider.list_models",
        ok: true,
        result: { models: [], selectedOnlyModels: [] },
      },
      sessionId: "session-1",
    });
    expect(disposition).toEqual({ handled: true });

    await expect(wait).resolves.toEqual({
      type: "host-rpc.response",
      requestId: "rpc-1",
      commandType: "provider.list_models",
      ok: true,
      result: { models: [], selectedOnlyModels: [] },
    });
  });

  it("cancels the daemon request when the caller aborts", async () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.registerDaemon("session-1", "host-1", socket);
    const abortController = new AbortController();

    const wait = hub.requestHostOnlineRpc({
      hostId: "host-1",
      signal: abortController.signal,
      timeoutMs: 1_000,
      message: {
        type: "host-rpc.request",
        requestId: "rpc-1",
        command: {
          type: "provider.list_models",
          contributedEnv: [],
          providerId: "codex",
          bridgeLaunch: TRANSPORT_TEST_BRIDGE_LAUNCH,
        },
      },
    });
    abortController.abort();

    await expect(wait).rejects.toThrow("Host RPC request was cancelled");
    expect(socket.messages.map((message) => JSON.parse(message).type)).toEqual([
      "host-rpc.request",
      "host-rpc.cancel",
    ]);
    expect(JSON.parse(socket.messages[1])).toEqual({
      type: "host-rpc.cancel",
      requestId: "rpc-1",
    });
    expect(
      hub.recordHostOnlineRpcResponse({
        message: {
          type: "host-rpc.response",
          requestId: "rpc-1",
          commandType: "provider.list_models",
          ok: true,
          result: { models: [], selectedOnlyModels: [] },
        },
        sessionId: "session-1",
      }),
    ).toEqual({ handled: false, reason: "stale" });
  });

  it("cancels the daemon request when the wait times out", async () => {
    vi.useFakeTimers();
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.registerDaemon("session-1", "host-1", socket);

    const wait = hub.requestHostOnlineRpc({
      hostId: "host-1",
      timeoutMs: 1_000,
      message: {
        type: "host-rpc.request",
        requestId: "rpc-1",
        command: {
          type: "provider.list_models",
          contributedEnv: [],
          providerId: "codex",
          bridgeLaunch: TRANSPORT_TEST_BRIDGE_LAUNCH,
        },
      },
    });
    const rejection = expect(wait).rejects.toThrow(
      "Timed out waiting for host RPC response",
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(JSON.parse(socket.messages[1])).toEqual({
      type: "host-rpc.cancel",
      requestId: "rpc-1",
    });
  });

  it("does not send a request whose signal is already aborted", async () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.registerDaemon("session-1", "host-1", socket);
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      hub.requestHostOnlineRpc({
        hostId: "host-1",
        signal: abortController.signal,
        timeoutMs: 1_000,
        message: {
          type: "host-rpc.request",
          requestId: "rpc-1",
          command: {
            type: "provider.list_models",
            contributedEnv: [],
            providerId: "codex",
            bridgeLaunch: TRANSPORT_TEST_BRIDGE_LAUNCH,
          },
        },
      }),
    ).rejects.toThrow("Host RPC request was cancelled");
    expect(socket.messages).toEqual([]);
  });

  it("rejects in-flight host RPC requests when the daemon unregisters", async () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.registerDaemon("session-1", "host-1", socket);

    const wait = hub.requestHostOnlineRpc({
      hostId: "host-1",
      timeoutMs: 1_000,
      message: {
        type: "host-rpc.request",
        requestId: "rpc-1",
        command: {
          type: "provider.list_models",
          contributedEnv: [],
          providerId: "codex",
          bridgeLaunch: TRANSPORT_TEST_BRIDGE_LAUNCH,
        },
      },
    });
    hub.unregisterDaemon("session-1");

    await expect(wait).rejects.toThrow("Host daemon is not connected");
  });

  it("skips and logs broadcasts that fail outgoing schema validation", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const hub = new NotificationHub();
      const socket = createMockHubSocket();
      hub.subscribe(socket, { kind: "thread-detail", threadId: "thread-1" });

      const changes: ThreadChangeKind[] = ["events-appended"];
      appendRawChangeKind(changes, "not-a-real-change-kind");

      expect(() => hub.notifyThread("thread-1", changes)).not.toThrow();

      expect(socket.messages).toHaveLength(0);
      expect(consoleError).toHaveBeenCalledWith(
        "Skipping invalid realtime broadcast",
        expect.anything(),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("delivers system notifications to system subscribers", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    hub.subscribe(socket, { kind: "system" });
    hub.notifySystem(["config-changed"]);

    expect(socket.messages).toHaveLength(1);
    expect(JSON.parse(socket.messages[0])).toEqual({
      type: "changed",
      entity: "system",
      changes: ["config-changed"],
    });
  });

  it("stops delivering change notifications to clients once stopped", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    const listener = vi.fn();
    hub.onChangedMessage(listener);
    hub.subscribe(socket, { kind: "system" });
    hub.subscribe(socket, { kind: "host-list" });

    hub.stopClientChangeNotifications();
    hub.notifySystem(["provider-registrations-changed"]);
    hub.notifyHost("host-1", ["provider-model-catalog-changed"]);

    expect(socket.messages).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("delivers host notifications to list and detail subscribers", () => {
    const hub = new NotificationHub();
    const entityWideSocket = createMockHubSocket();
    const idScopedSocket = createMockHubSocket();
    const otherHostSocket = createMockHubSocket();

    hub.subscribe(entityWideSocket, { kind: "host-list" });
    hub.subscribe(idScopedSocket, { kind: "host-detail", hostId: "host-1" });
    hub.subscribe(otherHostSocket, { kind: "host-detail", hostId: "host-2" });
    hub.notifyHost("host-1", ["host-connected"]);

    const expected = {
      type: "changed",
      entity: "host",
      id: "host-1",
      changes: ["host-connected"],
    };
    expect(
      entityWideSocket.messages.map((message) => JSON.parse(message)),
    ).toEqual([expected]);
    expect(
      idScopedSocket.messages.map((message) => JSON.parse(message)),
    ).toEqual([expected]);
    expect(otherHostSocket.messages).toHaveLength(0);
  });

  it("broadcasts host-connected when a daemon registers", () => {
    const hub = new NotificationHub();
    const clientSocket = createMockHubSocket();
    const daemonSocket = createMockHubSocket();

    hub.subscribe(clientSocket, { kind: "host-list" });
    hub.registerDaemon("session-1", "host-1", daemonSocket);

    expect(clientSocket.messages.map((message) => JSON.parse(message))).toEqual(
      [
        {
          type: "changed",
          entity: "host",
          id: "host-1",
          changes: ["host-connected"],
        },
      ],
    );
  });

  it("passes every declared change kind through the outgoing schema gate", () => {
    const hub = new NotificationHub();
    const threadSocket = createMockHubSocket();
    const projectSocket = createMockHubSocket();
    const environmentSocket = createMockHubSocket();
    const hostSocket = createMockHubSocket();
    const systemSocket = createMockHubSocket();

    hub.subscribe(threadSocket, {
      kind: "thread-detail",
      threadId: "thread-1",
    });
    hub.subscribe(projectSocket, {
      kind: "project-detail",
      projectId: "project-1",
    });
    hub.subscribe(environmentSocket, {
      kind: "environment-detail",
      environmentId: "environment-1",
    });
    hub.subscribe(hostSocket, { kind: "host-detail", hostId: "host-1" });
    hub.subscribe(systemSocket, { kind: "system" });

    hub.notifyThread("thread-1", [...THREAD_CHANGE_KINDS]);
    hub.notifyProject("project-1", [...PROJECT_CHANGE_KINDS]);
    hub.notifyEnvironment("environment-1", [...ENVIRONMENT_CHANGE_KINDS]);
    hub.notifyHost("host-1", [...HOST_CHANGE_KINDS]);
    hub.notifySystem([...SYSTEM_CHANGE_KINDS]);

    expect(threadSocket.messages).toHaveLength(1);
    expect(JSON.parse(threadSocket.messages[0]).changes).toEqual([
      ...THREAD_CHANGE_KINDS,
    ]);
    expect(projectSocket.messages).toHaveLength(1);
    expect(JSON.parse(projectSocket.messages[0]).changes).toEqual([
      ...PROJECT_CHANGE_KINDS,
    ]);
    expect(environmentSocket.messages).toHaveLength(1);
    expect(JSON.parse(environmentSocket.messages[0]).changes).toEqual([
      ...ENVIRONMENT_CHANGE_KINDS,
    ]);
    expect(hostSocket.messages).toHaveLength(1);
    expect(JSON.parse(hostSocket.messages[0]).changes).toEqual([
      ...HOST_CHANGE_KINDS,
    ]);
    expect(systemSocket.messages).toHaveLength(1);
    expect(JSON.parse(systemSocket.messages[0]).changes).toEqual([
      ...SYSTEM_CHANGE_KINDS,
    ]);
  });
});

describe("NotificationHub events-appended thread-list coalescing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function messagesOf(socket: { messages: string[] }): Array<{
    changes: string[];
    id?: string;
    metadata?: { eventTypes?: string[] };
  }> {
    return socket.messages.map((message) => JSON.parse(message));
  }

  it("delivers every events-appended frame to detail subscribers but coalesces list-only subscribers to one per window", () => {
    vi.useFakeTimers();
    const hub = new NotificationHub();
    const detailSocket = createMockHubSocket();
    const listSocket = createMockHubSocket();
    const listAndDetailSocket = createMockHubSocket();
    hub.subscribe(detailSocket, {
      kind: "thread-detail",
      threadId: "thread-1",
    });
    hub.subscribe(listSocket, { kind: "thread-list" });
    hub.subscribe(listAndDetailSocket, { kind: "thread-list" });
    hub.subscribe(listAndDetailSocket, {
      kind: "thread-detail",
      threadId: "thread-1",
    });

    let timelineSequence = 0;
    for (const eventType of [
      "item/agentMessage/delta",
      "item/agentMessage/delta",
      "item/started",
    ] as const) {
      hub.notifyThread("thread-1", ["events-appended"], {
        eventTypes: [eventType],
        timelineSequence: ++timelineSequence,
      });
    }

    expect(detailSocket.messages).toHaveLength(3);
    expect(listAndDetailSocket.messages).toHaveLength(3);
    expect(listSocket.messages).toHaveLength(1);
    expect(messagesOf(listSocket)[0]).toMatchObject({
      id: "thread-1",
      changes: ["events-appended"],
      metadata: {
        eventTypes: ["item/agentMessage/delta"],
        timelineSequence: 1,
      },
    });

    vi.advanceTimersByTime(999);
    expect(listSocket.messages).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(listSocket.messages).toHaveLength(2);
    expect(messagesOf(listSocket)[1]).toMatchObject({
      id: "thread-1",
      changes: ["events-appended"],
      metadata: {
        eventTypes: ["item/agentMessage/delta", "item/started"],
        timelineSequence: 3,
      },
    });
    expect(detailSocket.messages).toHaveLength(3);
    expect(listAndDetailSocket.messages).toHaveLength(3);

    vi.advanceTimersByTime(5_000);
    expect(listSocket.messages).toHaveLength(2);
    hub.notifyThread("thread-1", ["events-appended"], {
      eventTypes: ["item/agentMessage/delta"],
    });
    expect(listSocket.messages).toHaveLength(3);
    vi.advanceTimersByTime(1_000);
    expect(listSocket.messages).toHaveLength(3);
  });

  it("bypasses coalescing when metadata carries a list-relevant signal or another change kind", () => {
    vi.useFakeTimers();
    const hub = new NotificationHub();
    const listSocket = createMockHubSocket();
    hub.subscribe(listSocket, { kind: "thread-list" });

    hub.notifyThread("thread-1", ["events-appended"], {
      eventTypes: ["item/agentMessage/delta"],
    });
    expect(listSocket.messages).toHaveLength(1);

    hub.notifyThread("thread-1", ["events-appended"], {
      backgroundActivityChanged: true,
      eventTypes: ["item/agentMessage/delta"],
    });
    hub.notifyThread("thread-1", ["events-appended"], {
      eventTypes: ["turn/completed"],
    });
    hub.notifyThread("thread-1", ["events-appended"], {
      eventTypes: ["client/turn/requested"],
    });
    hub.notifyThread("thread-1", ["events-appended"], {
      hasPendingInteraction: true,
    });
    hub.notifyThread("thread-1", ["events-appended", "read-state-changed"], {
      eventTypes: ["item/agentMessage/delta"],
      projectId: "project-1",
    });
    hub.notifyThread("thread-1", ["status-changed"]);
    expect(listSocket.messages).toHaveLength(7);
    expect(messagesOf(listSocket).map((message) => message.changes)).toEqual([
      ["events-appended"],
      ["events-appended"],
      ["events-appended"],
      ["events-appended"],
      ["events-appended"],
      ["events-appended", "read-state-changed"],
      ["status-changed"],
    ]);
  });

  it("coalesces per thread and resolves thread event waiters for every frame", async () => {
    vi.useFakeTimers();
    const hub = new NotificationHub();
    const listSocket = createMockHubSocket();
    hub.subscribe(listSocket, { kind: "thread-list" });

    hub.notifyThread("thread-1", ["events-appended"]);
    hub.notifyThread("thread-2", ["events-appended"]);
    expect(messagesOf(listSocket).map((message) => message.id)).toEqual([
      "thread-1",
      "thread-2",
    ]);

    const waiter = hub.registerThreadEventWaiter("thread-1", 10_000).promise;
    hub.notifyThread("thread-1", ["events-appended"]);
    await expect(waiter).resolves.toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(listSocket.messages).toHaveLength(3);
    expect(messagesOf(listSocket)[2]).toEqual({
      type: "changed",
      entity: "thread",
      id: "thread-1",
      changes: ["events-appended"],
    });
  });

  it("delivers history compaction to detail subscribers and listeners but not to list-only sockets", () => {
    vi.useFakeTimers();
    const hub = new NotificationHub();
    const detailSocket = createMockHubSocket();
    const listSocket = createMockHubSocket();
    const otherDetailSocket = createMockHubSocket();
    const seen: string[][] = [];
    hub.onChangedMessage((message) => {
      if (message.entity === "thread") seen.push([...message.changes]);
    });
    hub.subscribe(detailSocket, {
      kind: "thread-detail",
      threadId: "thread-1",
    });
    hub.subscribe(listSocket, { kind: "thread-list" });
    hub.subscribe(otherDetailSocket, {
      kind: "thread-detail",
      threadId: "thread-2",
    });

    hub.notifyThread("thread-1", ["history-compacted"]);
    vi.advanceTimersByTime(1_000);

    expect(messagesOf(detailSocket)).toEqual([
      {
        type: "changed",
        entity: "thread",
        id: "thread-1",
        changes: ["history-compacted"],
      },
    ]);
    expect(listSocket.messages).toEqual([]);
    expect(otherDetailSocket.messages).toEqual([]);
    expect(seen).toEqual([["history-compacted"]]);

    hub.notifyThread("thread-1", ["history-rewritten"]);
    expect(listSocket.messages).toHaveLength(1);
  });

  it("still tells changed-message listeners about coalesced frames", () => {
    vi.useFakeTimers();
    const hub = new NotificationHub();
    const seen: string[][] = [];
    hub.onChangedMessage((message) => {
      if (message.entity === "thread") seen.push([...message.changes]);
    });
    hub.notifyThread("thread-1", ["events-appended"]);
    hub.notifyThread("thread-1", ["events-appended"]);
    expect(seen).toEqual([["events-appended"], ["events-appended"]]);
  });
});

it("shares watched producers across sockets", () => {
  const hub = new NotificationHub();
  const a = createMockHubSocket();
  const b = createMockHubSocket();
  const changes = vi.fn();
  const read = {
    kind: "plugin-read",
    pluginId: "demo",
    method: "status",
    read: { input: { a: 1, b: 2 } },
  } as const;
  const stop = hub.onWatchedTargets(["plugin-read"], changes);
  hub.subscribe(a, read);
  hub.subscribe(b, { ...read, read: { input: { b: 2, a: 1 } } });
  expect(changes.mock.calls).toEqual([[{ started: [read], stopped: [] }]]);
  hub.unsubscribe(a, read);
  expect(changes).toHaveBeenCalledTimes(1);
  hub.unregisterClient(b);
  expect(changes.mock.calls).toEqual([
    [{ started: [read], stopped: [] }],
    [{ started: [], stopped: [read] }],
  ]);
  stop();
});
