import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateThreadSectionRequest,
  DeleteThreadSectionRequest,
  UpdateThreadSectionRequest,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { applyThreadSectionRenameResult } from "../cache-owners/project-cache-owner";
import {
  invalidateProjectListQueries,
  invalidateThreadListQueries,
} from "../cache-owners/mutation-cache-effects";

function invalidateThreadSectionQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  invalidateProjectListQueries({ queryClient });
  invalidateThreadListQueries({ queryClient });
}

export function useCreateThreadSection() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to create section.",
      showErrorToast: false,
    },
    mutationFn: (request: CreateThreadSectionRequest) =>
      sdk.threadSections.create(request),
    onSuccess: () => {
      invalidateThreadSectionQueries(queryClient);
    },
  });
}

export function useUpdateThreadSection() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to rename section.",
      showErrorToast: false,
    },
    mutationFn: (request: UpdateThreadSectionRequest) =>
      sdk.threadSections.update(request),
    onSuccess: (section) => {
      applyThreadSectionRenameResult({ section, queryClient });
      invalidateThreadSectionQueries(queryClient);
    },
  });
}

export function useDeleteThreadSection() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to remove section.",
    },
    mutationFn: (request: DeleteThreadSectionRequest) =>
      sdk.threadSections.delete(request),
    onSuccess: () => {
      invalidateThreadSectionQueries(queryClient);
    },
  });
}
