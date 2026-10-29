// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import type {
  EnvironmentPullRequest,
  PullRequest,
} from "bb-plugin-bb--github-pr-status/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRetiredSidebarEnvironmentPullRequest } from "./retired-sidebar-pull-request";

const keyedQuery = vi.hoisted(() => ({
  pluginEnabled: true,
  data: {} as Record<string, EnvironmentPullRequest>,
  refetch: vi.fn(async (_keys: readonly string[]) => {}),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: keyedQuery.pluginEnabled }),
}));

vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_useRpcKeyedQuery: (options: { keys: readonly string[] }) => ({
    data: keyedQuery.data,
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: () => keyedQuery.refetch(options.keys),
  }),
  experimental_useRpcMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/plugin-sdk-hooks", () => ({
  experimental_useRpcKeyedQuery: (options: { keys: readonly string[] }) => ({
    data: keyedQuery.data,
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: () => keyedQuery.refetch(options.keys),
  }),
  experimental_useRpcMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

function row(state: PullRequest["state"]): EnvironmentPullRequest {
  return {
    outcome: "available",
    pullRequest: {
      number: 7,
      title: "Ship it",
      state,
      url: "https://github.com/acme/bb/pull/7",
      baseRefName: "main",
      headRefName: "bb/ship",
      updatedAt: "2026-10-22T00:00:00Z",
      autoMerge: false,
      inMergeQueue: false,
      checks: {
        state: "passing",
        totalCount: 1,
        passedCount: 1,
        failedCount: 0,
        pendingCount: 0,
      },
      review: { state: "none", reviewRequestCount: 0 },
      mergeability: {
        state: "mergeable",
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
      },
      attention: "ready_to_merge",
    },
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function showPage(): Promise<void> {
  document.dispatchEvent(new Event("visibilitychange"));
  await settle();
}

afterEach(() => {
  cleanup();
  keyedQuery.refetch.mockClear();
  keyedQuery.data = {};
  keyedQuery.pluginEnabled = true;
});

describe("useRetiredSidebarEnvironmentPullRequest refreshes", () => {
  it("refetches a cached row on mount and each time the page shows again", async () => {
    keyedQuery.data = { "env-open": row("open") };
    renderHook(() => useRetiredSidebarEnvironmentPullRequest("env-open"));
    await settle();
    expect(keyedQuery.refetch).toHaveBeenCalledTimes(1);

    await showPage();
    await showPage();
    expect(keyedQuery.refetch).toHaveBeenCalledTimes(3);
  });

  it("hides a previously cached PR when its plugin is disabled", () => {
    keyedQuery.data = { "env-disabled": row("open") };
    keyedQuery.pluginEnabled = false;
    const { result } = renderHook(() =>
      useRetiredSidebarEnvironmentPullRequest("env-disabled"),
    );
    expect(result.current.pullRequest).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("refetches each environment that shows", async () => {
    keyedQuery.data = { "env-a": row("open"), "env-b": row("open") };
    renderHook(() => {
      useRetiredSidebarEnvironmentPullRequest("env-a");
      useRetiredSidebarEnvironmentPullRequest("env-b");
    });
    await settle();
    expect(keyedQuery.refetch.mock.calls).toEqual([[["env-a"]], [["env-b"]]]);

    await showPage();
    expect(keyedQuery.refetch).toHaveBeenCalledTimes(4);
  });

  it("does not refetch on mount before the row has loaded", async () => {
    renderHook(() => useRetiredSidebarEnvironmentPullRequest("env-new"));
    await settle();
    expect(keyedQuery.refetch).not.toHaveBeenCalled();
  });
});
