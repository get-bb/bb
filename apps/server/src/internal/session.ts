import {
  getAppSettings,
  getExperiments,
  getLatestSessionForHost,
  getOrCreateServerId,
  getHost,
  listRetiredLoadedEnvironmentIdsOnHost,
  openSession,
  recordSessionRoute,
  upsertHost,
  updateHost,
} from "@bb/db";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  hostDaemonProjectAttachmentContentQuerySchema,
  isCompatibleHostDaemonProtocolVersion,
  hostDaemonSessionOpenRequestSchema,
  SERVER_MOVED_ERROR_CODE,
  typedRoutes,
  type HostDaemonInternalSchema,
  type ServerMovedErrorDetails,
} from "@bb/host-daemon-contract";
import { writeAgentCpuPriority } from "@bb/process-utils";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../types.js";
import {
  HEARTBEAT_INTERVAL_MS,
  HOST_RECONNECT_GRACE_MS,
  LEASE_TIMEOUT_MS,
} from "../constants.js";
import { ApiError } from "../errors.js";
import { requirePublicThreadEnvironment } from "../services/lib/entity-lookup.js";
import {
  assertAuthenticatedHostMatches,
  getAuthenticatedDaemon,
} from "./auth.js";
import { requireAuthenticatedDaemonSession } from "./session-state.js";
import { createAttachmentContentResponse } from "../services/projects/attachments.js";
import { handleHostSessionOpened } from "./session-owner-side-effects.js";
import { resolveReportedConnectMachineId } from "./hosts.js";
import {
  getGateAuthKind,
  getTrustedRemoteAddress,
} from "../request-context.js";
import { isLoopbackAddress } from "@bb/config/loopback";
import { isServerMachineHost } from "../services/hosts/primary-host.js";
import {
  routesForHost,
  serverAccessProviderForKind,
} from "../services/machines/server-access.js";
import type { HostDaemonServerRoutes } from "@bb/host-daemon-contract";
import type { PluginService } from "../services/plugins/plugin-service.js";
import { HostEnvironmentSync } from "../services/hosts/host-environment-sync.js";
import { requestHostDerivedStateRefresh } from "../services/hosts/host-derived-state.js";

const sessionOpenCompatibilitySchema = z
  .object({
    hostId: z.string().min(1),
    protocolVersion: z.number().int().positive(),
  })
  .passthrough();

export interface ServerMoveSessionGate {
  movedTo(): ServerMovedErrorDetails | null;
  pendingMoveId(): string | null;
  sessionOpened(hostId: string): Promise<void>;
}

function invalidSessionOpenRequest(message: string): ApiError {
  return new ApiError(400, "invalid_request", message);
}

function sessionOpenValidationMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue?.code === "invalid_type" && issue.input === undefined) {
    return "Required";
  }
  return issue?.message ?? "Invalid request";
}

const SESSION_OPEN_ROUTE_DEADLINE_MS = 3_000;
const ROUTE_ACQUISITION_TIMEOUT_MS = 60_000;

