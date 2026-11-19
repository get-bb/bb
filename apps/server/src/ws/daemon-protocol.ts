import { reportEnvironmentHookProgress } from "../services/environments/environment-hooks.js";
import { syncDesktopBrowserTabs } from "../services/desktop-browsers.js";
import { getExperiments, heartbeatSession, recordSessionRoute } from "@bb/db";
import {
  HOST_DAEMON_WS_RESUME_REJECTED_CLOSE_CODE,
  HOST_DAEMON_WS_SHUTDOWN_CLOSE_REASON,
  hasHostDaemonWebSocketProtocol,
  hostDaemonDaemonWsMessageSchema,
  hostDaemonWsResumeFromSchema,
  type HostDaemonDaemonWsMessage,
} from "@bb/host-daemon-contract";
import { ApiError } from "../errors.js";
import { verifyAuthenticatedDaemon } from "../internal/auth.js";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
  WorkSessionDeps,
} from "../types.js";
import { runtimeErrorLogFields } from "../services/lib/error-log-fields.js";
import {
  getInactiveSessionLogFields,
  requireAuthorizedOpenSession,
} from "../internal/session-state.js";
import {
  handleDaemonSessionResumeExpired,
  handleDaemonSessionSilent,
  handleDaemonSocketClosed,
  handleDaemonSocketOpened,
} from "../internal/session-owner-side-effects.js";
import {
  HEARTBEAT_INTERVAL_MS,
  HOST_RECONNECT_GRACE_MS,
  LEASE_TIMEOUT_MS,
} from "../constants.js";
import {
  notifyDaemonEnvironmentChange,
  notifyDaemonThreadStorageChange,
  recordDaemonEnvironmentMetadataChange,
} from "../internal/environment-changes.js";
import { requestQueuedMessageDispatch } from "../services/threads/queued-message-dispatch.js";
import { runEventLoopWorkSync } from "../services/system/event-loop-work.js";
import { parseSocketValue } from "./decode-payload.js";
import { DaemonChannel, type RawDaemonSocket } from "./daemon-channel.js";
import type { PluginService } from "../services/plugins/plugin-service.js";
import type { ServerMoveCoordinator } from "../services/server-move/coordinator.js";
import {
  isServerMoveFrozen,
  isServerMoveSnapshotFenced,
} from "../services/server-move/freeze-state.js";
import { resumeEnvironmentProvisioningForReconnectedDaemon } from "../services/environments/environment-engine.js";

interface DaemonSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

interface DaemonSocketMessageArgs {
  hostId: string;
  message: unknown;
  sessionId: string;
  socket: DaemonSocket;
}

interface DaemonSocketSessionTarget {
  hostId: string;
  sessionId: string;
}

export type DaemonSocketTarget =
  | (DaemonSocketSessionTarget & { kind: "open" })
  | (DaemonSocketSessionTarget & {
      channel: DaemonChannel;
      kind: "resume";
      resumeFrom: number;
    })
  | (DaemonSocketSessionTarget & { kind: "resume-rejected" });

export async function validateDaemonWebSocket(
  deps: Pick<AppDeps, "db" | "hub" | "machineAuth">,
  args: {
    authorizationHeader: string | undefined;
    protocolHeader: string | undefined;
    resumeFrom: string | null;
    sessionId: string | null;
  },
): Promise<DaemonSocketTarget> {
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
  const resumeFrom =
    args.resumeFrom === null
      ? null
      : hostDaemonWsResumeFromSchema.safeParse(args.resumeFrom);
  if (resumeFrom !== null && !resumeFrom.success) {
    throw new ApiError(400, "invalid_request", "Invalid resume sequence");
  }

  const verified = await verifyAuthenticatedDaemon(
    deps,
    args.authorizationHeader,
  );
  if (resumeFrom === null) {
    const session = requireAuthorizedOpenSession(deps.db, {
      hostId: verified.hostId,
      sessionId,
    });
    return { hostId: session.hostId, kind: "open", sessionId: session.id };
  }

  const target = { hostId: verified.hostId, sessionId };
  const channel = deps.hub.getDaemonSessionSocket(sessionId);
  if (
    !(channel instanceof DaemonChannel) ||
    !channel.canResumeFrom(resumeFrom.data) ||
    !isOpenSessionForHost(deps, target)
  ) {
    return { ...target, kind: "resume-rejected" };
  }
  return { ...target, channel, kind: "resume", resumeFrom: resumeFrom.data };
}

