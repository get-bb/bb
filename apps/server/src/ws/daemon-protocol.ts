import { reportEnvironmentHookProgress } from "../services/environments/environment-hooks.js";
import { syncDesktopBrowserTabs } from "../services/desktop-browsers.js";
import { heartbeatSession } from "@bb/db";
import {
  hasHostDaemonWebSocketProtocol,
  hostDaemonDaemonWsMessageSchema,
} from "@bb/host-daemon-contract";
import { ApiError } from "../errors.js";
import { verifyAuthenticatedDaemon } from "../internal/auth.js";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../types.js";
import { runtimeErrorLogFields } from "../services/lib/error-log-fields.js";
import {
  getInactiveSessionLogFields,
  requireAuthorizedOpenSession,
} from "../internal/session-state.js";
import { handleDaemonSocketClosed } from "../internal/session-owner-side-effects.js";
import {
  notifyDaemonEnvironmentChange,
  recordDaemonEnvironmentMetadataChange,
} from "../internal/environment-changes.js";
import { requestQueuedMessageDispatch } from "../services/threads/queued-message-dispatch.js";
import { runEventLoopWorkSync } from "../services/system/event-loop-work.js";
import { parseSocketMessage } from "./decode-payload.js";
import type { PluginService } from "../services/plugins/plugin-service.js";

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
  const session = requireAuthorizedOpenSession(deps.db, {
    hostId: verified.hostId,
    sessionId,
  });

  return {
    sessionId: session.id,
    hostId: session.hostId,
  };
}

export function onDaemonSocketOpen(
  deps: LoggedPendingInteractionWorkSessionDeps &
    Pick<AppDeps, "hub" | "logger" | "sharedPorts" | "terminalSessions">,
  args: { hostId: string; sessionId: string; socket: DaemonSocket },
): void {
  deps.logger.info(
    { sessionId: args.sessionId, hostId: args.hostId },
    "Daemon WebSocket opened",
  );
  deps.hub.registerDaemon(args.sessionId, args.hostId, args.socket);
  deps.sharedPorts.pushCurrentSharedPortsForHost(args.hostId);
  deps.terminalSessions.expireDisconnectedHostTerminals({
    daemonSessionId: args.sessionId,
    hostId: args.hostId,
  });
  // A dispatch that arrived while this machine was away parked its row on a
  // `host-offline` wait with no schedule, so no sweep can see it — the
  // machine coming back is that wait's release signal, and this socket
  // opening is where core hears it.
  requestQueuedMessageDispatch(deps, {
    hostId: args.hostId,
    kind: "host-connected",
  });
}

export function onDaemonSocketMessage(
  deps: Pick<
    AppDeps,
    "config" | "db" | "hub" | "logger" | "sharedPorts" | "terminalSessions"
  >,
  args: DaemonSocketMessageArgs,
  plugins?: Pick<PluginService, "handleHostSignal" | "handleHostWorkerExit">,
): void {
  const message = parseSocketMessage(
    args.socket,
    args.raw,
    hostDaemonDaemonWsMessageSchema,
  );
  if (message === null) {
    return;
  }

  try {
    runEventLoopWorkSync(`ws:daemon ${message.type}`, () => {
      const session = requireAuthorizedOpenSession(deps.db, {
        hostId: args.hostId,
        sessionId: args.sessionId,
      });
      heartbeatSession(
        deps.db,
        session.id,
        Math.max(
          Date.now() + session.leaseTimeoutMs,
          session.leaseExpiresAt + 1,
        ),
      );
      if (message.type === "environment-change") {
        notifyDaemonEnvironmentChange(deps, {
          hostId: args.hostId,
          environmentId: message.environmentId,
          change: message.change,
        });
        return;
      }
      if (message.type === "environment-metadata-change") {
        recordDaemonEnvironmentMetadataChange(deps, {
          hostId: args.hostId,
          environmentId: message.environmentId,
          workspace: message.workspace,
        });
        return;
      }
      if (message.type === "host-rpc.response") {
        const disposition = deps.hub.recordHostOnlineRpcResponse({
          message,
          sessionId: args.sessionId,
        });
        if (!disposition.handled && disposition.reason === "session_mismatch") {
          deps.logger.warn(
            {
              commandType: message.commandType,
              expectedSessionId: disposition.expectedSessionId,
              requestId: message.requestId,
              sessionId: args.sessionId,
            },
            "Ignoring host RPC response from mismatched daemon session",
          );
        } else if (!disposition.handled) {
          deps.logger.debug(
            {
              commandType: message.commandType,
              requestId: message.requestId,
              sessionId: args.sessionId,
            },
            "Ignoring stale host RPC response",
          );
        }
        return;
      }
      if (message.type === "connect-tunnel.identity") {
        deps.sharedPorts.recordTunnelIdentity(args.hostId, message.identity);
        return;
      }
      if (message.type === "desktop-browser.changed") {
        const scope = {
          hostId: args.hostId,
          instanceId: message.instanceId,
          generation: message.generation,
          threadId: message.threadId,
        };
        try {
          syncDesktopBrowserTabs(deps, scope, message.tabs);
        } catch (error) {
          deps.logger.warn(
            {
              sessionId: args.sessionId,
              ...scope,
              ...runtimeErrorLogFields(deps.config, error),
            },
            "Dropping desktop browser snapshot the server cannot apply",
          );
        }
        return;
      }
      if (message.type === "plugin-host.worker-exited") {
        plugins?.handleHostWorkerExit({
          authenticatedHostId: args.hostId,
          pluginId: message.pluginId,
          generation: message.generation,
        });
        return;
      }
      if (message.type === "environment.hook.progress") {
        reportEnvironmentHookProgress(deps, args.hostId, message);
        return;
      }
      if (message.type === "plugin-host.signal") {
        plugins?.handleHostSignal({
          authenticatedHostId: args.hostId,
          pluginId: message.pluginId,
          generation: message.generation,
          signal: message.signal,
          payload: message.payload,
        });
        return;
      }
      if (message.type === "heartbeat") {
        args.socket.send(JSON.stringify({ type: "heartbeat-ack" }));
        return;
      }
      if (message.type === "machine.shutdown-ack") {
        return;
      }
      deps.terminalSessions.handleDaemonTerminalMessage({
        hostId: args.hostId,
        message,
        sessionId: args.sessionId,
      });
    });
  } catch (error) {
    if (error instanceof ApiError && error.body.code === "inactive_session") {
      deps.logger.info(
        getInactiveSessionLogFields(deps.db, {
          authenticatedHostId: args.hostId,
          now: Date.now(),
          sessionId: args.sessionId,
        }),
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
        messageType: message.type,
        ...runtimeErrorLogFields(deps.config, error),
      },
      "Daemon message rejected, closing socket",
    );
    args.socket.close(1008, "inactive-session");
  }
}

export function onDaemonSocketClose(
  deps: Pick<
    AppDeps,
    | "db"
    | "hub"
    | "logger"
    | "pendingInteractions"
    | "providerRegistry"
    | "sharedPorts"
    | "terminalSessions"
  >,
  sessionId: string,
): void {
  handleDaemonSocketClosed(deps, {
    sessionId,
  });
}
