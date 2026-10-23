import {
  experimental_useRpcKeyedQuery as useRpcKeyedQuery,
  experimental_useRpcMutation as useRpcMutation,
  experimental_useRpcQuery as useRpcQuery,
} from "@get-bb/plugin-sdk/app";
import { useDebounceValue } from "usehooks-ts";
import {
  createGitStatusHook,
  type GitStatusKeyedQuery,
} from "../status-state.js";
import { gitRpcContract } from "../rpc-contract.js";
import type { WorkspaceDiffTarget } from "../contract.js";

const useGitStatusQuery: GitStatusKeyedQuery = (args) =>
  useRpcKeyedQuery({ contract: gitRpcContract, method: "status", ...args });

export const useGitStatus = createGitStatusHook(useGitStatusQuery);

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
