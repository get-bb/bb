import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Environment } from "@bb/domain";
import type {
  EnvironmentArchiveThreadsResponse,
  EnvironmentActionResponse,
  UpdateEnvironmentRequest,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import type { RequestEnvironmentActionMutationRequest } from "./mutation-request-types";
import {
  invalidateEnvironmentActionQueries,
} from "../cache-owners/environment-cache-effects";
import { applyEnvironmentUpdateResult } from "../cache-owners/environment-workspace-cache-owner";
import {
  beginArchiveEnvironmentThreadsTransaction,
  rollbackArchiveEnvironmentThreadsTransaction,
  settleArchiveEnvironmentThreadsTransaction,
  type ArchiveEnvironmentThreadsTransaction,
} from "../cache-owners/thread-list-cache-owner";
type UpdateEnvironmentMutationRequest = {
  id: string;
} & UpdateEnvironmentRequest;

interface ArchiveEnvironmentThreadsMutationRequest {
  id: string;
}

export function useRequestEnvironmentAction() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to run environment action.",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
      ...request
    }: RequestEnvironmentActionMutationRequest): Promise<EnvironmentActionResponse> =>
      api.requestEnvironmentAction(id, request),
    onSuccess: (_response, variables) => {
      invalidateEnvironmentActionQueries({
        environmentId: variables.id,
        queryClient,
      });
    },
  });
}

export function useArchiveEnvironmentThreads() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to archive threads.",
    },
    mutationFn: ({
      id,
    }: ArchiveEnvironmentThreadsMutationRequest): Promise<EnvironmentArchiveThreadsResponse> =>
      api.archiveEnvironmentThreads(id),
    onMutate: async ({
      id,
    }): Promise<ArchiveEnvironmentThreadsTransaction> =>
      beginArchiveEnvironmentThreadsTransaction({
        environmentId: id,
        queryClient,
      }),
    onError: (_error, _variables, context) => {
      rollbackArchiveEnvironmentThreadsTransaction({
        queryClient,
        transaction: context,
      });
    },
    onSettled: (data, _error, variables, context) => {
      invalidateEnvironmentActionQueries({
        environmentId: variables.id,
        queryClient,
      });
      settleArchiveEnvironmentThreadsTransaction({
        queryClient,
        response: data,
        transaction: context,
      });
    },
  });
}

export function useUpdateEnvironment() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update environment.",
      showErrorToast: false,
    },
    mutationFn: ({ id, ...request }: UpdateEnvironmentMutationRequest) =>
      api.updateEnvironment(id, request),
    onSuccess: (environment: Environment) => {
      applyEnvironmentUpdateResult({ environment, queryClient });
    },
  });
}
