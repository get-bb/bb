import {
  ENVIRONMENT_CHANGE_KINDS,
  HOST_CHANGE_KINDS,
  PROJECT_CHANGE_KINDS,
  SYSTEM_CHANGE_KINDS,
  THREAD_CHANGE_KINDS,
  type ThreadChangeKind,
} from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

/**
 * Smuggles an out-of-contract change kind into a typed changes array without a
 * cast: `ThreadChangeKind[]` is assignable to `string[]` (array covariance),
 * so pushing through the widened parameter reproduces a producer bug that the
 * type system cannot catch — exactly what the outgoing schema gate exists for.
 */
function appendRawChangeKind(changes: string[], kind: string): void {
  changes.push(kind);
}

describe("NotificationHub", () => {
  it("subscribes clients and delivers thread notifications", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    hub.subscribe(socket, "thread", "thread-1");
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.messages).toHaveLength(1);
    expect(JSON.parse(socket.messages[0])).toMatchObject({
      type: "changed",
      entity: "thread",
      id: "thread-1",
      changes: ["events-appended"],
    });
  });

  it("includes thread notification metadata when provided", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    hub.subscribe(socket, "thread", "thread-1");
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

    hub.subscribe(socket, "environment", "environment-1");
    hub.notifyEnvironment("environment-1", ["metadata-changed"]);

    expect(socket.messages).toHaveLength(1);
    expect(JSON.parse(socket.messages[0])).toMatchObject({
      type: "changed",
      entity: "environment",
      id: "environment-1",
      changes: ["metadata-changed"],
    });
  });

  it("stops notifications after unsubscribe", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    hub.subscribe(socket, "thread", "thread-1");
    hub.unsubscribe(socket, "thread", "thread-1");
    hub.notifyThread("thread-1", ["status-changed"]);

    expect(socket.messages).toHaveLength(0);
  });

  it("cleans up subscriptions on client disconnect", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    hub.subscribe(socket, "thread", "thread-1");
    hub.subscribe(socket, "project", "project-1");
    hub.unregisterClient(socket);
    hub.notifyThread("thread-1", ["events-appended"]);
    hub.notifyProject("project-1", ["threads-changed"]);

    expect(socket.messages).toHaveLength(0);
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

  it("notifies all clients subscribed to the same thread", () => {
    const hub = new NotificationHub();
    const socket1 = createMockHubSocket();
    const socket2 = createMockHubSocket();
    const socket3 = createMockHubSocket();

    hub.subscribe(socket1, "thread", "thread-1");
    hub.subscribe(socket2, "thread", "thread-1");
    hub.subscribe(socket3, "thread", "thread-2");
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
        command: { type: "provider.list_models", providerId: "codex" },
      },
    });

    expect(socket.messages.map((message) => JSON.parse(message))).toEqual([
      {
        type: "host-rpc.request",
        requestId: "rpc-1",
        command: { type: "provider.list_models", providerId: "codex" },
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

  it("does not resolve host RPC waiters from mismatched daemon sessions", async () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.registerDaemon("session-1", "host-1", socket);
    hub.registerDaemon("session-2", "host-2", createMockHubSocket());

    const wait = hub.requestHostOnlineRpc({
      hostId: "host-1",
      timeoutMs: 1_000,
      message: {
        type: "host-rpc.request",
        requestId: "rpc-session-scoped",
        command: { type: "provider.list_models", providerId: "codex" },
      },
    });
    let resolved = false;
    const observed = wait.then((response) => {
      resolved = true;
      return response;
    });

    const mismatch = hub.recordHostOnlineRpcResponse({
      message: {
        type: "host-rpc.response",
        requestId: "rpc-session-scoped",
        commandType: "provider.list_models",
        ok: true,
        result: { models: [], selectedOnlyModels: [] },
      },
      sessionId: "session-2",
    });
    expect(mismatch).toEqual({
      expectedSessionId: "session-1",
      handled: false,
      reason: "session_mismatch",
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    const handled = hub.recordHostOnlineRpcResponse({
      message: {
        type: "host-rpc.response",
        requestId: "rpc-session-scoped",
        commandType: "provider.list_models",
        ok: true,
        result: { models: [], selectedOnlyModels: [] },
      },
      sessionId: "session-1",
    });
    expect(handled).toEqual({ handled: true });
    await expect(observed).resolves.toEqual({
      type: "host-rpc.response",
      requestId: "rpc-session-scoped",
      commandType: "provider.list_models",
      ok: true,
      result: { models: [], selectedOnlyModels: [] },
    });
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
        command: { type: "provider.list_models", providerId: "codex" },
      },
    });
    hub.unregisterDaemon("session-1");

    await expect(wait).rejects.toThrow("Host daemon is not connected");
  });

  it("keeps subscription bookkeeping consistent across repeated changes", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();

    for (let index = 0; index < 20; index += 1) {
      hub.subscribe(socket, "thread", "thread-1");
      hub.unsubscribe(socket, "thread", "thread-1");
    }
    hub.subscribe(socket, "thread", "thread-1");
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.messages).toHaveLength(1);

    hub.unregisterClient(socket);
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.messages).toHaveLength(1);
  });

  it("skips and logs broadcasts that fail outgoing schema validation", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const hub = new NotificationHub();
      const socket = createMockHubSocket();
      hub.subscribe(socket, "thread", "thread-1");

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

    hub.subscribe(socket, "system");
    hub.notifySystem(["config-changed"]);

    expect(socket.messages).toHaveLength(1);
    expect(JSON.parse(socket.messages[0])).toEqual({
      type: "changed",
      entity: "system",
      changes: ["config-changed"],
    });
  });

  it("delivers host notifications to entity-wide and id-scoped subscribers", () => {
    const hub = new NotificationHub();
    const entityWideSocket = createMockHubSocket();
    const idScopedSocket = createMockHubSocket();
    const otherHostSocket = createMockHubSocket();

    hub.subscribe(entityWideSocket, "host");
    hub.subscribe(idScopedSocket, "host", "host-1");
    hub.subscribe(otherHostSocket, "host", "host-2");
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

  // One broadcast per entity carrying every declared change kind must clear
  // the outgoing schema gate intact. The per-kind delivery behavior is the
  // same code path; what this pins is that no declared kind is rejected.
  it("passes every declared change kind through the outgoing schema gate", () => {
    const hub = new NotificationHub();
    const threadSocket = createMockHubSocket();
    const projectSocket = createMockHubSocket();
    const environmentSocket = createMockHubSocket();
    const hostSocket = createMockHubSocket();
    const systemSocket = createMockHubSocket();

    hub.subscribe(threadSocket, "thread", "thread-1");
    hub.subscribe(projectSocket, "project", "project-1");
    hub.subscribe(environmentSocket, "environment", "environment-1");
    hub.subscribe(hostSocket, "host", "host-1");
    hub.subscribe(systemSocket, "system");

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
