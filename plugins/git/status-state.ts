import { useCallback, useEffect, useMemo } from "react";
import { gitStatusErrorMessage } from "@bb/shared-ui/git-status-display";
import type { GitStatusRow, WorkspaceStatus } from "./contract.js";
import type { WorkspaceResolutionFailure } from "bb-environment-provider-host/git-types";

export interface GitStatusState {
  result: GitStatusRow | undefined;
  workspace: WorkspaceStatus | undefined;
  failure: WorkspaceResolutionFailure | undefined;
  errorMessage: string | null;
  isLoading: boolean;
  retry(): void;
}

export type GitStatusKeyedQuery = (args: {
  keys: string[];
  enabled: boolean;
}) => {
  data: Readonly<Record<string, GitStatusRow>> | undefined;
  error: Error | null;
  isLoading: boolean;
  refetchKeys(keys: readonly string[]): Promise<void>;
};

type LastAvailableWorkspaces = Map<string, WorkspaceStatus>;

function rememberWorkspace(
  lastAvailable: LastAvailableWorkspaces,
  environmentId: string,
  result: GitStatusRow,
): void {
  if (result.outcome === "available") {
    lastAvailable.set(environmentId, result.workspace);
  } else if (result.outcome !== "failed") {
    lastAvailable.delete(environmentId);
  }
}

function resultErrorMessage(
  result: GitStatusRow | undefined,
  queryError: Error | null,
): string | null {
  return result?.outcome === "failed"
    ? result.message
    : gitStatusErrorMessage(queryError);
}

function resolveWorkspace(
  lastAvailable: LastAvailableWorkspaces,
  environmentId: string,
  result: GitStatusRow | undefined,
  errorMessage: string | null,
): WorkspaceStatus | undefined {
  return result?.outcome === "available"
    ? result.workspace
    : errorMessage !== null
      ? lastAvailable.get(environmentId)
      : undefined;
}

export function createGitStatusHook(useStatusQuery: GitStatusKeyedQuery) {
  const lastAvailable: LastAvailableWorkspaces = new Map();
  return function useGitStatus(environmentId: string | null): GitStatusState {
    const query = useStatusQuery({
      keys: environmentId === null ? [] : [environmentId],
      enabled: environmentId !== null,
    });
    const result =
      environmentId === null ? undefined : query.data?.[environmentId];
    const { refetchKeys } = query;
    const retry = useCallback(() => {
      if (environmentId !== null) void refetchKeys([environmentId]);
    }, [environmentId, refetchKeys]);
    useEffect(() => {
      if (environmentId === null || result === undefined) return;
      rememberWorkspace(lastAvailable, environmentId, result);
    }, [environmentId, result]);
    const errorMessage = resultErrorMessage(result, query.error);
    const workspace =
      environmentId === null
        ? undefined
        : resolveWorkspace(lastAvailable, environmentId, result, errorMessage);
    return {
      result,
      workspace,
      failure: result?.outcome === "unavailable" ? result.failure : undefined,
      errorMessage,
      isLoading: environmentId !== null && query.isLoading,
      retry,
    };
  };
}

export function createGitWorkspacesHook(useStatusQuery: GitStatusKeyedQuery) {
  const lastAvailable: LastAvailableWorkspaces = new Map();
  return function useGitWorkspaces(
    environmentIds: readonly string[],
  ): ReadonlyMap<string, WorkspaceStatus> {
    const query = useStatusQuery({
      keys: [...environmentIds],
      enabled: environmentIds.length > 0,
    });
    const { data, error } = query;
    useEffect(() => {
      for (const environmentId of environmentIds) {
        const result = data?.[environmentId];
        if (result !== undefined) {
          rememberWorkspace(lastAvailable, environmentId, result);
        }
      }
    }, [data, environmentIds]);
    return useMemo(() => {
      const workspaces = new Map<string, WorkspaceStatus>();
      for (const environmentId of environmentIds) {
        const result = data?.[environmentId];
        const workspace = resolveWorkspace(
          lastAvailable,
          environmentId,
          result,
          resultErrorMessage(result, error),
        );
        if (workspace !== undefined) workspaces.set(environmentId, workspace);
      }
      return workspaces;
    }, [data, environmentIds, error]);
  };
}
