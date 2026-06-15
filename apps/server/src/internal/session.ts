import {
  getLatestSessionForHost,
  listRetiredLoadedEnvironmentIdsOnHost,
  listTrackedThreadStorageTargetsOnHost,
  openSession,
  upsertHost,
} from "@bb/db";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  hostDaemonProjectAttachmentContentQuerySchema,
  hostDaemonSessionOpenRequestSchema,
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { HEARTBEAT_INTERVAL_MS, LEASE_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import { requirePublicThreadEnvironment } from "../services/lib/entity-lookup.js";
import {
  assertAuthenticatedHostMatches,
  getAuthenticatedDaemon,
} from "./auth.js";
import { requireAuthenticatedDaemonSession } from "./session-state.js";
import { readAttachment } from "../services/projects/attachments.js";
import { handleHostSessionOpened } from "./session-owner-side-effects.js";

export function registerInternalSessionRoutes(app: Hono, deps: AppDeps): void {
  const { get, post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  post(
    "/session/open",
    hostDaemonSessionOpenRequestSchema,
    async (context, payload) => {
      const daemon = getAuthenticatedDaemon(context);
      assertAuthenticatedHostMatches(daemon, {
        hostId: payload.hostId,
        hostType: payload.hostType,
      });

      if (payload.protocolVersion !== HOST_DAEMON_PROTOCOL_VERSION) {
        deps.logger.error(
          {
            hostId: daemon.hostId,
            daemonProtocolVersion: payload.protocolVersion,
            serverProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          },
          "Rejecting daemon session: protocol version mismatch. The server is likely running stale code — restart it (e.g. `pnpm dev:restart`).",
        );
        throw new ApiError(
          400,
          "protocol_version_mismatch",
          `Daemon protocol version ${payload.protocolVersion} does not match server protocol version ${HOST_DAEMON_PROTOCOL_VERSION}`,
        );
      }

      // The latest session regardless of status/lease: a crashed daemon's
      // session is closed the moment its socket drops, so requiring an active
      // previous session would skip the restarted-daemon reconciliation in
      // exactly the case it exists for.
      const previousSession = getLatestSessionForHost(deps.db, {
        hostId: daemon.hostId,
      });
      upsertHost(deps.db, deps.hub, {
        id: daemon.hostId,
        name: payload.hostName,
        type: daemon.hostType,
      });
      const session = openSession(deps.db, deps.hub, {
        hostId: daemon.hostId,
        instanceId: payload.instanceId,
        hostName: payload.hostName,
        hostType: daemon.hostType,
        dataDir: payload.dataDir,
        protocolVersion: payload.protocolVersion,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        leaseTimeoutMs: LEASE_TIMEOUT_MS,
      });

      await handleHostSessionOpened(deps, {
        activeThreads: payload.activeThreads,
        hostId: daemon.hostId,
        openedSession: session,
        previousSession,
      });

      const trackedThreadTargets = listTrackedThreadStorageTargetsOnHost(
        deps.db,
        { hostId: daemon.hostId },
      ).map((target) => ({
        environmentId: target.environmentId,
        threadId: target.threadId,
      }));
      const retiredEnvironmentIds = listRetiredLoadedEnvironmentIdsOnHost(
        deps.db,
        {
          hostId: daemon.hostId,
          environmentIds: (payload.loadedEnvironments ?? []).map(
            (environment) => environment.environmentId,
          ),
        },
      );

      return context.json(
        {
          sessionId: session.id,
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
          leaseTimeoutMs: LEASE_TIMEOUT_MS,
          trackedThreadTargets,
          retiredEnvironmentIds,
        },
        201,
      );
    },
  );

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
      // Attachment paths are project-scoped upload tokens, so cross-check
      // projectId before reading bytes even though threadId identifies a thread.
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

      const attachment = await readAttachment(
        deps.config.dataDir,
        query.projectId,
        query.path,
      );
      return new Response(new Uint8Array(attachment.content), {
        status: 200,
        headers: {
          "content-type": attachment.mimeType ?? "application/octet-stream",
        },
      });
    },
  );
}
