import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AddAppSourceRequest } from "@bb/server-contract";
import * as api from "@/lib/api";
import { invalidateAppSourceQueries } from "../cache-owners/mutation-cache-effects";

interface SyncAppSourceMutationRequest {
  name: string;
  /** Discards local edits to diverged apps. */
  force: boolean;
}

export function useAddAppSource() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to add app source.",
    },
    mutationFn: (request: AddAppSourceRequest) => api.addAppSource(request),
    onSuccess: () => {
      invalidateAppSourceQueries({ queryClient });
    },
  });
}

export function useSyncAppSource() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to sync app source.",
    },
    mutationFn: (request: SyncAppSourceMutationRequest) =>
      api.syncAppSource(request.name, request.force),
    onSuccess: () => {
      invalidateAppSourceQueries({ queryClient });
    },
  });
}

export function useRemoveAppSource() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to remove app source.",
    },
    mutationFn: (name: string) => api.removeAppSource(name),
    onSuccess: () => {
      invalidateAppSourceQueries({ queryClient });
    },
  });
}
