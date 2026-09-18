import type {
  Thread,
  PendingInteraction,
  UserQuestionPendingInteraction,
  UserQuestionPendingInteractionResolution,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requireThreadCommandEnvironment } from "../threads/thread-command-environment.js";
import { sendThreadMessage } from "../threads/thread-send.js";
import {
  pendingInteractionResolutionEquals,
  validatePendingInteractionResolution,
} from "./pending-interaction-validation.js";

export async function resolveAsyncUserQuestion(
  deps: AppDeps,
  args: {
    thread: Thread;
    interaction: UserQuestionPendingInteraction;
    resolution: UserQuestionPendingInteractionResolution;
  },
): Promise<PendingInteraction> {
  const { interaction, resolution } = args;
  if (
    interaction.status === "resolved" &&
    pendingInteractionResolutionEquals(interaction.resolution, resolution)
  )
    return interaction;
  if (interaction.status !== "pending")
    throw new ApiError(409, "invalid_request", "Question is no longer pending");
  validatePendingInteractionResolution(interaction, resolution);
  const text = interaction.payload.questions
    .map((question) => {
      const answer = resolution.answers[question.id];
      return `${question.prompt}\n${answer ? [...answer.selected, ...(answer.freeText ? [answer.freeText] : [])].join("\n") : "No answer provided"}`;
    })
    .join("\n\n");
  const environment = await requireThreadCommandEnvironment(deps, {
    thread: args.thread,
  });
  await sendThreadMessage(deps, {
    thread: args.thread,
    environment,
    payload: { input: [{ type: "text", text, mentions: [] }], mode: "auto" },
    trigger: "user",
    beforeAppendInTransaction: ({ tx }) => {
      const current = deps.pendingInteractions.getThreadInteraction({
        threadId: interaction.threadId,
        interactionId: interaction.id,
      });
      if (current.status !== "pending")
        throw new ApiError(
          409,
          "invalid_request",
          "Question is no longer pending",
        );
      const completed =
        deps.pendingInteractions.completeResolvingInteractionInTransaction(
          { db: tx, hub: deps.hub },
          { interactionId: interaction.id, resolution },
        );
      if (!completed)
        throw new ApiError(
          409,
          "invalid_request",
          "Question is no longer pending",
        );
    },
  });
  return deps.pendingInteractions.getThreadInteraction({
    threadId: interaction.threadId,
    interactionId: interaction.id,
  });
}
