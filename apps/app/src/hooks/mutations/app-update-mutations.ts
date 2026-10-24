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
const SCHEDULE_APP_UPDATE_ERROR_MESSAGE = "Couldn't schedule the bb update.";
const CANCEL_SCHEDULED_APP_UPDATE_ERROR_MESSAGE =
  "Couldn't cancel the scheduled bb update.";

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

export function useScheduleAppUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { showErrorToast: false },
    mutationFn: () => sdk.system.experimental_scheduleAppUpdate(),
    onError: (error) => {
      showMutationErrorToast({
        error,
        fallbackMessage: SCHEDULE_APP_UPDATE_ERROR_MESSAGE,
      });
    },
    onSuccess: (status) => {
      hydrateAppUpdateStatus({ queryClient, status });
    },
  });
}

export function useCancelScheduledAppUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { showErrorToast: false },
    mutationFn: () => sdk.system.experimental_cancelScheduledAppUpdate(),
    onError: (error) => {
      showMutationErrorToast({
        error,
        fallbackMessage: CANCEL_SCHEDULED_APP_UPDATE_ERROR_MESSAGE,
      });
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
