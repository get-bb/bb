import {
  hostDaemonInteractiveInterruptRequestSchema,
  hostDaemonInteractiveRequestSchema,
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import { hasStoredTurnStarted } from "@bb/db";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import {
  requireThreadEnvironment,
  requireThreadEnvironmentAllowingDestroyed,
} from "../services/lib/entity-lookup.js";
import { requireAuthenticatedDaemonSession } from "./session-state.js";

export function registerInternalInteractiveRequestRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  const { post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  post(
    "/session/interactive-request",
    hostDaemonInteractiveRequestSchema,
    async (context, payload) => {
      const session = requireAuthenticatedDaemonSession({
        context,
        db: deps.db,
        sessionId: payload.sessionId,
      });

      const { environment } = requireThreadEnvironment(
        deps.db,
        payload.interaction.threadId,
      );
      if (environment.hostId !== session.hostId) {
        throw new ApiError(
          403,
          "invalid_request",
          "Thread does not belong to the session host",
        );
      }

      const turnStarted = hasStoredTurnStarted(deps.db, {
        threadId: payload.interaction.threadId,
        turnId: payload.interaction.turnId,
      });
      if (!turnStarted) {
        deps.logger.warn(
          {
            providerId: payload.interaction.providerId,
            providerRequestId: payload.interaction.providerRequestId,
            providerThreadId: payload.interaction.providerThreadId,
            threadId: payload.interaction.threadId,
            turnId: payload.interaction.turnId,
          },
          "interactive request arrived before turn/started; asking daemon to retry",
        );
        throw new ApiError(
          503,
          "turn_start_not_ready",
          "Turn start has not been stored yet; retry interactive request registration",
          true,
        );
      }

      const registered = deps.pendingInteractions.registerPendingInteraction({
        interaction: payload.interaction,
      });
      if (registered.outcome === "rejected") {
        return context.json({
          outcome: "rejected",
          reason: registered.reason,
        });
      }
      return context.json({
        outcome: registered.outcome,
        interactionId: registered.interaction.id,
        status: registered.interaction.status,
      });
    },
  );

  post(
    "/session/interactive-request/interrupt",
    hostDaemonInteractiveInterruptRequestSchema,
    (context, payload) => {
      const session = requireAuthenticatedDaemonSession({
        context,
        db: deps.db,
        sessionId: payload.sessionId,
      });

      const interruptibleThreadIds: string[] = [];
      for (const threadId of payload.threadIds) {
        let environmentHostId: string;
        try {
          const { environment } = requireThreadEnvironmentAllowingDestroyed(
            deps.db,
            threadId,
          );
          environmentHostId = environment.hostId;
        } catch (error) {
          if (
            error instanceof ApiError &&
            (error.status === 404 ||
              error.body.code === "thread_environment_unavailable")
          ) {
            continue;
          }
          throw error;
        }
        if (environmentHostId !== session.hostId) {
          throw new ApiError(
            403,
            "invalid_request",
            "Thread does not belong to the session host",
          );
        }
        interruptibleThreadIds.push(threadId);
      }

      const interrupted =
        deps.pendingInteractions.interruptPendingInteractionsForThreads({
          providerId: payload.providerId,
          threadIds: interruptibleThreadIds,
          reason: payload.reason,
        });

      return context.json({
        ok: true,
        interactionIds: interrupted.map((interaction) => interaction.id),
      });
    },
  );
}
