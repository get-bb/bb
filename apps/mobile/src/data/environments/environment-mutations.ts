import type { Environment } from "@bb/domain";
import type {
  EnvironmentActionRequest,
  EnvironmentActionResponse,
  UpdateEnvironmentRequest,
} from "@bb/server-contract";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { removeEnvironmentDiffPatchQueries } from "@/lib/query/diff-patch-cache";
import {
  environmentDiffFilesQueryKeyPrefix,
  environmentMergeBaseBranchesQueryKeyPrefix,
  environmentPullRequestQueryKey,
  environmentQueryKey,
  environmentsQueryKey,
  environmentWorkStatusQueryKeyPrefix,
  threadsQueryKey,
} from "@/lib/query/query-keys";
import { toast } from "@/ui/Toast";
import {
  describeEnvironmentActionFailure,
  describeEnvironmentActionSuccess,
  ENVIRONMENT_ACTION_COPY,
  getPullRequestMergeLoadingTitle,
} from "./environment-action-model";

/**
 * Environment writes (mirror of
 * apps/app/src/hooks/mutations/environment-mutations.ts): the git / PR
 * actions and the record update (name, merge base).
 */

export type RequestEnvironmentActionRequest = {
  id: string;
} & EnvironmentActionRequest;

export type UpdateEnvironmentMutationRequest = {
  id: string;
} & UpdateEnvironmentRequest;

/** Everything an environment action can move: workspace views and the thread lists' environment labels. */
function invalidateEnvironmentActionQueries(
  queryClient: QueryClient,
  environmentId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: environmentWorkStatusQueryKeyPrefix(environmentId),
  });
  void queryClient.invalidateQueries({
    queryKey: environmentPullRequestQueryKey(environmentId),
  });
  void queryClient.invalidateQueries({
    queryKey: environmentMergeBaseBranchesQueryKeyPrefix(environmentId),
  });
  // A commit / squash merge moves files between the uncommitted and
  // committed diff targets: the diff tab's TOC and file reads refetch, and
  // the observer-less patch cache is evicted (see diff-patch-cache.ts).
  removeEnvironmentDiffPatchQueries(queryClient, environmentId);
  void queryClient.invalidateQueries({
    queryKey: environmentDiffFilesQueryKeyPrefix(environmentId),
  });
  void queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
}

function loadingTitle(request: EnvironmentActionRequest): string {
  return request.action === "pull_request_merge"
    ? getPullRequestMergeLoadingTitle(request.options.method)
    : ENVIRONMENT_ACTION_COPY[request.action].loading;
}

/**
 * `POST /environments/:id/actions`. Owns its toasts: a loading toast while
 * the daemon runs the action, updated to success (commit sha / server
 * message), to a warning when the route answers 409 "blocked" (nothing to
 * commit, no PR, merge conflict, git host CLI missing), or to an error.
 * `run` resolves with the response, or null when the action failed (the
 * failure has been toasted).
 */
export function useEnvironmentAction() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  const mutation = useMutation<
    EnvironmentActionResponse,
    Error,
    RequestEnvironmentActionRequest
  >({
    meta: {
      errorMessage: "Failed to run environment action.",
      showErrorToast: false,
    },
    mutationFn: ({ id, ...request }) => {
      switch (request.action) {
        case "commit":
          return sdk.environments.commit({ environmentId: id });
        case "squash_merge":
          return sdk.environments.squashMerge({
            environmentId: id,
            mergeBaseBranch: request.options.mergeBaseBranch,
          });
        case "pull_request_ready":
          return sdk.environments.markPullRequestReady({ environmentId: id });
        case "pull_request_merge":
          return sdk.environments.mergePullRequest({
            environmentId: id,
            method: request.options.method,
          });
        case "pull_request_draft":
          return sdk.environments.markPullRequestDraft({ environmentId: id });
      }
    },
    onSettled: (_response, _error, variables) => {
      // A failed squash merge may still have created the pre-merge commit.
      invalidateEnvironmentActionQueries(queryClient, variables.id);
    },
  });
  const { mutateAsync } = mutation;

  const run = useCallback(
    async (
      request: RequestEnvironmentActionRequest,
    ): Promise<EnvironmentActionResponse | null> => {
      const toastId = toast.loading(loadingTitle(request));
      try {
        const response = await mutateAsync(request);
        toast.success(ENVIRONMENT_ACTION_COPY[request.action].success, {
          id: toastId,
          description: describeEnvironmentActionSuccess(response),
        });
        return response;
      } catch (error) {
        const failure = describeEnvironmentActionFailure({
          action: request.action,
          error,
        });
        const options = { id: toastId, description: failure.description };
        if (failure.kind === "blocked") {
          toast.warning(failure.title, options);
        } else {
          toast.error(failure.title, options);
        }
        return null;
      }
    },
    [mutateAsync],
  );

  return { ...mutation, run };
}

/**
 * `PATCH /environments/:id` (name and/or merge-base override). The result is
 * written straight into the record cache; callers that render the error
 * inline (merge-base picker rollback) pass `showErrorToast: false` semantics
 * by handling `onError` themselves — this mutation toasts by default.
 */
export function useUpdateEnvironment() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<Environment, Error, UpdateEnvironmentMutationRequest>({
    meta: { errorMessage: "Failed to update environment." },
    mutationFn: ({ id, ...request }) => {
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
    onSuccess: (environment, variables) => {
      queryClient.setQueryData(
        environmentQueryKey(environment.id),
        environment,
      );
      void queryClient.invalidateQueries({ queryKey: environmentsQueryKey() });
      if (variables.name !== undefined) {
        // Sidebar rows project the environment name from thread list entries.
        void queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
      }
      void queryClient.invalidateQueries({
        queryKey: environmentWorkStatusQueryKeyPrefix(environment.id),
      });
    },
  });
}
