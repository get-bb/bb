// @vitest-environment jsdom

import { cleanup, render, renderHook } from "@testing-library/react";
import type { EnvironmentPullRequest, PullRequest } from "../contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEnvironmentPullRequest } from "./queries";

const keyedQuery = vi.hoisted(() => ({
  data: {} as Record<string, EnvironmentPullRequest>,
  refetch: vi.fn(async (_keys: readonly string[]) => {}),
  refresh: vi.fn(async (_input: { environmentId: string }) => ({
    ok: true as const,
  })),
}));

vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_useRpcKeyedQuery: (options: { keys: readonly string[] }) => ({
    data: keyedQuery.data,
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: () => keyedQuery.refetch(options.keys),
  }),
  experimental_useRpcMutation: (options: { method: string }) => ({
    mutate:
      options.method === "refresh"
        ? (input: { environmentId: string }) => keyedQuery.refresh(input)
        : vi.fn(),
    isPending: false,
  }),
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
  keyedQuery.refresh.mockClear();
  keyedQuery.data = {};
});

describe("useEnvironmentPullRequest refreshes", () => {
  it("re-checks GitHub when a thread's PR first shows, before its row has loaded", async () => {
    renderHook(() => useEnvironmentPullRequest("env-new"));
    await settle();
    expect(keyedQuery.refresh.mock.calls).toEqual([
      [{ environmentId: "env-new" }],
    ]);
    expect(keyedQuery.refetch).not.toHaveBeenCalled();
  });

  it("re-checks GitHub when a cached row shows again, then refetches each time the page shows", async () => {
    keyedQuery.data = { "env-open": row("open") };
    renderHook(() => useEnvironmentPullRequest("env-open"));
    await settle();
    expect(keyedQuery.refresh).toHaveBeenCalledTimes(1);
    expect(keyedQuery.refetch).not.toHaveBeenCalled();

    await showPage();
    await showPage();
    expect(keyedQuery.refetch.mock.calls).toEqual([
      [["env-open"]],
      [["env-open"]],
    ]);
    expect(keyedQuery.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refetch while the page is hidden", async () => {
    keyedQuery.data = { "env-hidden": row("open") };
    renderHook(() => useEnvironmentPullRequest("env-hidden"));
    await settle();
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    try {
      await showPage();
      expect(keyedQuery.refetch).not.toHaveBeenCalled();
    } finally {
      visibility.mockRestore();
    }
  });

  it("re-checks only when an environment starts showing, not for each extra view", async () => {
    keyedQuery.data = { "env-shared": row("open") };
    const banner = renderHook(() => useEnvironmentPullRequest("env-shared"));
    await settle();
    expect(keyedQuery.refresh).toHaveBeenCalledTimes(1);

    const infoRow = renderHook(() => useEnvironmentPullRequest("env-shared"));
    await settle();
    expect(keyedQuery.refresh).toHaveBeenCalledTimes(1);

    banner.unmount();
    infoRow.unmount();
    await settle();
    renderHook(() => useEnvironmentPullRequest("env-shared"));
    await settle();
    expect(keyedQuery.refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps an environment shown when its view remounts in one commit", async () => {
    keyedQuery.data = { "env-remount": row("open") };
    function View() {
      useEnvironmentPullRequest("env-remount");
      return null;
    }
    const { rerender } = render(<View key="thr_a" />);
    await settle();
    keyedQuery.refresh.mockClear();

    rerender(<View key="thr_b" />);
    await settle();
    expect(keyedQuery.refresh).not.toHaveBeenCalled();
  });
});
