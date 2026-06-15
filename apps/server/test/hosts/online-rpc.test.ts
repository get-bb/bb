import {
  hostDaemonOnlineRpcResponseMessageSchema,
  hostDaemonServerWsMessageSchema,
  type HostDaemonOnlineRpcRequestMessage,
  type HostDaemonOnlineRpcResult,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
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
        successResult: { providers: [] },
      });

      await expect(
        callHostRetryableOnlineRpc(harness.deps, {
          hostId: host.id,
          timeoutMs: 1_000,
          command: { type: "provider.list" },
        }),
      ).resolves.toEqual({ providers: [] });
      expect(requests.map((request) => request.command.type)).toEqual([
        "provider.list",
        "provider.list",
      ]);
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
        successResult: { providers: [] },
      });

      try {
        await callHostOnlineRpc(harness.deps, {
          hostId: host.id,
          timeoutMs: 1_000,
          command: { type: "provider.list" },
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
        "provider.list",
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
