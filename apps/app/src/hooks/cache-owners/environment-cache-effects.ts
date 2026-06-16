import {
  getEnvironmentActionInvalidationQueryKeys,
  getEnvironmentWorkspaceStateInvalidationQueryKeys,
} from "./query-cache";
import {
  environmentFilePreviewQueryKeyPrefix,
  environmentGitDiffQueryKeyPrefix,
  environmentMergeBaseBranchesQueryKeyPrefix,
  environmentPathsQueryKeyPrefix,
  environmentWorkStatusQueryKeyPrefix,
  systemExecutionOptionsEnvironmentQueryKeyPrefix,
} from "../queries/query-keys";
import { threadComposerBootstrapEnvironmentQueryKeyPrefix } from "../queries/thread-composer-bootstrap-query";
import type {
  EnvironmentArg,
  OptionalEnvironmentArg,
} from "../cache-effect-types";
import { invalidateQueryKeys } from "./cache-effect-utils";

export function removeEnvironmentScopedQueries({
  environmentId,
  queryClient,
}: OptionalEnvironmentArg): void {
  if (!environmentId) {
    return;
  }

  queryClient.removeQueries({
    queryKey: environmentWorkStatusQueryKeyPrefix(environmentId),
  });
  queryClient.removeQueries({
    queryKey: environmentGitDiffQueryKeyPrefix(environmentId),
  });
  queryClient.removeQueries({
    queryKey: environmentFilePreviewQueryKeyPrefix(environmentId),
  });
  queryClient.removeQueries({
    queryKey: environmentPathsQueryKeyPrefix(environmentId),
  });
  queryClient.removeQueries({
    queryKey: environmentMergeBaseBranchesQueryKeyPrefix(environmentId),
  });
  queryClient.removeQueries({
    queryKey: systemExecutionOptionsEnvironmentQueryKeyPrefix(environmentId),
  });
  queryClient.removeQueries({
    queryKey: threadComposerBootstrapEnvironmentQueryKeyPrefix(environmentId),
  });
}

export function invalidateEnvironmentActionQueries({
  environmentId,
  queryClient,
}: EnvironmentArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: getEnvironmentActionInvalidationQueryKeys({ environmentId }),
  });
}

export function invalidateEnvironmentWorkspaceStateQueries({
  environmentId,
  queryClient,
}: EnvironmentArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: getEnvironmentWorkspaceStateInvalidationQueryKeys({
      environmentId,
    }),
  });
}
