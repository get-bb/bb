import type {
  JsonValue,
  PendingInteraction,
  PendingInteractionResolution,
} from "@bb/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  applyInteractionResult,
  invalidateInteractionResolution,
} from "./interaction-cache";

/**
 * Pending-interaction mutations (mirrors
 * apps/app/src/hooks/mutations/thread-interaction-mutations.ts and the
 * respond/cancel calls of PluginPendingInteractionComposer.tsx). Every one
 * writes the returned interaction into the pending list and then lets the
 * server settle the thread. Errors render inline in the banner
 * (`showErrorToast: false`).
 */

export interface ResolvePendingInteractionRequest {
  threadId: string;
  interactionId: string;
  resolution: PendingInteractionResolution;
}

export interface RespondPluginInteractionRequest {
  threadId: string;
  interactionId: string;
  value: JsonValue;
}

export interface CancelPluginInteractionRequest {
  threadId: string;
  interactionId: string;
}

/**
 * `POST /threads/:id/interactions/:iid/resolve`: approvals
 * (`allow_once` / `allow_for_session` with `grantedPermissions`, `deny`) and
 * user questions (`user_answer`).
 */
export function useResolvePendingInteraction() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    PendingInteraction,
    Error,
    ResolvePendingInteractionRequest
  >({
    meta: {
      errorMessage: "Failed to resolve pending interaction.",
      showErrorToast: false,
    },
    mutationFn: ({ threadId, interactionId, resolution }) =>
      sdk.threads.interactions.resolve({ threadId, interactionId, resolution }),
    onSuccess: (interaction, { threadId }) => {
      applyInteractionResult(queryClient, interaction);
      invalidateInteractionResolution(queryClient, threadId);
    },
  });
}

/** `POST /threads/:id/interactions/:iid/respond` (plugin forms; ≤ 64 KiB). */
export function useRespondPluginInteraction() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    PendingInteraction,
    Error,
    RespondPluginInteractionRequest
  >({
    meta: {
      errorMessage: "Failed to submit the plugin form.",
      showErrorToast: false,
    },
    mutationFn: ({ threadId, interactionId, value }) =>
      sdk.threads.interactions.respond({ threadId, interactionId, value }),
    onSuccess: (interaction, { threadId }) => {
      applyInteractionResult(queryClient, interaction);
      invalidateInteractionResolution(queryClient, threadId);
    },
  });
}

/** `POST /threads/:id/interactions/:iid/cancel` (plugin interactions only). */
export function useCancelPluginInteraction() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<PendingInteraction, Error, CancelPluginInteractionRequest>(
    {
      meta: {
        errorMessage: "Failed to cancel the plugin request.",
        showErrorToast: false,
      },
      mutationFn: ({ threadId, interactionId }) =>
        sdk.threads.interactions.cancel({ threadId, interactionId }),
      onSuccess: (interaction, { threadId }) => {
        applyInteractionResult(queryClient, interaction);
        invalidateInteractionResolution(queryClient, threadId);
      },
    },
  );
}
