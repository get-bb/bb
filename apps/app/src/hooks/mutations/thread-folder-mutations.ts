import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateThreadFolderRequest,
  DeleteThreadFolderRequest,
  UpdateThreadFolderRequest,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  invalidateProjectListQueries,
  invalidateThreadListQueries,
  removeThreadFolderArchivedListQuery,
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
      errorMessage: "Failed to create folder.",
      showErrorToast: false,
    },
    mutationFn: (request: CreateThreadFolderRequest) =>
      api.createThreadFolder(request),
    onSuccess: () => {
      invalidateThreadFolderQueries(queryClient);
    },
  });
}

export function useUpdateThreadFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to rename folder.",
      showErrorToast: false,
    },
    mutationFn: (request: UpdateThreadFolderRequest) =>
      api.updateThreadFolder(request),
    onSuccess: () => {
      invalidateThreadFolderQueries(queryClient);
    },
  });
}

export function useDeleteThreadFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to remove folder.",
    },
    mutationFn: (request: DeleteThreadFolderRequest) =>
      api.deleteThreadFolder(request),
    onSuccess: (_result, request) => {
      removeThreadFolderArchivedListQuery({
        folderId: request.id,
        queryClient,
      });
      invalidateThreadFolderQueries(queryClient);
    },
  });
}
