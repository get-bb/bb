import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  githubPrStatusRpcContract,
  type EnvironmentPullRequest,
  type PullRequest,
  type PullRequestMergeMethod,
} from "../contract";
import {
  experimental_useRpcKeyedQuery as useRpcKeyedQuery,
  experimental_useRpcMutation as useRpcMutation,
} from "@get-bb/plugin-sdk/app";

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
    const shownBefore = shownEnvironments.get(environmentId) ?? 0;
    shownEnvironments.set(environmentId, shownBefore + 1);
    if (shownBefore === 0 && latest.current.row !== undefined)
      queueRefetch(latest.current.refetch);
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
