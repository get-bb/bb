import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  SystemAppUpdateAcknowledgeRequest,
  SystemAppUpdateApplyRequest,
} from "@bb/server-contract";
import { runningThreadCountFromError } from "@/components/app-update/app-update-presentation";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import { sdk } from "@/lib/sdk";
import { hydrateAppUpdateStatus } from "../cache-owners/app-update-cache-owner";

const APPLY_APP_UPDATE_ERROR_MESSAGE = "Couldn't start the bb update.";

export function useApplyAppUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { showErrorToast: false },
    mutationFn: (args: SystemAppUpdateApplyRequest) =>
      sdk.system.applyAppUpdate(args),
    onError: (error) => {
      if (runningThreadCountFromError(error) === null) {
        showMutationErrorToast({
          error,
          fallbackMessage: APPLY_APP_UPDATE_ERROR_MESSAGE,
        });
      }
    },
    onSuccess: (status) => {
      hydrateAppUpdateStatus({ queryClient, status });
    },
  });
}

export function useAcknowledgeAppUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { showErrorToast: false },
    mutationFn: (args: SystemAppUpdateAcknowledgeRequest) =>
      sdk.system.acknowledgeAppUpdate(args),
    onSuccess: (status) => {
      hydrateAppUpdateStatus({ queryClient, status });
    },
  });
}
