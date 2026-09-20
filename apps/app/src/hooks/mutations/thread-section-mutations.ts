import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateThreadSectionRequest,
  DeleteThreadSectionRequest,
  UpdateThreadSectionRequest,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { sidebarNavigationQueryKey } from "../queries/query-keys";
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
      queryClient.setQueryData<SidebarBootstrapResponse>(
        sidebarNavigationQueryKey(),
        (navigation) =>
          navigation
            ? {
                ...navigation,
                sections: navigation.sections.map((current) =>
                  current.id === section.id
                    ? { ...current, name: section.name }
                    : current,
                ),
              }
            : navigation,
      );
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