export function registerInternalSessionRoutes(
  app: Hono,
  deps: AppDeps,
  plugins: PluginService,
  serverMove: ServerMoveSessionGate,
): void {
  const machineEnvironment = new HostEnvironmentSync(deps, (hostId) =>
    requestHostDerivedStateRefresh(deps, hostId),
  );
  let launcherAgentCpuPriority: boolean | null = null;
  const syncLauncherAgentCpuPriority = (): void => {
    const { agentCpuPriority } = getExperiments(deps.db);
    if (agentCpuPriority === launcherAgentCpuPriority) return;
    writeAgentCpuPriority(deps.config.dataDir, agentCpuPriority);
    launcherAgentCpuPriority = agentCpuPriority;
  };
  syncLauncherAgentCpuPriority();
  const sentRoutes = new Map<string, string>();
  const pushRoutes = (hostId: string, serverRoutes: HostDaemonServerRoutes) => {
    const signature = JSON.stringify(serverRoutes);
    if (sentRoutes.get(hostId) === signature) return;
    if (!deps.hub.hasDaemonForHost(hostId)) return;
    sentRoutes.set(hostId, signature);
    deps.hub.sendDaemonMessage(hostId, {
      type: "server-routes.replace",
      serverRoutes,
    });
  };
  const hostServerRoutes = async (
    hostId: string,
    providerDeadlineMs?: number,
  ): Promise<HostDaemonServerRoutes> => {
    if (isServerMachineHost(deps, hostId)) {
      return { serverId: getOrCreateServerId(deps.db), routes: [] };
    }
    return routesForHost(deps, {
      hostId,
      signal: AbortSignal.timeout(ROUTE_ACQUISITION_TIMEOUT_MS),
      ...(providerDeadlineMs === undefined
        ? {}
        : {
            providerDeadlineMs,
            onLateRoutes: (routes: HostDaemonServerRoutes) =>
              pushRoutes(hostId, routes),
          }),
    });
  };
  deps.hub.onChangedMessage((message) => {
    if (
      message.entity === "system" &&
      message.changes.includes("config-changed")
    ) {
      for (const hostId of deps.hub.listConnectedHostIds()) {
        void hostServerRoutes(hostId).then(
          (routes) => pushRoutes(hostId, routes),
          (error: unknown) =>
            deps.logger.warn(
              { hostId, error: error instanceof Error ? error.message : error },
              "Could not refresh server routes for machine",
            ),
        );
      }
    }
  });
  deps.hub.onChangedMessage((message) => {
    const configChanged =
      message.entity === "system" && message.changes.includes("config-changed");
    if (configChanged) syncLauncherAgentCpuPriority();
    const hostIds = configChanged
      ? deps.hub.listConnectedHostIds()
      : message.entity === "host" &&
          message.id &&
          message.changes.includes("host-connected")
        ? [message.id]
        : [];
    if (hostIds.length === 0) return;
    const { idleProviderSessionTimeoutMinutes } = getAppSettings(deps.db);
    const { agentCpuPriority } = getExperiments(deps.db);
    for (const hostId of hostIds) {
      deps.hub.sendDaemonMessage(hostId, {
        type: "provider-session-policy.replace",
        idleProviderSessionTimeoutMinutes,
        agentCpuPriority,
      });
    }
  });
  const { get } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  app.post("/session/open", async (context) => {
    const pendingMoveId = serverMove.pendingMoveId();
    if (pendingMoveId !== null) {
      throw new ApiError(
        503,
        "server_move_pending",
        "This server is finishing a move and doesn't accept machines yet",
        { details: { moveId: pendingMoveId }, retryable: true },
      );
    }
    const movedTo = serverMove.movedTo();
    if (movedTo !== null) {
      throw new ApiError(
        410,
        SERVER_MOVED_ERROR_CODE,
        `This bb server moved to ${movedTo.toHostName} (${movedTo.serverUrl})`,
        { details: movedTo, retryable: false },
      );
    }
    const input: unknown = await context.req.json().catch(() => {
      throw invalidSessionOpenRequest("Invalid JSON request body");
    });
    const compatibility = sessionOpenCompatibilitySchema.safeParse(input);
    if (!compatibility.success) {
      throw invalidSessionOpenRequest(
        sessionOpenValidationMessage(compatibility.error),
      );
    }
    const daemon = getAuthenticatedDaemon(context);
    assertAuthenticatedHostMatches(daemon, {
      hostId: compatibility.data.hostId,
    });

    if (
      !isCompatibleHostDaemonProtocolVersion(compatibility.data.protocolVersion)
    ) {
      updateHost(deps.db, deps.hub, daemon.hostId, {
        lastRejectedProtocolVersion: compatibility.data.protocolVersion,
      });
      const retryUpdate = deps.hub.takeHostProtocolUpdateRetry(daemon.hostId);
      deps.hub.notifyHost(daemon.hostId, ["host-disconnected"]);
      deps.logger.error(
        {
          hostId: daemon.hostId,
          daemonProtocolVersion: compatibility.data.protocolVersion,
          serverProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        },
        "Rejecting daemon session: protocol version mismatch. An older auto-update-enabled daemon will install this server's bb-app; a newer daemon requires the server to be updated.",
      );
      throw new ApiError(
        400,
        "protocol_version_mismatch",
        `Daemon protocol version ${compatibility.data.protocolVersion} does not match server protocol version ${HOST_DAEMON_PROTOCOL_VERSION}`,
        {
          details: {
            retryUpdate,
            serverProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          },
        },
      );
    }

    const parsed = hostDaemonSessionOpenRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw invalidSessionOpenRequest(
        sessionOpenValidationMessage(parsed.error),
      );
    }
    const payload = parsed.data;

    const host = getHost(deps.db, daemon.hostId);
    if (host?.phase === "suspending" || host?.phase === "suspended") {
      throw new ApiError(
        409,
        "machine_suspended",
        "Machine daemon sessions are disabled while the machine is suspending or suspended",
      );
    }

    const previousSession = getLatestSessionForHost(deps.db, {
      hostId: daemon.hostId,
    });
    const connectMachineId = resolveReportedConnectMachineId(context);
    upsertHost(deps.db, deps.hub, {
      ...(connectMachineId !== undefined ? { connectMachineId } : {}),
      id: daemon.hostId,
      name: payload.hostName,
    });
    updateHost(deps.db, deps.hub, daemon.hostId, {
      lastRejectedProtocolVersion: null,
    });
    const session = openSession(deps.db, {
      hostId: daemon.hostId,
      instanceId: payload.instanceId,
      hostName: payload.hostName,
      dataDir: payload.dataDir,
      protocolVersion: payload.protocolVersion,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      leaseTimeoutMs: LEASE_TIMEOUT_MS,
    });
    recordSessionRoute(deps.db, {
      sessionId: session.id,
      route:
        payload.route ??
        (getGateAuthKind(context) === "machine"
          ? serverAccessProviderForKind(deps, "relay")
          : (() => {
              const address = getTrustedRemoteAddress(context);
              return address !== undefined && !isLoopbackAddress(address)
                ? serverAccessProviderForKind(deps, "local-network")
                : null;
            })()),
    });
    deps.hub.recordDaemonSessionPlatform(session.id, payload.platform);
    deps.hub.recordDaemonSessionLocalApiPort(session.id, payload.localApiPort);
    deps.sharedPorts.recordHostConnectCapability({
      hostId: daemon.hostId,
      sessionId: session.id,
      hasMachineCredential: payload.hasMachineCredential,
    });

    const { endedInteractiveRequests } = await handleHostSessionOpened(deps, {
      activeThreads: payload.activeThreads,
      openThreadWork: payload.openThreadWork,
      hostId: daemon.hostId,
      turnCommandThreadIds: payload.turnCommandThreadIds,
      undeliveredEventThreadIds: payload.undeliveredEventThreadIds,
      openedSession: session,
      previousSession,
    });
    await serverMove.sessionOpened(daemon.hostId);

    const retiredEnvironmentIds = listRetiredLoadedEnvironmentIdsOnHost(
      deps.db,
      {
        hostId: daemon.hostId,
        environmentIds: (payload.loadedEnvironments ?? []).map(
          (environment) => environment.environmentId,
        ),
      },
    );

    const serverRoutes = await hostServerRoutes(
      daemon.hostId,
      SESSION_OPEN_ROUTE_DEADLINE_MS,
    );
    sentRoutes.set(daemon.hostId, JSON.stringify(serverRoutes));

    return context.json(
      {
        sessionId: session.id,
        serverRoutes,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        leaseTimeoutMs: LEASE_TIMEOUT_MS,
        reconnectGraceMs: getExperiments(deps.db).resumeDaemonSessions
          ? HOST_RECONNECT_GRACE_MS
          : 0,
        watchSet: deps.watchInterests.reconcileWatchSetForHost(daemon.hostId),
        connectShares: deps.sharedPorts.reconcileSharedPortsForHost(
          daemon.hostId,
        ),
        pluginHostGenerations: plugins.listHostArtifactGenerations(),
        retiredEnvironmentIds,
        endedInteractiveRequests,
        machineEnvironment: await machineEnvironment.snapshot(daemon.hostId),
        idleProviderSessionTimeoutMinutes: getAppSettings(deps.db)
          .idleProviderSessionTimeoutMinutes,
        agentCpuPriority: getExperiments(deps.db).agentCpuPriority,
      },
      201,
    );
  });

  get(
    "/session/project-attachment-content",
    hostDaemonProjectAttachmentContentQuerySchema,
    async (context, query) => {
      const session = requireAuthenticatedDaemonSession({
        context,
        db: deps.db,
        sessionId: query.sessionId,
      });

      const { environment, thread } = requirePublicThreadEnvironment(
        deps.db,
        query.threadId,
      );
      if (thread.projectId !== query.projectId) {
        throw new ApiError(
          403,
          "forbidden",
          "Thread does not belong to project",
        );
      }
      if (environment.hostId !== session.hostId) {
        throw new ApiError(
          403,
          "forbidden",
          "Host is not assigned to thread environment",
        );
      }

      return createAttachmentContentResponse({
        dataDir: deps.config.dataDir,
        projectId: query.projectId,
        path: query.path,
        request: context.req.raw,
      });
    },
  );
}
