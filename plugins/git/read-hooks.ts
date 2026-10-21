import { gitReadFailureError } from "./read-error.js";
import { useEffect, useMemo, useState } from "react";
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { resolveEnvironmentMergeBaseBranch } from "@bb/domain";
import { gitRpcContract } from "./contract.js";

export function useGitContext(threadId: string) {
  return experimental_useRpcQuery({
    contract: gitRpcContract,
    method: "context",
    input: { threadId },
  });
}
export function useThreadGitStatus(threadId: string) {
  const context = useGitContext(threadId);
  const environment = context.data?.environment;
  const visible =
    environment?.isGitRepo === true &&
    environment.hostLifecycle === "active" &&
    environment.status !== "destroyed" &&
    !(context.data?.archivedAt != null && !environment.managed);
  const [inferredDefault, setInferredDefault] = useState<{
    environmentId: string;
    branch: string;
  } | null>(null);
  const mergeBaseBranch =
    resolveEnvironmentMergeBaseBranch(environment) ??
    (inferredDefault?.environmentId === environment?.id
      ? inferredDefault?.branch
      : undefined);
  const status = experimental_useRpcQuery({
    contract: gitRpcContract,
    method: "status",
    input: {
      environmentId: environment?.id ?? "",
      mergeBaseBranch: mergeBaseBranch ?? null,
    },
    enabled: visible && environment.status === "ready",
  });
  const defaultBranch =
    status.data?.outcome === "available"
      ? status.data.workspace.branch.defaultBranch
      : undefined;
  useEffect(() => {
    if (environment && defaultBranch)
      setInferredDefault((previous) =>
        previous?.environmentId === environment.id &&
        previous.branch === defaultBranch
          ? previous
          : { environmentId: environment.id, branch: defaultBranch },
      );
  }, [environment, defaultBranch]);
  const failure =
    status.data?.outcome === "unavailable" ? status.data.failure : undefined;
  const error = useMemo(
    () => status.error ?? (failure ? gitReadFailureError(failure) : null),
    [status.error, failure],
  );
  const workspaceUnavailable =
    failure && !("error" in failure) ? failure : undefined;
  return {
    context,
    environment,
    visible,
    status: { ...status, error },
    workspaceUnavailable,
    workspace:
      status.data?.outcome === "available" ? status.data.workspace : undefined,
  };
}
