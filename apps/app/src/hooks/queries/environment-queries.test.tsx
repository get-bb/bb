// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ThreadPullRequest } from "@bb/domain";
import type { EnvironmentPullRequestResponse } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { environmentPullRequestQueryKey } from "./query-keys";
import {
  getEnvironmentPullRequestRefetchInterval,
  getEnvironmentPullRequestStaleTime,
  useEnvironmentMergeBaseBranches,
  useEnvironmentPullRequest,
} from "./environment-queries";

vi.mock("@/lib/sdk", () => ({
  sdk: { environments: { pullRequest: vi.fn(), diffBranches: vi.fn() } },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useEnvironmentDetailRealtimeSubscription: vi.fn(),
}));

const ENVIRONMENT_ID = "env-1";
const ACTIVE_PULL_REQUEST_STALE_MS = 30_000;
const SETTLED_PULL_REQUEST_STALE_MS = 60 * 60_000;
const ACTIVE_PULL_REQUEST_REFETCH_MS = 30_000;

const pullRequestFixture: ThreadPullRequest = {
  number: 128,
  title: "Refresh PR state",
  state: "open",
  url: "https://github.com/acme/bb/pull/128",
  baseRefName: "main",
  headRefName: "bb/pr-refresh",
  updatedAt: "2026-06-16T12:30:00Z",
  autoMerge: false,
  inMergeQueue: false,
  checks: {
    state: "passing",
    totalCount: 1,
    passedCount: 1,
    failedCount: 0,
    pendingCount: 0,
  },
  review: {
    state: "none",
    reviewRequestCount: 0,
  },
  mergeability: {
    state: "mergeable",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  },
  attention: "ready_to_merge",
};

function pullRequestResponse(
  pullRequest: ThreadPullRequest | null,
): EnvironmentPullRequestResponse {
  return pullRequest
    ? { outcome: "available", pullRequest }
    : { outcome: "absent" };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(sdk.environments.pullRequest).mockReset();
});

describe("useEnvironmentPullRequest", () => {
  it("keeps active and absent pull request data stale after 30 seconds", () => {
    expect(getEnvironmentPullRequestStaleTime(null)).toBe(
      ACTIVE_PULL_REQUEST_STALE_MS,
    );
    expect(getEnvironmentPullRequestStaleTime(undefined)).toBe(
      ACTIVE_PULL_REQUEST_STALE_MS,
    );
    expect(getEnvironmentPullRequestStaleTime(pullRequestFixture)).toBe(
      ACTIVE_PULL_REQUEST_STALE_MS,
    );
    expect(
      getEnvironmentPullRequestStaleTime({
        ...pullRequestFixture,
        state: "draft",
      }),
    ).toBe(ACTIVE_PULL_REQUEST_STALE_MS);
  });

  it("keeps closed and merged pull request data fresh longer", () => {
    expect(
      getEnvironmentPullRequestStaleTime({
        ...pullRequestFixture,
        state: "closed",
      }),
    ).toBe(SETTLED_PULL_REQUEST_STALE_MS);
    expect(
      getEnvironmentPullRequestStaleTime({
        ...pullRequestFixture,
        state: "merged",
      }),
    ).toBe(SETTLED_PULL_REQUEST_STALE_MS);
  });

  it("polls open pull requests while checks or mergeability are still settling", () => {
    expect(getEnvironmentPullRequestRefetchInterval(null)).toBe(false);
    expect(getEnvironmentPullRequestRefetchInterval(undefined)).toBe(false);
    expect(getEnvironmentPullRequestRefetchInterval(pullRequestFixture)).toBe(
      false,
    );
    expect(
      getEnvironmentPullRequestRefetchInterval({
        ...pullRequestFixture,
        checks: {
          ...pullRequestFixture.checks,
          state: "pending",
          pendingCount: 1,
        },
        attention: "checks_pending",
      }),
    ).toBe(ACTIVE_PULL_REQUEST_REFETCH_MS);
    expect(
      getEnvironmentPullRequestRefetchInterval({
        ...pullRequestFixture,
        mergeability: {
          state: "unknown",
          mergeStateStatus: "UNKNOWN",
          mergeable: "UNKNOWN",
        },
        attention: "none",
      }),
    ).toBe(ACTIVE_PULL_REQUEST_REFETCH_MS);
  });

  it.each([
    { autoMerge: true, inMergeQueue: false },
    { autoMerge: false, inMergeQueue: true },
  ])("keeps polling automated merges after checks pass: %j", (automation) => {
    expect(
      getEnvironmentPullRequestRefetchInterval({
        ...pullRequestFixture,
        ...automation,
      }),
    ).toBe(ACTIVE_PULL_REQUEST_REFETCH_MS);
    expect(
      getEnvironmentPullRequestRefetchInterval({
        ...pullRequestFixture,
        ...automation,
        state: "merged",
        attention: "merged",
      }),
    ).toBe(false);
  });

  it("does not poll draft or settled pull requests", () => {
    expect(
      getEnvironmentPullRequestRefetchInterval({
        ...pullRequestFixture,
        state: "draft",
        mergeability: {
          state: "draft",
          mergeStateStatus: "DRAFT",
          mergeable: "UNKNOWN",
        },
        attention: "draft",
      }),
    ).toBe(false);
    expect(
      getEnvironmentPullRequestRefetchInterval({
        ...pullRequestFixture,
        state: "closed",
        attention: "closed",
      }),
    ).toBe(false);
    expect(
      getEnvironmentPullRequestRefetchInterval({
        ...pullRequestFixture,
        state: "merged",
        attention: "merged",
      }),
    ).toBe(false);
  });

  it("refetches stale pull request data on mount and on window focus", async () => {
    const { wrapper, queryClient } = createQueryClientTestHarness();
    vi.mocked(sdk.environments.pullRequest).mockResolvedValue(
      pullRequestResponse(pullRequestFixture),
    );

    renderHook(() => useEnvironmentPullRequest(ENVIRONMENT_ID), { wrapper });

    await waitFor(() => {
      expect(sdk.environments.pullRequest).toHaveBeenCalledTimes(1);
    });

    const query = queryClient.getQueryCache().find({
      queryKey: environmentPullRequestQueryKey(ENVIRONMENT_ID),
    });

    expect(query?.options).toEqual(
      expect.objectContaining({
        refetchOnMount: true,
        refetchOnWindowFocus: true,
        refetchInterval: expect.any(Function),
        staleTime: expect.any(Function),
      }),
    );
  });
});

describe("useEnvironmentMergeBaseBranches", () => {
  it("only requests the query a typist settles on", async () => {
    const { wrapper } = createQueryClientTestHarness();
    vi.mocked(sdk.environments.diffBranches).mockResolvedValue({
      branches: ["main"],
      branchesTruncated: false,
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: null,
    });
    const { rerender } = renderHook(
      ({ query }: { query: string }) =>
        useEnvironmentMergeBaseBranches(ENVIRONMENT_ID, { query }),
      { wrapper, initialProps: { query: "" } },
    );
    await waitFor(() =>
      expect(sdk.environments.diffBranches).toHaveBeenCalledTimes(1),
    );

    for (const query of ["m", "ma", "mai"]) {
      rerender({ query });
    }
    rerender({ query: "main" });

    await waitFor(() =>
      expect(sdk.environments.diffBranches).toHaveBeenCalledWith(
        expect.objectContaining({ query: "main" }),
      ),
    );
    expect(sdk.environments.diffBranches).toHaveBeenCalledTimes(2);
  });
});
