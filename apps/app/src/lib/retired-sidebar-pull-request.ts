import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { InstalledPlugin } from "@bb/server-contract";
import {
  GITHUB_PR_STATUS_PLUGIN_ID,
  githubPrStatusRpcContract,
  PULL_REQUESTS_REFETCH_EVENT,
  type EnvironmentPullRequest,
  type PullRequest,
} from "bb-plugin-bb--github-pr-status/contract";
import { pluginListQueryOptions } from "@/hooks/queries/plugin-settings-queries";
import { experimental_useRpcKeyedQuery as useRpcKeyedQuery } from "@/lib/plugin-sdk-hooks";

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
const rowByEnvironment = new Map<string, EnvironmentPullRequest>();
const shownEnvironments = new Map<string, number>();
let pendingRefetch: {
  refetch: () => Promise<void>;
  onlyIfStale: boolean;
} | null = null;

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
  refetch: () => Promise<void>,
  onlyIfStale: boolean,
): void {
  if (pendingRefetch) {
    pendingRefetch.onlyIfStale &&= onlyIfStale;
    return;
  }
  pendingRefetch = { refetch, onlyIfStale };
  queueMicrotask(() => {
    const pending = pendingRefetch;
    pendingRefetch = null;
    if (!pending) return;
    const refreshed = [...shownEnvironments.keys()];
    const now = Date.now();
    if (
      pending.onlyIfStale &&
      !refreshed.some((environmentId) => isShownRowStale(environmentId, now))
    )
      return;
    window.dispatchEvent(
      new CustomEvent(PULL_REQUESTS_REFETCH_EVENT, { detail: refreshed }),
    );
    void pending.refetch().then(() => markLoaded(refreshed));
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
    shownEnvironments.set(
      environmentId,
      (shownEnvironments.get(environmentId) ?? 0) + 1,
    );
    if (latest.current.row !== undefined)
      queueRefetch(latest.current.refetch, false);
    const refetchIfStale = () => {
      if (document.visibilityState === "hidden") return;
      if (isShownRowStale(environmentId, Date.now()))
        queueRefetch(latest.current.refetch, true);
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
    pullRequest:
      enabled && row?.outcome === "available" ? row.pullRequest : null,
  };
}
