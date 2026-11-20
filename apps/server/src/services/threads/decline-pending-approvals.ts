import {
  isApprovalPendingInteractionPayload,
  type PendingInteraction,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";

type DeclineDeps = Pick<AppDeps, "logger" | "pendingInteractions">;

function blockingInteractions(
  deps: DeclineDeps,
  threadId: string,
): PendingInteraction[] {
  return deps.pendingInteractions
    .listPendingThreadInteractions(threadId)
    .filter(
      (interaction) =>
        interaction.turnId !== null && interaction.status === "pending",
    );
}

export function assertPendingApprovalsCanBeDeclined(
  deps: DeclineDeps,
  threadId: string,
): void {
  for (const interaction of blockingInteractions(deps, threadId)) {
    if (!isApprovalPendingInteractionPayload(interaction.payload)) {
      throw new ApiError(
        409,
        "awaiting_user_interaction",
        "Thread is waiting on a question or a plugin form, not only on approvals. Answer it before sending another prompt.",
      );
    }
    if (!interaction.payload.availableDecisions.includes("deny")) {
      throw new ApiError(
        409,
        "awaiting_user_interaction",
        "Thread is waiting on an approval that offers no deny decision. Answer it before sending another prompt.",
      );
    }
  }
}

export function declinePendingApprovals(
  deps: DeclineDeps,
  threadId: string,
): void {
  for (const interaction of blockingInteractions(deps, threadId)) {
    try {
      deps.pendingInteractions.resolvePendingInteraction({
        threadId,
        interactionId: interaction.id,
        resolution: { decision: "deny" },
      });
    } catch (error) {
      deps.logger.warn(
        { err: error, threadId, interactionId: interaction.id },
        "Could not decline a pending approval for a queued redirect",
      );
    }
  }
}
