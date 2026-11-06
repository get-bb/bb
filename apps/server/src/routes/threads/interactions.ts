import { PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES } from "@bb/domain";
import { publicApiRoutes } from "@bb/server-contract";
import { z } from "zod";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import type { OperationRoutes } from "../../kernel/http-door.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";

const pendingInteractionIdSchema = z
  .string()
  .regex(/^pint_[23456789abcdefghijkmnpqrstuvwxyz]{10}$/);

function parsePendingInteractionId(rawInteractionId: string): string {
  const parsedInteractionId =
    pendingInteractionIdSchema.safeParse(rawInteractionId);
  if (!parsedInteractionId.success) {
    throw new ApiError(
      400,
      "invalid_request",
      "Invalid pending interaction id",
    );
  }
  return parsedInteractionId.data;
}

export function registerThreadInteractionRoutes(
  operations: OperationRoutes,
  deps: AppDeps,
): void {
  const routes = publicApiRoutes.threads;

  operations.implement(routes.interactions, ({ id }) => {
    const thread = requirePublicThread(deps.db, id);
    return deps.pendingInteractions.listPendingThreadInteractions(thread.id);
  });

  operations.implement(routes.interaction, ({ id, interactionId }) => {
    const thread = requirePublicThread(deps.db, id);
    return deps.pendingInteractions.getThreadInteraction({
      threadId: thread.id,
      interactionId: parsePendingInteractionId(interactionId),
    });
  });

  operations.implement(
    routes.resolveInteraction,
    ({ id, interactionId, ...payload }) => {
      const thread = requirePublicThread(deps.db, id);
      return deps.pendingInteractions.resolvePendingInteraction({
        threadId: thread.id,
        interactionId: parsePendingInteractionId(interactionId),
        resolution: payload,
      });
    },
  );

  operations.implement(
    routes.respondToInteraction,
    async ({ id, interactionId, ...payload }) => {
      const thread = requirePublicThread(deps.db, id);
      if (
        Buffer.byteLength(JSON.stringify(payload.value), "utf8") >
        PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES
      ) {
        throw new ApiError(
          413,
          "invalid_request",
          "Interaction response exceeds 64 KiB",
        );
      }
      return deps.pendingInteractions.respondToInteraction({
        threadId: thread.id,
        interactionId: parsePendingInteractionId(interactionId),
        value: payload.value,
      });
    },
  );

  operations.implement(routes.cancelInteraction, ({ id, interactionId }) => {
    const thread = requirePublicThread(deps.db, id);
    return deps.pendingInteractions.cancelPluginInteraction({
      threadId: thread.id,
      interactionId: parsePendingInteractionId(interactionId),
      reason: "user",
    });
  });
}
