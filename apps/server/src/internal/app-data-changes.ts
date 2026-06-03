import {
  hostDaemonAppDataChangeRequestSchema,
  hostDaemonAppDataResyncRequestSchema,
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import {
  requireAuthenticatedDaemonSession,
} from "./session-state.js";

export function registerInternalAppDataChangeRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  const { post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  post(
    "/session/app-data-change",
    hostDaemonAppDataChangeRequestSchema,
    async (context, payload) => {
      requireAuthenticatedDaemonSession({
        context,
        db: deps.db,
        sessionId: payload.sessionId,
      });

      deps.hub.notifyAppData({
        type: "app-data.changed",
        applicationId: payload.applicationId,
        path: payload.path,
        value: payload.value,
        deleted: payload.deleted,
        version: payload.version,
      });
      return context.json({ ok: true });
    },
  );

  post(
    "/session/app-data-resync",
    hostDaemonAppDataResyncRequestSchema,
    async (context, payload) => {
      requireAuthenticatedDaemonSession({
        context,
        db: deps.db,
        sessionId: payload.sessionId,
      });

      deps.hub.notifyAppData({
        type: "app-data.resync",
        applicationId: payload.applicationId,
      });
      return context.json({ ok: true });
    },
  );
}
