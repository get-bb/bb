import { heartbeatSession } from "@bb/db";
import {
  hasHostDaemonWebSocketProtocol,
  hostDaemonDaemonWsMessageSchema,
} from "@bb/host-daemon-contract";
import { ApiError } from "../errors.js";
import { verifyAuthenticatedDaemon } from "../internal/auth.js";
import type { AppDeps } from "../types.js";
import { runtimeErrorLogFields } from "../services/lib/error-log-fields.js";
import { requireAuthorizedActiveSession } from "../internal/session-state.js";
import { handleDaemonSocketClosed } from "../internal/session-owner-side-effects.js";
import { notifyDaemonEnvironmentChange } from "../internal/environment-changes.js";
import { decodeSocketPayload } from "./decode-payload.js";

interface DaemonSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

interface DaemonSocketMessageArgs {
  hostId: string;
  raw: unknown;
  sessionId: string;
  socket: DaemonSocket;
}

export async function validateDaemonWebSocket(
  deps: Pick<AppDeps, "db" | "machineAuth">,
  args: {
    authorizationHeader: string | undefined;
    protocolHeader: string | undefined;
    sessionId: string | null;
  },
): Promise<{ hostId: string; sessionId: string }> {
  const sessionId = args.sessionId;
  if (!sessionId) {
    throw new ApiError(401, "unauthorized", "Unauthorized");
  }
  if (!hasHostDaemonWebSocketProtocol(args.protocolHeader)) {
    throw new ApiError(
      400,
      "invalid_request",
      "Unsupported host daemon websocket protocol",
    );
  }

  const verified = await verifyAuthenticatedDaemon(
    deps,
    args.authorizationHeader,
  );
  const session = requireAuthorizedActiveSession(deps.db, {
    hostId: verified.hostId,
    sessionId,
  });

  return {
    sessionId: session.id,
    hostId: session.hostId,
  };
}

export function onDaemonSocketOpen(
  deps: Pick<
    AppDeps,
    | "config"
    | "db"
    | "hub"
    | "lifecycleDedupers"
    | "logger"
    | "machineAuth"
    | "pendingInteractions"
    | "telemetry"
    | "terminalSessions"
  >,
  args: { hostId: string; sessionId: string; socket: DaemonSocket },
): void {
  deps.logger.info(
    { sessionId: args.sessionId, hostId: args.hostId },
    "Daemon WebSocket opened",
  );
  deps.hub.registerDaemon(args.sessionId, args.hostId, args.socket);
  deps.terminalSessions.expireDisconnectedHostTerminals({
    daemonSessionId: args.sessionId,
    hostId: args.hostId,
  });
}

export function onDaemonSocketMessage(
  deps: Pick<AppDeps, "config" | "db" | "hub" | "logger" | "terminalSessions">,
  args: DaemonSocketMessageArgs,
): void {
  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeSocketPayload(args.raw));
  } catch {
    args.socket.close(1008, "invalid-message");
    return;
  }

  const result = hostDaemonDaemonWsMessageSchema.safeParse(decoded);
  if (!result.success) {
    args.socket.close(1008, "invalid-message");
    return;
  }

  try {
    const session = requireAuthorizedActiveSession(deps.db, {
      hostId: args.hostId,
      sessionId: args.sessionId,
    });
    heartbeatSession(
      deps.db,
      session.id,
      Math.max(Date.now() + session.leaseTimeoutMs, session.leaseExpiresAt + 1),
    );
    if (result.data.type === "environment-change") {
      notifyDaemonEnvironmentChange(deps, {
        hostId: args.hostId,
        environmentId: result.data.environmentId,
        change: result.data.change,
      });
      return;
    }
    if (result.data.type === "host-rpc.response") {
      const disposition = deps.hub.recordHostOnlineRpcResponse({
        message: result.data,
        sessionId: args.sessionId,
      });
      if (!disposition.handled && disposition.reason === "session_mismatch") {
        deps.logger.warn(
          {
            commandType: result.data.commandType,
            expectedSessionId: disposition.expectedSessionId,
            requestId: result.data.requestId,
            sessionId: args.sessionId,
          },
          "Ignoring host RPC response from mismatched daemon session",
        );
      } else if (!disposition.handled) {
        deps.logger.debug(
          {
            commandType: result.data.commandType,
            requestId: result.data.requestId,
            sessionId: args.sessionId,
          },
          "Ignoring stale host RPC response",
        );
      }
      return;
    }
    if (result.data.type !== "heartbeat") {
      deps.terminalSessions.handleDaemonTerminalMessage({
        hostId: args.hostId,
        message: result.data,
        sessionId: args.sessionId,
      });
    }
  } catch (error) {
    if (error instanceof ApiError && error.body.code === "inactive_session") {
      deps.logger.info(
        { sessionId: args.sessionId },
        "Daemon heartbeat for inactive session, closing socket",
      );
      args.socket.close(1008, "inactive-session");
      return;
    }

    if (error instanceof ApiError && error.status === 403) {
      deps.logger.warn(
        {
          sessionId: args.sessionId,
          ...runtimeErrorLogFields(deps.config, error),
        },
        "Daemon heartbeat for unauthorized session, closing socket",
      );
      args.socket.close(1008, "unauthorized-session");
      return;
    }

    deps.logger.warn(
      {
        sessionId: args.sessionId,
        ...runtimeErrorLogFields(deps.config, error),
      },
      "Daemon heartbeat rejected, closing socket",
    );
    args.socket.close(1008, "inactive-session");
  }
}

export function onDaemonSocketClose(
  deps: Pick<
    AppDeps,
    "db" | "hub" | "logger" | "pendingInteractions" | "terminalSessions"
  >,
  sessionId: string,
): void {
  handleDaemonSocketClosed(deps, {
    sessionId,
  });
}
