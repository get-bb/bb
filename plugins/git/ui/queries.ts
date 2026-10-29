import {
  experimental_useRpcKeyedQuery as useRpcKeyedQuery,
  experimental_useRpcMutation as useRpcMutation,
  experimental_useRpcQuery as useRpcQuery,
  useSdk,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { useDebounceValue } from "usehooks-ts";
import {
  createGitStatusHook,
  createGitWorkspacesHook,
  type GitStatusKeyedQuery,
} from "../status-state.js";
import { gitRpcContract } from "../rpc-contract.js";
import {
  GIT_SHOW_CHANGES_SETTING,
  GIT_SHOW_COMMIT_BUTTON_SETTING,
  type WorkspaceDiffTarget,
} from "../contract.js";

const useGitStatusQuery: GitStatusKeyedQuery = (args) =>
  useRpcKeyedQuery({ contract: gitRpcContract, method: "status", ...args });

export const useGitStatus = createGitStatusHook(useGitStatusQuery);

export const useGitWorkspaces = createGitWorkspacesHook(useGitStatusQuery);

export function useShowGitChanges(): boolean {
  return useSettings().values?.[GIT_SHOW_CHANGES_SETTING] === true;
}

export function useShowCommitButton(): boolean {
  return useSettings().values?.[GIT_SHOW_COMMIT_BUTTON_SETTING] === true;
}

const workspacePaths = new Map<string, string | null>();

export function useWorkspacePath(environmentId: string): string | null {
  const sdk = useSdk();
  const [loaded, setLoaded] = useState(() => ({
    environmentId,
    path: workspacePaths.get(environmentId) ?? null,
  }));
  useEffect(() => {
    if (workspacePaths.has(environmentId)) return;
    let cancelled = false;
    sdk.environments.get({ environmentId }).then(
      (environment) => {
        workspacePaths.set(environmentId, environment.path);
        if (!cancelled) setLoaded({ environmentId, path: environment.path });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [environmentId, sdk]);
  return loaded.environmentId === environmentId
    ? loaded.path
    : (workspacePaths.get(environmentId) ?? null);
}

export function useGitViewed(args: {
  environmentId: string | null;
  target: WorkspaceDiffTarget | undefined;
  paths: readonly string[];
  enabled: boolean;
}) {
  return useRpcQuery({
    contract: gitRpcContract,
    method: "viewed",
    input: {
      environmentId: args.environmentId ?? "",
      target: args.target ?? { type: "uncommitted" },
      paths: [...args.paths].sort(),
    },
    enabled:
      args.enabled && args.environmentId !== null && args.target !== undefined,
  });
}

const BRANCH_SEARCH_DEBOUNCE_MS = 120;

export function useGitBranches(args: {
  environmentId: string | null;
  query: string;
  selectedBranch: string | undefined;
  enabled: boolean;
}) {
  const [trimmed] = useDebounceValue(
    args.query.trim(),
    BRANCH_SEARCH_DEBOUNCE_MS,
  );
  return useRpcQuery({
    contract: gitRpcContract,
    method: "branches",
    input: {
      environmentId: args.environmentId ?? "",
      ...(trimmed === "" ? {} : { query: trimmed }),
      ...(args.selectedBranch === undefined
        ? {}
        : { selectedBranch: args.selectedBranch }),
    },
    enabled: args.enabled && args.environmentId !== null,
  });
}

export function useSetMergeBase() {
  return useRpcMutation({
    contract: gitRpcContract,
    method: "setMergeBase",
  });
}
