import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { InstalledPlugin } from "@bb/server-contract";
import {
  githubPrStatusRpcContract,
  PULL_REQUESTS_REFETCH_EVENT,
  type EnvironmentPullRequest,
  type PullRequest,
} from "bb-plugin-bb--github-pr-status/contract";
import {
  GITHUB_PR_STATUS_PLUGIN_ID,
  isEnvironmentPullRequestStale,
} from "bb-plugin-bb--github-pr-status/read-contract";
import { pluginListQueryOptions } from "@/hooks/queries/plugin-settings-queries";
import { experimental_useRpcKeyedQuery as useRpcKeyedQuery } from "@/lib/plugin-sdk-hooks";

const loadedAtByEnvironment = new Map<string, number>();
const rowByEnvironment = new Map<string, EnvironmentPullRequest>();
const pendingRefetches = new Map<
  string,
  { refetch: () => Promise<void>; onlyIfStale: boolean }
>();

function markLoaded(environmentIds: readonly string[]): void {
  const loadedAt = Date.now();
  for (const environmentId of environmentIds)
    loadedAtByEnvironment.set(environmentId, loadedAt);
}

if (typeof window !== "undefined") {
  window.addEventListener(PULL_REQUESTS_REFETCH_EVENT, (event) => {
    const detail: unknown = event instanceof CustomEvent ? event.detail : null;
    if (Array.isArray(detail))
      markLoaded(detail.filter((id) => typeof id === "string"));
  });
}

function isShownRowStale(environmentId: string, now: number): boolean {
  const row = rowByEnvironment.get(environmentId);
  return (
    row !== undefined &&
    isEnvironmentPullRequestStale(
      row,
      loadedAtByEnvironment.get(environmentId) ?? 0,
      now,
    )
  );
}

function queueRefetch(
  environmentId: string,
  refetch: () => Promise<void>,
  onlyIfStale: boolean,
): void {
  const flushQueued = pendingRefetches.size > 0;
  const queued = pendingRefetches.get(environmentId);
  pendingRefetches.set(environmentId, {
    refetch,
    onlyIfStale: (queued?.onlyIfStale ?? true) && onlyIfStale,
  });
  if (flushQueued) return;
  queueMicrotask(() => {
    const now = Date.now();
    const refetches = [...pendingRefetches].filter(
      ([environmentId, pending]) =>
        !pending.onlyIfStale || isShownRowStale(environmentId, now),
    );
    pendingRefetches.clear();
    if (refetches.length === 0) return;
    const refreshed = refetches.map(([environmentId]) => environmentId);
    window.dispatchEvent(
      new CustomEvent(PULL_REQUESTS_REFETCH_EVENT, { detail: refreshed }),
    );
    void Promise.all(refetches.map(([, pending]) => pending.refetch())).then(
      () => markLoaded(refreshed),
    );
  });
}

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
  const { refetch } = query;
  const latest = useRef({ row, refetch });
  useEffect(() => {
    latest.current = { row, refetch };
  });

  useEffect(() => {
    if (!environmentId || row === undefined) return;
    rowByEnvironment.set(environmentId, row);
    loadedAtByEnvironment.set(environmentId, Date.now());
  }, [environmentId, row]);

  useEffect(() => {
    if (!enabled || !environmentId) return;
    if (latest.current.row !== undefined)
      queueRefetch(environmentId, latest.current.refetch, false);
    const refetchIfStale = () => {
      if (document.visibilityState === "hidden") return;
      if (isShownRowStale(environmentId, Date.now()))
        queueRefetch(environmentId, latest.current.refetch, true);
    };
    document.addEventListener("visibilitychange", refetchIfStale);
    window.addEventListener("pageshow", refetchIfStale);
    return () => {
      document.removeEventListener("visibilitychange", refetchIfStale);
      window.removeEventListener("pageshow", refetchIfStale);
    };
  }, [enabled, environmentId]);

  return {
    isLoading: enabled && query.error === null && row === undefined,
    pullRequest:
      enabled && row?.outcome === "available" ? row.pullRequest : null,
  };
}