function isOpenSessionForHost(
  deps: Pick<AppDeps, "db">,
  target: DaemonSocketSessionTarget,
): boolean {
  try {
    requireAuthorizedOpenSession(deps.db, target);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.body.code === "inactive_session") {
      return false;
    }
    throw error;
  }
}

export interface DaemonSocketEvents {
  onClose(socket: RawDaemonSocket, reason: string): void;
  onMessage(socket: RawDaemonSocket, raw: unknown): void;
  onOpen(socket: RawDaemonSocket): void;
}

export function createDaemonSocketEvents(
  deps: WorkSessionDeps &
    Pick<AppDeps, "hub" | "logger" | "sharedPorts" | "terminalSessions"> &
    LoggedPendingInteractionWorkSessionDeps,
  target: DaemonSocketTarget,
  plugins?: Pick<
    PluginService,
    "handleHostSignal" | "handleHostWorkerExit" | "handleHostWorkerOutput"
  >,
  serverMove?: Pick<ServerMoveCoordinator, "handleProgress">,
): DaemonSocketEvents {
  let channel: DaemonChannel | null = null;
  return {
    onOpen: (socket) => {
      if (target.kind === "open") {
        channel = new DaemonChannel(socket);
        onDaemonSocketOpen(deps, { ...target, socket: channel });
        return;
      }
      if (
        target.kind === "resume-rejected" ||
        deps.hub.getDaemonSessionSocket(target.sessionId) !== target.channel ||
        !target.channel.canResumeFrom(target.resumeFrom)
      ) {
        deps.logger.info(
          { hostId: target.hostId, sessionId: target.sessionId },
          "Refusing to resume a daemon session the server no longer holds",
        );
        socket.close(
          HOST_DAEMON_WS_RESUME_REJECTED_CLOSE_CODE,
          "resume-rejected",
        );
        return;
      }
      channel = target.channel;
      channel.resume(socket, target.resumeFrom);
      onDaemonSocketResumed(deps, target);
    },
    onMessage: (socket, raw) => {
      const received = channel?.receive(socket, raw);
      if (!channel || !received) {
        return;
      }
      onDaemonSocketMessage(
        deps,
        {
          hostId: target.hostId,
          message: received.message,
          sessionId: target.sessionId,
          socket: channel,
        },
        plugins,
        serverMove,
      );
    },
    onClose: (socket, reason) => {
      if (channel === null) {
        return;
      }
      const detached = channel.detach(socket);
      if (detached === "stale") {
        return;
      }
      if (
        detached === "detached" &&
        reason !== HOST_DAEMON_WS_SHUTDOWN_CLOSE_REASON &&
        deps.hub.getDaemonSessionSocket(target.sessionId) === channel &&
        getExperiments(deps.db).resumeDaemonSessions
      ) {
        onDaemonSocketDetached(deps, target);
        return;
      }
      channel.close();
      onDaemonSocketClose(deps, target.sessionId);
    },
  };
}

const HEARTBEAT_ACK_PAYLOAD = JSON.stringify({ type: "heartbeat-ack" });
const LEASE_RENEWAL_INTERVAL_MS = LEASE_TIMEOUT_MS - 2 * HEARTBEAT_INTERVAL_MS;

export const SERVER_MOVE_FENCED_DAEMON_MESSAGE_TYPES: ReadonlySet<
  HostDaemonDaemonWsMessage["type"]
