import { useQuery } from "@tanstack/react-query";
import type { InstalledPlugin } from "@bb/server-contract";
import {
  githubPrStatusRpcContract,
  type PullRequest,
} from "bb-plugin-bb--github-pr-status/contract";
import { GITHUB_PR_STATUS_PLUGIN_ID } from "bb-plugin-bb--github-pr-status/read-contract";
import { useRefetchOnShowAndFocus } from "bb-plugin-bb--github-pr-status/refetch-on-show";
import { pluginListQueryOptions } from "@/hooks/queries/plugin-settings-queries";
import { experimental_useRpcKeyedQuery as useRpcKeyedQuery } from "@/lib/plugin-sdk-hooks";

export interface EnvironmentPullRequestState {
  isLoading: boolean;
  pullRequest: PullRequest | null;
}

function selectPrStatusEnabled(plugins: InstalledPlugin[]): boolean {
  return plugins.some(
    (plugin) => plugin.id === GITHUB_PR_STATUS_PLUGIN_ID && plugin.enabled,
  );
}

export function useRetiredSidebarEnvironmentPullRequest(
  environmentId: string | null | undefined,
  options: { enabled?: boolean } = {},
): EnvironmentPullRequestState {
  const requested = (options.enabled ?? true) && Boolean(environmentId);
  const plugin = useQuery({
    ...pluginListQueryOptions({ enabled: requested }),
    select: selectPrStatusEnabled,
  });
  const enabled = requested && plugin.data !== false;
  const query = useRpcKeyedQuery({
    pluginId: GITHUB_PR_STATUS_PLUGIN_ID,
    contract: githubPrStatusRpcContract,
    method: "pullRequests",
    keys: enabled && environmentId ? [environmentId] : [],
    enabled,
  });
  const row = environmentId ? query.data?.[environmentId] : undefined;
  useRefetchOnShowAndFocus({
    shown: enabled && environmentId ? environmentId : null,
    loaded: row !== undefined,
    refetch: query.refetch,
  });

  return {
    isLoading: enabled && query.error === null && row === undefined,
    pullRequest:
      enabled && row?.outcome === "available" ? row.pullRequest : null,
  };
}
