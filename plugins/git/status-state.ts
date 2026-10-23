import { useEffect } from "react";
import { gitStatusErrorMessage } from "@bb/shared-ui/git-status-display";
import type { GitStatusRow, WorkspaceStatus } from "./contract.js";
import type {
  WorkspaceResolutionFailure,
} from "bb-environment-provider-host/git-types";

export interface GitStatusState {
  result: GitStatusRow | undefined;
  workspace: WorkspaceStatus | undefined;
  failure: WorkspaceResolutionFailure | undefined;
  errorMessage: string | null;
  isLoading: boolean;
}

export type GitStatusKeyedQuery = (args: {
  keys: string[];
  enabled: boolean;
}) => {
  data: Readonly<Record<string, GitStatusRow>> | undefined;
  error: Error | null;
  isLoading: boolean;
};

export function createGitStatusHook(useStatusQuery: GitStatusKeyedQuery) {
  const lastAvailable = new Map<string, WorkspaceStatus>();
  return function useGitStatus(environmentId: string | null): GitStatusState {
    const query = useStatusQuery({
      keys: environmentId === null ? [] : [environmentId],
      enabled: environmentId !== null,
    });
    const result =
      environmentId === null ? undefined : query.data?.[environmentId];
    useEffect(() => {
      if (environmentId === null || result === undefined) return;
      if (result.outcome === "available") {
        lastAvailable.set(environmentId, result.workspace);
      } else if (result.outcome !== "failed") {
        lastAvailable.delete(environmentId);
      }
    }, [environmentId, result]);
    const errorMessage =
      result?.outcome === "failed"
        ? result.message
        : gitStatusErrorMessage(query.error);
    const workspace =
      result?.outcome === "available"
        ? result.workspace
        : errorMessage !== null && environmentId !== null
          ? lastAvailable.get(environmentId)
          : undefined;
    return {
      result,
      workspace,
      failure: result?.outcome === "unavailable" ? result.failure : undefined,
      errorMessage,
      isLoading: environmentId !== null && query.isLoading,
    };
  };
}
