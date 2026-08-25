import {
  hostDaemonOnlineRpcResponseMessageSchema,
  hostDaemonServerWsMessageSchema,
  type HostDaemonOnlineRpcRequestMessage,
  type HostDaemonOnlineRpcResult,
} from "@bb/host-daemon-contract";
import { hostDaemonSessions } from "@bb/db";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  callHostOnlineRpc,
  callHostRetryableOnlineRpc,
} from "../../src/services/hosts/online-rpc.js";
import type { NotificationHub } from "../../src/ws/hub.js";
import {
  feedRawDaemonWebSocketMessage,
  type TestDaemonWebSocket,
} from "../helpers/daemon-ws.js";
import { TRANSPORT_TEST_BRIDGE_LAUNCH } from "../helpers/provider-registry.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

type TestHostRpcSocket = TestDaemonWebSocket;

interface DaemonSocketCloseRecord {
  code: number | undefined;
  reason: string | undefined;
}

interface DropThenReplaceSocketArgs {
  hostId: string;
  hub: NotificationHub;
  requests: HostDaemonOnlineRpcRequestMessage[];
  sessionId: string;
  successResult: HostDaemonOnlineRpcResult;
}

function parseHostRpcRequest(data: string): HostDaemonOnlineRpcRequestMessage {
  const message = hostDaemonServerWsMessageSchema.parse(JSON.parse(data));
  if (message.type !== "host-rpc.request") {
    throw new Error(`Expected host-rpc.request, got ${message.type}`);
  }
  return message;
}

function registerDropThenReplaceSocket(args: DropThenReplaceSocketArgs): void {
  const retrySocket: TestHostRpcSocket = {
    close() {},
    send(data) {
      const request = parseHostRpcRequest(data);
      args.requests.push(request);
      args.hub.recordHostOnlineRpcResponse({
        sessionId: args.sessionId,
        message: hostDaemonOnlineRpcResponseMessageSchema.parse({
          type: "host-rpc.response",
          requestId: request.requestId,
          commandType: request.command.type,
          ok: true,
          result: args.successResult,
        }),
      });
    },
  };
  const droppedSocket: TestHostRpcSocket = {
    close() {},
    send(data) {
      args.requests.push(parseHostRpcRequest(data));
      args.hub.unregisterDaemon(args.sessionId);
      args.hub.registerDaemon(args.sessionId, args.hostId, retrySocket);
    },
  };
  args.hub.unregisterDaemon(args.sessionId);
  args.hub.registerDaemon(args.sessionId, args.hostId, droppedSocket);
}