> = new Set([
  "environment-metadata-change",
  "desktop-browser.changed",
  "plugin-host.signal",
  "plugin-host.worker-exited",
  "session.route",
  "terminal.opened",
  "terminal.exited",
]);

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
  handleDaemonSocketOpened(deps, { hostId: args.hostId });
  deps.sharedPorts.pushCurrentSharedPortsForHost(args.hostId);
  if (!isServerMoveSnapshotFenced(deps.db)) {
    deps.terminalSessions.reconcileDisconnectedHostTerminals({
      daemonSessionId: args.sessionId,
      hostId: args.hostId,
    });
  }
  if (isServerMoveFrozen(deps.db)) {
    return;
  }
  // A dispatch that arrived while this machine was away parked its row on a
  // `host-offline` wait with no schedule, so no sweep can see it — the
  // machine coming back is that wait's release signal, and this socket
  // opening is where core hears it.
  requestQueuedMessageDispatch(deps, {
    hostId: args.hostId,
    kind: "host-connected",
  });
  void resumeEnvironmentProvisioningForReconnectedDaemon(deps, {
    hostId: args.hostId,
  }).catch((error) => {
    deps.logger.warn(
      {
        err: error,
        hostId: args.hostId,
        sessionId: args.sessionId,
      },
      "Environment provisioning reconnect resume failed",
    );
  });
}

