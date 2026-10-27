import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  githubPrStatusRpcContract,
  PULL_REQUESTS_REFETCH_EVENT,
  type EnvironmentPullRequest,
  type PullRequest,
  type PullRequestMergeMethod,
} from "../contract";
import { isEnvironmentPullRequestStale } from "../read-contract";
import {
  experimental_useRpcKeyedQuery as useRpcKeyedQuery,
  experimental_useRpcMutation as useRpcMutation,
} from "@get-bb/plugin-sdk/app";

const loadedAtByEnvironment = new Map<string, number>();
const rowByEnvironment = new Map<string, EnvironmentPullRequest>();
const shownEnvironments = new Map<string, number>();
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

export function useEnvironmentPullRequest(
  environmentId: string | null | undefined,
  options: { enabled?: boolean } = {},
): EnvironmentPullRequestState {
  const enabled = (options.enabled ?? true) && Boolean(environmentId);
  const query = useRpcKeyedQuery({
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
    const shownBefore = shownEnvironments.get(environmentId) ?? 0;
    shownEnvironments.set(environmentId, shownBefore + 1);
    if (shownBefore === 0 && latest.current.row !== undefined)
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
      queueMicrotask(() => {
        const count = (shownEnvironments.get(environmentId) ?? 1) - 1;
        if (count > 0) shownEnvironments.set(environmentId, count);
        else shownEnvironments.delete(environmentId);
      });
    };
  }, [enabled, environmentId]);

  return {
    isLoading: enabled && query.error === null && row === undefined,
    pullRequest: row?.outcome === "available" ? row.pullRequest : null,
  };
}

const MERGE_METHOD_STORAGE_KEY = "bb.pullRequest.mergeMethod";

function isMergeMethod(value: string | null): value is PullRequestMergeMethod {
  return value === "merge" || value === "squash" || value === "rebase";
}

function readMergeMethod(): PullRequestMergeMethod {
  const stored = window.localStorage.getItem(MERGE_METHOD_STORAGE_KEY);
  return isMergeMethod(stored) ? stored : "merge";
}

const MERGE_LOADING_TITLES: Record<PullRequestMergeMethod, string> = {
  merge: "Merging pull request",
  squash: "Squash merging pull request",
  rebase: "Rebase merging pull request",
};

interface ActionToastCopy {
  loading: string;
  failure: string;
  fallback: string;
}

const UPDATE_FAILURE = {
  failure: "Failed to update pull request",
  fallback: "Pull request was not updated",
};

async function runWithToast(
  copy: ActionToastCopy,
  run: () => Promise<{ message: string }>,
): Promise<void> {
  const toastId = toast.loading(copy.loading);
  try {
    const response = await run();
    toast.success(response.message, { id: toastId });
  } catch (error) {
    toast.error(copy.failure, {
      id: toastId,
      description:
        error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : copy.fallback,
    });
  }
}

export function usePullRequestActions(environmentId: string) {
  const markReady = useRpcMutation({
    contract: githubPrStatusRpcContract,
    method: "markReady",
  });
  const markDraft = useRpcMutation({
    contract: githubPrStatusRpcContract,
    method: "markDraft",
  });
  const merge = useRpcMutation({
    contract: githubPrStatusRpcContract,
    method: "merge",
  });
  const [mergeMethod, setMergeMethod] = useState(readMergeMethod);
  return {
    isPending: markReady.isPending || markDraft.isPending || merge.isPending,
    mergeMethod,
    markReady: () =>
      runWithToast(
        { loading: "Marking pull request ready", ...UPDATE_FAILURE },
        () => markReady.mutate({ environmentId }),
      ),
    markDraft: () =>
      runWithToast(
        { loading: "Converting pull request to draft", ...UPDATE_FAILURE },
        () => markDraft.mutate({ environmentId }),
      ),
    merge: (method: PullRequestMergeMethod) => {
      window.localStorage.setItem(MERGE_METHOD_STORAGE_KEY, method);
      setMergeMethod(method);
      return runWithToast(
        {
          loading: MERGE_LOADING_TITLES[method],
          failure: "Failed to merge pull request",
          fallback: "Pull request was not merged",
        },
        () => merge.mutate({ environmentId, method }),
      );
    },
  };
}
