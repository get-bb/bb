// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectSourceBranches } from "./project-queries";
import { projectSourceBranchesQueryKeyPrefix } from "./query-keys";

vi.mock("@/lib/sdk", () => ({
  sdk: { projects: { branches: vi.fn() } },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useProjectDetailRealtimeSubscription: vi.fn(),
}));

describe("useProjectSourceBranches", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not re-run the daemon branch RPC on window focus while the list is fresh", async () => {
    const { wrapper, queryClient } = createQueryClientTestHarness();
    vi.mocked(sdk.projects.branches).mockResolvedValue({
      branches: ["main"],
      branchesTruncated: false,
      checkout: { kind: "branch", branchName: "main", headSha: null },
      defaultBranch: "main",
      defaultBranchRelation: "equal",
      defaultWorktreeBaseBranch: null,
      hasUncommittedChanges: false,
      operation: { kind: "none" },
      originDefaultBranch: "main",
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: null,
    });

    renderHook(() => useProjectSourceBranches("project-1", "host-1"), {
      wrapper,
    });
    await waitFor(() => {
      expect(sdk.projects.branches).toHaveBeenCalledTimes(1);
    });

    const [query] = queryClient.getQueryCache().findAll({
      queryKey: projectSourceBranchesQueryKeyPrefix("project-1"),
    });
    expect(query?.options).toEqual(
      expect.objectContaining({
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      }),
    );
  });
});
