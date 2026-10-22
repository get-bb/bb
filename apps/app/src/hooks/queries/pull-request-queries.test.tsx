// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import type {
  EnvironmentPullRequest,
  PullRequest,
} from "bb-plugin-bb--github-pr-status/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isEnvironmentPullRequestStale,
  useEnvironmentPullRequest,
} from "./pull-request-queries";

const keyedQuery = vi.hoisted(() => ({
  data: {} as Record<string, EnvironmentPullRequest>,
  refetch: vi.fn(async () => {}),
}));

vi.mock("@/lib/plugin-sdk-hooks", () => ({
  experimental_useRpcKeyedQuery: () => ({
    data: keyedQuery.data,
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: keyedQuery.refetch,
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
  vi.useRealTimers();
  keyedQuery.refetch.mockClear();
  keyedQuery.data = {};
});

describe("isEnvironmentPullRequestStale", () => {
  it.each([
    ["open", row("open"), 30_000, false],
    ["open", row("open"), 30_001, true],
    ["draft", row("draft"), 30_001, true],
    ["absent", { outcome: "absent" } as const, 30_001, true],
    [
      "unavailable",
      { outcome: "unavailable", message: "Host is suspended" } as const,
      30_001,
      true,
    ],
    ["merged", row("merged"), 30_001, false],
    ["merged", row("merged"), 3_600_001, true],
    ["closed", row("closed"), 3_600_000, false],
    ["closed", row("closed"), 3_600_001, true],
  ])(
    "treats a %s row loaded %i ms ago as stale: %s",
    (_, value, age, stale) => {
      expect(isEnvironmentPullRequestStale(value, 0, age)).toBe(stale);
    },
  );
});

describe("useEnvironmentPullRequest refreshes", () => {
  it("refetches a cached row on mount and when the page shows after 30 s", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    keyedQuery.data = { "env-open": row("open") };
    renderHook(() => useEnvironmentPullRequest("env-open"));
    await settle();
    expect(keyedQuery.refetch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 20_000);
    await showPage();
    expect(keyedQuery.refetch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 15_000);
    await showPage();
    expect(keyedQuery.refetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a merged row for an hour before a visible page refetches it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    keyedQuery.data = { "env-merged": row("merged") };
    renderHook(() => useEnvironmentPullRequest("env-merged"));
    await settle();
    keyedQuery.refetch.mockClear();

    vi.setSystemTime(Date.now() + 10 * 60_000);
    await showPage();
    expect(keyedQuery.refetch).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + 51 * 60_000);
    await showPage();
    expect(keyedQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it("sends one refetch when many rows show at once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    keyedQuery.data = { "env-a": row("open"), "env-b": row("open") };
    renderHook(() => {
      useEnvironmentPullRequest("env-a");
      useEnvironmentPullRequest("env-b");
    });
    await settle();
    expect(keyedQuery.refetch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 31_000);
    await showPage();
    expect(keyedQuery.refetch).toHaveBeenCalledTimes(2);
  });

  it("does not refetch on mount before the row has loaded", async () => {
    renderHook(() => useEnvironmentPullRequest("env-new"));
    await settle();
    expect(keyedQuery.refetch).not.toHaveBeenCalled();
  });
});
