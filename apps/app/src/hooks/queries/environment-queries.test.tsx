// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ThreadPullRequest } from "@bb/domain";
import { CORE_TAG_SCOPE, invalidateTags } from "@bb/query-tags";
import {
  environmentPullRequestTag,
  type EnvironmentPullRequestResponse,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getEnvironmentPullRequestStaleTime,
  useEnvironmentMergeBaseBranches,
  useEnvironmentPullRequest,
} from "./environment-queries";

vi.mock("@/lib/sdk", () => ({
  sdk: { environments: { pullRequest: vi.fn(), diffBranches: vi.fn() } },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useEnvironmentDetailRealtimeSubscription: vi.fn(),
  useEnvironmentPullRequestRealtimeSubscription: vi.fn(),
}));

const ENVIRONMENT_ID = "env-1";
const ACTIVE_PULL_REQUEST_STALE_MS = 30_000;
const SETTLED_PULL_REQUEST_STALE_MS = 60 * 60_000;

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

  it("refreshes a cached closed PR when its row returns after missing a realtime update", async () => {
    const { wrapper } = createQueryClientTestHarness();
    const closed = pullRequestResponse({
      ...pullRequestFixture,
      state: "closed",
    });
    const reopened = pullRequestResponse(pullRequestFixture);
    vi.mocked(sdk.environments.pullRequest)
      .mockResolvedValueOnce(closed)
      .mockResolvedValueOnce(reopened);

    const first = renderHook(() => useEnvironmentPullRequest(ENVIRONMENT_ID), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.data).toEqual(closed));
    expect(first.result.current.isStale).toBe(false);
    first.unmount();

    const returned = renderHook(
      () => useEnvironmentPullRequest(ENVIRONMENT_ID),
      { wrapper },
    );
    await waitFor(() => expect(returned.result.current.data).toEqual(reopened));
    expect(sdk.environments.pullRequest).toHaveBeenCalledTimes(2);
  });

  it("refetches only the environment whose pull request tag the server invalidates", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const pending = pullRequestResponse({
      ...pullRequestFixture,
      checks: { ...pullRequestFixture.checks, state: "pending" },
    });
    const passing = pullRequestResponse(pullRequestFixture);
    vi.mocked(sdk.environments.pullRequest)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(passing);

    const { result } = renderHook(
      () => useEnvironmentPullRequest(ENVIRONMENT_ID),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toEqual(pending));

    await invalidateTags(queryClient, CORE_TAG_SCOPE, [
      environmentPullRequestTag("env-other"),
    ]);
    expect(sdk.environments.pullRequest).toHaveBeenCalledTimes(1);

    await invalidateTags(queryClient, CORE_TAG_SCOPE, [
      environmentPullRequestTag(ENVIRONMENT_ID),
    ]);
    await waitFor(() => expect(result.current.data).toEqual(passing));
    expect(sdk.environments.pullRequest).toHaveBeenCalledTimes(2);
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