describe("host online RPC retry semantics", () => {
  it("runs a retryable RPC when the daemon websocket is still registered with a stale lease", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-online-rpc-stale-lease-live-socket",
      });
      const requests: HostDaemonOnlineRpcRequestMessage[] = [];
      harness.hub.unregisterDaemon(session.id);
      const socket: TestHostRpcSocket = {
        close() {},
        send(data) {
          const request = parseHostRpcRequest(data);
          requests.push(request);
          harness.hub.recordHostOnlineRpcResponse({
            sessionId: session.id,
            message: hostDaemonOnlineRpcResponseMessageSchema.parse({
              type: "host-rpc.response",
              requestId: request.requestId,
              commandType: request.command.type,
              ok: true,
              result: { models: [], selectedOnlyModels: [] },
            }),
          });
        },
      };
      harness.hub.registerDaemon(session.id, host.id, socket);
      harness.db
        .update(hostDaemonSessions)
        .set({ leaseExpiresAt: Date.now() - 1000 })
        .where(eq(hostDaemonSessions.id, session.id))
        .run();

      await expect(
        callHostRetryableOnlineRpc(harness.deps, {
          hostId: host.id,
          timeoutMs: 1_000,
          command: {
            type: "provider.list_models",
            providerId: "codex",
            bridgeLaunch: TRANSPORT_TEST_BRIDGE_LAUNCH,
          },
        }),
      ).resolves.toEqual({ models: [], selectedOnlyModels: [] });

      const updatedSession = harness.db
        .select()
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.id, session.id))
        .get();
      expect(updatedSession?.status).toBe("active");
      expect(requests.map((request) => request.command.type)).toEqual([
        "provider.list_models",
      ]);
    });
  });

  it("waits briefly for retryable RPCs when the session is active before the daemon websocket registers", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-online-rpc-registration-race",
      });
      const requests: HostDaemonOnlineRpcRequestMessage[] = [];
      harness.hub.unregisterDaemon(session.id);

      setTimeout(() => {
        const socket: TestHostRpcSocket = {
          close() {},
          send(data) {
            const request = parseHostRpcRequest(data);
            requests.push(request);
            harness.hub.recordHostOnlineRpcResponse({
              sessionId: session.id,
              message: hostDaemonOnlineRpcResponseMessageSchema.parse({
                type: "host-rpc.response",
                requestId: request.requestId,
                commandType: request.command.type,
                ok: true,
                result: { models: [], selectedOnlyModels: [] },
              }),
            });
          },
        };
        harness.hub.registerDaemon(session.id, host.id, socket);
      }, 10);

      await expect(
        callHostRetryableOnlineRpc(harness.deps, {
          hostId: host.id,
          timeoutMs: 1_000,
          command: {
            type: "provider.list_models",
            providerId: "codex",
            bridgeLaunch: TRANSPORT_TEST_BRIDGE_LAUNCH,
          },
        }),
      ).resolves.toEqual({ models: [], selectedOnlyModels: [] });
      expect(requests.map((request) => request.command.type)).toEqual([
        "provider.list_models",
      ]);
    });
  });

  it("retries read-only online RPCs when the current websocket session disappears", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-online-rpc-read-retry",
      });
      const requests: HostDaemonOnlineRpcRequestMessage[] = [];
      registerDropThenReplaceSocket({
        hostId: host.id,
        hub: harness.hub,
        requests,
        sessionId: session.id,
        successResult: { models: [], selectedOnlyModels: [] },
      });

      await expect(
        callHostRetryableOnlineRpc(harness.deps, {
          hostId: host.id,
          timeoutMs: 1_000,
          command: {
            type: "provider.list_models",
            providerId: "codex",
            bridgeLaunch: TRANSPORT_TEST_BRIDGE_LAUNCH,
          },
        }),
      ).resolves.toEqual({ models: [], selectedOnlyModels: [] });
      expect(requests.map((request) => request.command.type)).toEqual([
        "provider.list_models",
        "provider.list_models",
      ]);
    });
  });

  it("retries read-only online RPCs when the first response times out", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-online-rpc-timeout-retry",
      });
      const requests: HostDaemonOnlineRpcRequestMessage[] = [];
      const socket: TestHostRpcSocket = {
        close() {},
        send(data) {
          const request = parseHostRpcRequest(data);
          requests.push(request);
          if (requests.length === 1) return;
          const firstRequest = requests[0];
          if (firstRequest === undefined) {
            throw new Error("Expected the timed-out first host RPC request");
          }
          expect(
            harness.hub.recordHostOnlineRpcResponse({
              sessionId: session.id,
              message: hostDaemonOnlineRpcResponseMessageSchema.parse({
                type: "host-rpc.response",
                requestId: firstRequest.requestId,
                commandType: firstRequest.command.type,
                ok: true,
                result: { models: [], selectedOnlyModels: [] },
              }),
            }),
          ).toEqual({ handled: false, reason: "stale" });
          expect(
            harness.hub.recordHostOnlineRpcResponse({
              sessionId: session.id,
              message: hostDaemonOnlineRpcResponseMessageSchema.parse({
                type: "host-rpc.response",
                requestId: request.requestId,
                commandType: request.command.type,
                ok: true,
                result: { models: [], selectedOnlyModels: [] },
              }),
            }),
          ).toEqual({ handled: true });
        },
      };
      harness.hub.registerDaemon(session.id, host.id, socket);

      vi.useFakeTimers();
      try {
        const result = expect(
          callHostRetryableOnlineRpc(harness.deps, {
            hostId: host.id,
            timeoutMs: 10,
            command: {
              type: "provider.list_models",
              providerId: "codex",
              bridgeLaunch: TRANSPORT_TEST_BRIDGE_LAUNCH,
            },
          }),
        ).resolves.toEqual({ models: [], selectedOnlyModels: [] });
        await vi.advanceTimersByTimeAsync(0);
        expect(requests).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(5);
        await result;
      } finally {
        vi.useRealTimers();
      }

      expect(requests.map((request) => request.command.type)).toEqual([
        "provider.list_models",
        "provider.list_models",
      ]);
      expect(requests[0]?.requestId).not.toBe(requests[1]?.requestId);
    });
  });

  it("does not retry ordinary online RPCs when the response times out", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-online-rpc-timeout-no-retry",
      });
      const requests: HostDaemonOnlineRpcRequestMessage[] = [];
      const socket: TestHostRpcSocket = {
        close() {},
        send(data) {
          requests.push(parseHostRpcRequest(data));
        },
      };
      harness.hub.registerDaemon(session.id, host.id, socket);

      vi.useFakeTimers();
      try {
        const result = expect(
          callHostOnlineRpc(harness.deps, {
            hostId: host.id,
            timeoutMs: 10,
            command: {
              type: "provider.list_models",
              providerId: "codex",
              bridgeLaunch: TRANSPORT_TEST_BRIDGE_LAUNCH,
            },
          }),
        ).rejects.toMatchObject({
          status: 504,
          body: { code: "command_timeout" },
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(requests).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(10);
        await result;
      } finally {
        vi.useRealTimers();
      }

      expect(requests).toHaveLength(1);
    });
  });

  it("spends one timeout budget across both response attempts", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-online-rpc-timeout-budget",
      });
      const requests: HostDaemonOnlineRpcRequestMessage[] = [];
      const socket: TestHostRpcSocket = {
        close() {},
        send(data) {
          requests.push(parseHostRpcRequest(data));
        },
      };
      harness.hub.registerDaemon(session.id, host.id, socket);

      vi.useFakeTimers();
      try {
        let outcome:
          | "pending"
          | "resolved"
          | "command_timeout"
          | "other_error" = "pending";
        void callHostRetryableOnlineRpc(harness.deps, {
          hostId: host.id,
          timeoutMs: 10,
          command: {
            type: "provider.list_models",
            providerId: "codex",
            bridgeLaunch: TRANSPORT_TEST_BRIDGE_LAUNCH,
          },
        }).then(
          () => {
            outcome = "resolved";
          },
          (error) => {
            outcome =
              error instanceof ApiError &&
              error.status === 504 &&
              error.body.code === "command_timeout"
                ? "command_timeout"
                : "other_error";
          },
        );

        await vi.advanceTimersByTimeAsync(0);
        expect(requests).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(4);
        expect(requests).toHaveLength(1);
        expect(outcome).toBe("pending");
        await vi.advanceTimersByTimeAsync(1);
        expect(requests).toHaveLength(2);
        expect(outcome).toBe("pending");
        await vi.advanceTimersByTimeAsync(4);
        expect(outcome).toBe("pending");
        await vi.advanceTimersByTimeAsync(1);
        expect(outcome).toBe("command_timeout");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("does not retry non-retry host RPC calls after websocket unavailability", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-online-rpc-no-retry",
      });
      const requests: HostDaemonOnlineRpcRequestMessage[] = [];
      registerDropThenReplaceSocket({
        hostId: host.id,
        hub: harness.hub,
        requests,
        sessionId: session.id,
        successResult: { models: [], selectedOnlyModels: [] },
      });

      try {
        await callHostOnlineRpc(harness.deps, {
          hostId: host.id,
          timeoutMs: 1_000,
          command: {
            type: "provider.list_models",
            providerId: "codex",
            bridgeLaunch: TRANSPORT_TEST_BRIDGE_LAUNCH,
          },
        });
        throw new Error("Expected host RPC to fail");
      } catch (error) {
        if (!(error instanceof ApiError)) {
          throw error;
        }
        expect(error.status).toBe(502);
        expect(error.body.code).toBe("host_unavailable");
      }
      expect(requests.map((request) => request.command.type)).toEqual([
        "provider.list_models",
      ]);
    });
  });

  it("rejects malformed host RPC responses at the daemon websocket boundary without resolving the waiter", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-online-rpc-boundary-rejects-malformed-response",
      });
      const filePath = "/tmp/report.html";
      const requests: HostDaemonOnlineRpcRequestMessage[] = [];
      const closes: DaemonSocketCloseRecord[] = [];
      const socket: TestHostRpcSocket = {
        close(code, reason) {
          closes.push({ code, reason });
        },
        send(data) {
          const request = parseHostRpcRequest(data);
          requests.push(request);
          feedRawDaemonWebSocketMessage({
            harness,
            hostId: host.id,
            sessionId: session.id,
            socket,
            rawMessage: {
              type: "host-rpc.response",
              requestId: request.requestId,
              commandType: "host.file_metadata",
              ok: true,
              result: {
                path: filePath,
                content: "<!doctype html>",
                contentEncoding: "utf8",
                mimeType: "text/html",
                sizeBytes: 15,
                sha256: "0".repeat(64),
              },
            },
          });
        },
      };
      harness.hub.unregisterDaemon(session.id);
      harness.hub.registerDaemon(session.id, host.id, socket);

      try {
        await callHostOnlineRpc(harness.deps, {
          hostId: host.id,
          timeoutMs: 25,
          command: {
            type: "host.file_metadata",
            path: filePath,
          },
        });
        throw new Error("Expected malformed daemon response to time out");
      } catch (error) {
        if (!(error instanceof ApiError)) {
          throw error;
        }
        expect(error.status).toBe(504);
        expect(error.body.code).toBe("command_timeout");
      }

      expect(requests.map((request) => request.command)).toEqual([
        {
          type: "host.file_metadata",
          path: filePath,
        },
      ]);
      expect(closes).toEqual([{ code: 1008, reason: "invalid-message" }]);
    });
  });

  it("rejects schema-valid host RPC responses whose commandType does not match the pending request", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-online-rpc-rejects-pending-command-type-mismatch",
      });
      const filePath = "/tmp/report.html";
      const requests: HostDaemonOnlineRpcRequestMessage[] = [];
      const closes: DaemonSocketCloseRecord[] = [];
      const socket: TestHostRpcSocket = {
        close(code, reason) {
          closes.push({ code, reason });
        },
        send(data) {
          const request = parseHostRpcRequest(data);
          requests.push(request);
          feedRawDaemonWebSocketMessage({
            harness,
            hostId: host.id,
            sessionId: session.id,
            socket,
            rawMessage: {
              type: "host-rpc.response",
              requestId: request.requestId,
              commandType: "host.read_file",
              ok: true,
              result: {
                path: filePath,
                content: "<!doctype html>",
                contentEncoding: "utf8",
                mimeType: "text/html",
                modifiedAtMs: 1234,
                sizeBytes: 15,
                sha256: "0".repeat(64),
              },
            },
          });
        },
      };
      harness.hub.unregisterDaemon(session.id);
      harness.hub.registerDaemon(session.id, host.id, socket);

      try {
        await callHostOnlineRpc(harness.deps, {
          hostId: host.id,
          timeoutMs: 1_000,
          command: {
            type: "host.file_metadata",
            path: filePath,
          },
        });
        throw new Error("Expected mismatched host RPC response to fail");
      } catch (error) {
        if (!(error instanceof ApiError)) {
          throw error;
        }
        expect(error.status).toBe(500);
        expect(error.body.code).toBe("command_result_type_mismatch");
        expect(error.body.message).toContain(
          "completed with unexpected type host.read_file",
        );
      }

      expect(requests.map((request) => request.command)).toEqual([
        {
          type: "host.file_metadata",
          path: filePath,
        },
      ]);
      expect(closes).toEqual([]);
    });
  });
});
