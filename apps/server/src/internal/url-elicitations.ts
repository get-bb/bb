import {
  hostDaemonUrlElicitationRequestSchema,
  hostDaemonUrlElicitationCancelRequestSchema,
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import { requireThreadEnvironment } from "../services/lib/entity-lookup.js";
import type { AppDeps } from "../types.js";
import { requireAuthenticatedDaemonSession } from "./session-state.js";

export function registerInternalUrlElicitationRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  const { post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });

  post(
    "/session/url-elicitation",
    hostDaemonUrlElicitationRequestSchema,
    async (context, payload) => {
      const session = requireAuthenticatedDaemonSession({
        context,
        db: deps.db,
        sessionId: payload.sessionId,
      });
      if (payload.threadId !== undefined) {
        const { environment } = requireThreadEnvironment(
          deps.db,
          payload.threadId,
        );
        if (environment.hostId !== session.hostId) {
          throw new ApiError(
            403,
            "invalid_request",
            "Thread does not belong to the session host",
          );
        }
      }

      const pending = deps.hub.requestUrlElicitation(payload);
      const cancel = () => pending.cancel();
      context.req.raw.signal.addEventListener("abort", cancel, { once: true });
      try {
        return context.json(await pending.promise);
      } finally {
        context.req.raw.signal.removeEventListener("abort", cancel);
        pending.cancel();
      }
    },
  );

  post(
    "/session/url-elicitation/cancel",
    hostDaemonUrlElicitationCancelRequestSchema,
    async (context, payload) => {
      requireAuthenticatedDaemonSession({
        context,
        db: deps.db,
        sessionId: payload.sessionId,
      });
      deps.hub.cancelUrlElicitation(payload.elicitationId, payload.sessionId);
      return context.json({ ok: true as const });
    },
  );
}