export function onDaemonSocketMessage(
  deps: WorkSessionDeps & Pick<AppDeps, "sharedPorts" | "terminalSessions">,
  args: DaemonSocketMessageArgs,
  plugins?: Pick<
    PluginService,
    "handleHostSignal" | "handleHostWorkerExit" | "handleHostWorkerOutput"
  >,
  serverMove?: Pick<ServerMoveCoordinator, "handleProgress">,
): void {
  deps.hub.recordDaemonActivity(args.sessionId);
  const message = parseSocketValue(
    args.socket,
    args.message,
    hostDaemonDaemonWsMessageSchema,
  );
  if (message === null) {
    return;
  }
  const acknowledged =
    message.type === "heartbeat" &&
    deps.hub.getDaemonSessionSocket(args.sessionId) === args.socket;
  if (acknowledged) {
    args.socket.send(HEARTBEAT_ACK_PAYLOAD);
  }
  const leaseRenewalDue = deps.hub.takeDaemonLeaseRenewal(
    args.sessionId,
    Date.now(),
    LEASE_RENEWAL_INTERVAL_MS,
  );
  if (acknowledged && !leaseRenewalDue) {
    return;
  }

  try {
    runEventLoopWorkSync(`ws:daemon ${message.type}`, () => {
      const session = requireAuthorizedOpenSession(deps.db, {
        hostId: args.hostId,
        sessionId: args.sessionId,
      });
      if (leaseRenewalDue) {
        heartbeatSession(
          deps.db,
          session.id,
          Math.max(
            Date.now() + session.leaseTimeoutMs,
            session.leaseExpiresAt + 1,
          ),
        );
      }
      if (
        isServerMoveSnapshotFenced(deps.db) &&
        SERVER_MOVE_FENCED_DAEMON_MESSAGE_TYPES.has(message.type)
      ) {
        if (message.type === "terminal.opened") {
          deps.terminalSessions.refuseDaemonTerminalOpen({
            message,
            sessionId: args.sessionId,
          });
        }
        deps.logger.debug(
          {
            hostId: args.hostId,
            messageType: message.type,
            sessionId: args.sessionId,
          },
          "Ignoring a daemon change while the server is moving",
        );
        return;
      }
      if (message.type === "environment-change") {
        notifyDaemonEnvironmentChange(deps, {
          hostId: args.hostId,
          environmentId: message.environmentId,
          change: message.change,
        });
        return;
      }
      if (message.type === "thread-storage-change") {
        notifyDaemonThreadStorageChange(deps, {
          hostId: args.hostId,
          threadId: message.threadId,
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
      if (message.type === "session.route") {
        recordSessionRoute(deps.db, {
          sessionId: args.sessionId,
          route: message.route,
        });
        deps.hub.notifyHost(args.hostId, ["host-connected"]);
        return;
      }
      if (message.type === "desktop-browser.changed") {
        const scope = {
          hostId: args.hostId,
          instanceId: message.instanceId,
          generation: message.generation,
          threadId: message.threadId,
        };
        const logDropped = (error: unknown) => {
          deps.logger.warn(
            {
              sessionId: args.sessionId,
              ...scope,
              ...runtimeErrorLogFields(deps.config, error),
            },
            "Dropping desktop browser snapshot the server cannot apply",
          );
        };
        void syncDesktopBrowserTabs(deps, scope, message.tabs).catch(
          logDropped,
        );
        return;
      }
      if (message.type === "plugin-host.worker-exited") {
        plugins?.handleHostWorkerExit({
          authenticatedHostId: args.hostId,
          pluginId: message.pluginId,
          generation: message.generation,
          reason: message.reason,
        });
        return;
      }
      if (message.type === "plugin-host.worker-output") {
        plugins?.handleHostWorkerOutput({
          authenticatedHostId: args.hostId,
          pluginId: message.pluginId,
          generation: message.generation,
          stream: message.stream,
          line: message.line,
        });
        return;
      }
      if (message.type === "environment.hook.progress") {
        reportEnvironmentHookProgress(deps, args.hostId, message);
        return;
      }
      if (message.type === "server_move.progress") {
        serverMove?.handleProgress(args.hostId, message);
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
        if (!acknowledged) {
          args.socket.send(HEARTBEAT_ACK_PAYLOAD);
        }
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

const DAEMON_LIVENESS_CHECK_INTERVAL_MS = HEARTBEAT_INTERVAL_MS;
const DAEMON_LIVENESS_MAX_QUIET_CHECKS = Math.ceil(
  LEASE_TIMEOUT_MS / DAEMON_LIVENESS_CHECK_INTERVAL_MS,
);

export function startDaemonLivenessChecks(
  deps: LoggedPendingInteractionWorkSessionDeps & Pick<AppDeps, "sharedPorts">,
): () => void {
  const interval = setInterval(() => {
    for (const sessionId of deps.hub.takeSilentDaemonSessionIds(
      DAEMON_LIVENESS_MAX_QUIET_CHECKS,
    )) {
      handleDaemonSessionSilent(deps, { sessionId });
    }
  }, DAEMON_LIVENESS_CHECK_INTERVAL_MS);
  interval.unref();
  return () => clearInterval(interval);
}

export function endDaemonSessionChannels(
  hub: Pick<
    AppDeps["hub"],
    | "getDaemonSessionIdForHost"
    | "getDaemonSessionSocket"
    | "listConnectedHostIds"
  >,
  code: number,
  reason: string,
): void {
  for (const hostId of hub.listConnectedHostIds()) {
    const sessionId = hub.getDaemonSessionIdForHost(hostId);
    const socket =
      sessionId === null ? null : hub.getDaemonSessionSocket(sessionId);
    if (socket instanceof DaemonChannel) {
      socket.close(code, reason);
    }
  }
}

export function onDaemonSocketClose(
  deps: LoggedPendingInteractionWorkSessionDeps & Pick<AppDeps, "sharedPorts">,
  sessionId: string,
): void {
  handleDaemonSocketClosed(deps, {
    sessionId,
  });
}

function onDaemonSocketDetached(
  deps: LoggedPendingInteractionWorkSessionDeps & Pick<AppDeps, "sharedPorts">,
  target: DaemonSocketSessionTarget,
): void {
  deps.logger.info(
    { ...target, reconnectGraceMs: HOST_RECONNECT_GRACE_MS },
    "Daemon WebSocket closed; holding its session for a reconnect",
  );
  deps.hub.scheduleDaemonDisconnect(
    target.sessionId,
    HOST_RECONNECT_GRACE_MS,
    () => {
      handleDaemonSessionResumeExpired(deps, { sessionId: target.sessionId });
    },
  );
}

function onDaemonSocketResumed(
  deps: Pick<AppDeps, "hub" | "logger">,
  target: DaemonSocketSessionTarget,
): void {
  deps.hub.cancelPendingDaemonDisconnect(target.sessionId);
  deps.hub.recordDaemonActivity(target.sessionId);
  deps.logger.info(target, "Daemon WebSocket resumed its session");
}
