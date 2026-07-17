import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateThreadFolderRequest,
  DeleteThreadFolderRequest,
  UpdateThreadFolderRequest,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import {
  invalidateProjectListQueries,
  invalidateThreadListQueries,
} from "../cache-owners/mutation-cache-effects";

function invalidateThreadFolderQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  invalidateProjectListQueries({ queryClient });
  invalidateThreadListQueries({ queryClient });
}

export function useCreateThreadFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to create section.",
      showErrorToast: false,
    },
    mutationFn: (request: CreateThreadFolderRequest) =>
      sdk.threadFolders.create(request),
    onSuccess: () => {
      invalidateThreadFolderQueries(queryClient);
    },
  });
}

export function useUpdateThreadFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to rename section.",
      showErrorToast: false,
    },
    mutationFn: (request: UpdateThreadFolderRequest) =>
      sdk.threadFolders.update(request),
    onSuccess: () => {
      invalidateThreadFolderQueries(queryClient);
    },
  });
}

export function useDeleteThreadFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to remove section.",
    },
    mutationFn: (request: DeleteThreadFolderRequest) =>
      sdk.threadFolders.delete(request),
    onSuccess: () => {
      invalidateThreadFolderQueries(queryClient);
    },
  });
}
