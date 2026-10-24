import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Environment, WorkspaceDiffTarget } from "@bb/domain";
import type {
  EnvironmentActionResponse,
  UpdateEnvironmentRequest,
} from "@bb/server-contract";
import {
  applyOptimisticDiffViewedChange,
  invalidateDiffViewedQuery,
} from "../cache-owners/environment-diff-viewed-cache-owner";
import { sdk } from "@/lib/sdk";
import type { RequestEnvironmentActionMutationRequest } from "./mutation-request-types";
import { invalidateEnvironmentActionQueries } from "../cache-owners/environment-cache-effects";
import {
  beginEnvironmentNameUpdateTransaction,
  completeEnvironmentNameUpdateTransaction,
  rollbackEnvironmentNameUpdateTransaction,
  type EnvironmentNameUpdateTransaction,
} from "../cache-owners/environment-workspace-cache-owner";

type UpdateEnvironmentMutationRequest = {
  id: string;
} & UpdateEnvironmentRequest;

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
    }: RequestEnvironmentActionMutationRequest): Promise<EnvironmentActionResponse> => {
      switch (request.action) {
        case "commit":
          return sdk.environments.commit({ environmentId: id });
      }
    },
    onSuccess: (_response, variables) => {
      invalidateEnvironmentActionQueries({
        environmentId: variables.id,
        queryClient,
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
    mutationFn: ({ id, ...request }: UpdateEnvironmentMutationRequest) => {
      if (request.name !== undefined) {
        return sdk.environments.update({
          environmentId: id,
          name: request.name,
          ...(request.mergeBaseBranch !== undefined
            ? { mergeBaseBranch: request.mergeBaseBranch }
            : {}),
        });
      }
      if (request.mergeBaseBranch !== undefined) {
        return sdk.environments.update({
          environmentId: id,
          mergeBaseBranch: request.mergeBaseBranch,
        });
      }
      throw new Error("Environment update requires at least one field");
    },
    onMutate: ({
      id,
      name,
    }): Promise<EnvironmentNameUpdateTransaction> | undefined =>
      name === undefined
        ? undefined
        : beginEnvironmentNameUpdateTransaction({
            environmentId: id,
            name,
            queryClient,
          }),
    onError: (_error, _variables, transaction) => {
      rollbackEnvironmentNameUpdateTransaction({ queryClient, transaction });
    },
    onSuccess: (environment: Environment, _variables, transaction) => {
      completeEnvironmentNameUpdateTransaction({
        environment,
        queryClient,
        transaction,
      });
    },
  });
}

const DIFF_VIEWED_MUTATION_KEY = ["setDiffFileViewed"] as const;

interface SetDiffFileViewedRequest {
  environmentId: string;
  target: WorkspaceDiffTarget;
  path: string;
  revision: string;
  viewed: boolean;
}

export function useSetDiffFileViewed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: DIFF_VIEWED_MUTATION_KEY,
    meta: { errorMessage: "Failed to update Viewed." },
    mutationFn: (request: SetDiffFileViewedRequest) =>
      request.viewed
        ? sdk.environments.experimental_markDiffViewed({
            environmentId: request.environmentId,
            target: request.target,
            path: request.path,
            revision: request.revision,
          })
        : sdk.environments.experimental_clearDiffViewed({
            environmentId: request.environmentId,
            target: request.target,
            path: request.path,
          }),
    onMutate: (request) =>
      applyOptimisticDiffViewedChange(queryClient, request),
    onSettled: (_response, _error, request) => {
      if (
        queryClient.isMutating({ mutationKey: DIFF_VIEWED_MUTATION_KEY }) > 1
      ) {
        return;
      }
      invalidateDiffViewedQuery(queryClient, request);
    },
  });
}
