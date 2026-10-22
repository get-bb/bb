import { useEffect, useRef } from "react";
import {
  GITHUB_PR_STATUS_PLUGIN_ID,
  githubPrStatusRpcContract,
  type EnvironmentPullRequest,
  type PullRequest,
} from "bb-plugin-bb--github-pr-status/contract";
import {
  experimental_useRpcKeyedQuery as useRpcKeyedQuery,
  experimental_useRpcMutation as useRpcMutation,
} from "@/lib/plugin-sdk-hooks";

const OPEN_PULL_REQUEST_STALE_MS = 30_000;
const SETTLED_PULL_REQUEST_STALE_MS = 60 * 60_000;

export function isEnvironmentPullRequestStale(
  row: EnvironmentPullRequest,
  loadedAt: number,
  now: number,
): boolean {
  const settled =
    row.outcome === "available" &&
    (row.pullRequest.state === "merged" || row.pullRequest.state === "closed");
  return (
    now - loadedAt >
    (settled ? SETTLED_PULL_REQUEST_STALE_MS : OPEN_PULL_REQUEST_STALE_MS)
  );
}

const loadedAtByEnvironment = new Map<string, number>();
const shownEnvironments = new Map<string, number>();
let refetchQueued = false;

function queueRefetch(refetch: () => Promise<void>): void {
  if (refetchQueued) return;
  refetchQueued = true;
  queueMicrotask(() => {
    refetchQueued = false;
    const refreshed = [...shownEnvironments.keys()];
    void refetch().then(() => {
      const loadedAt = Date.now();
      for (const environmentId of refreshed)
        loadedAtByEnvironment.set(environmentId, loadedAt);
    });
  });
}

export interface EnvironmentPullRequestState {
  isLoading: boolean;
  pullRequest: PullRequest | null;
}

export function useEnvironmentPullRequest(
  environmentId: string | null | undefined,
  options: { enabled?: boolean } = {},
): EnvironmentPullRequestState {
  const enabled = (options.enabled ?? true) && Boolean(environmentId);
  const query = useRpcKeyedQuery({
    pluginId: GITHUB_PR_STATUS_PLUGIN_ID,
    contract: githubPrStatusRpcContract,
    method: "pullRequests",
    keys: enabled && environmentId ? [environmentId] : [],
    enabled,
  });
  const row = environmentId ? query.data?.[environmentId] : undefined;
  const { refetch } = query;
  const latest = useRef({ row, refetch });
  useEffect(() => {
    latest.current = { row, refetch };
  });

  useEffect(() => {
    if (environmentId && row !== undefined)
      loadedAtByEnvironment.set(environmentId, Date.now());
  }, [environmentId, row]);

  useEffect(() => {
    if (!enabled || !environmentId) return;
    shownEnvironments.set(
      environmentId,
      (shownEnvironments.get(environmentId) ?? 0) + 1,
    );
    if (latest.current.row !== undefined) queueRefetch(latest.current.refetch);
    const refetchIfStale = () => {
      if (document.visibilityState === "hidden") return;
      const current = latest.current.row;
      if (
        current !== undefined &&
        isEnvironmentPullRequestStale(
          current,
          loadedAtByEnvironment.get(environmentId) ?? 0,
          Date.now(),
        )
      ) {
        queueRefetch(latest.current.refetch);
      }
    };
    document.addEventListener("visibilitychange", refetchIfStale);
    window.addEventListener("pageshow", refetchIfStale);
    return () => {
      document.removeEventListener("visibilitychange", refetchIfStale);
      window.removeEventListener("pageshow", refetchIfStale);
      const count = (shownEnvironments.get(environmentId) ?? 1) - 1;
      if (count > 0) shownEnvironments.set(environmentId, count);
      else shownEnvironments.delete(environmentId);
    };
  }, [enabled, environmentId]);

  return {
    isLoading: enabled && query.error === null && row === undefined,
    pullRequest: row?.outcome === "available" ? row.pullRequest : null,
  };
}

export function usePullRequestActions() {
  const markReady = useRpcMutation({
    pluginId: GITHUB_PR_STATUS_PLUGIN_ID,
    contract: githubPrStatusRpcContract,
    method: "markReady",
  });
  const markDraft = useRpcMutation({
    pluginId: GITHUB_PR_STATUS_PLUGIN_ID,
    contract: githubPrStatusRpcContract,
    method: "markDraft",
  });
  const merge = useRpcMutation({
    pluginId: GITHUB_PR_STATUS_PLUGIN_ID,
    contract: githubPrStatusRpcContract,
    method: "merge",
  });
  return {
    isPending: markReady.isPending || markDraft.isPending || merge.isPending,
    markReady: markReady.mutate,
    markDraft: markDraft.mutate,
    merge: merge.mutate,
  };
}
