// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { gitPluginReads } from "@/hooks/queries/git-plugin-reads";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEnvironmentMergeBaseBranches } from "./environment-queries";

vi.mock("@/hooks/queries/git-plugin-reads", () => ({
  gitPluginReads: { branches: vi.fn() },
  useGitPluginWatch: () => undefined,
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useEnvironmentDetailRealtimeSubscription: vi.fn(),
}));

const ENVIRONMENT_ID = "env-1";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useEnvironmentMergeBaseBranches", () => {
  it("only requests the query a typist settles on", async () => {
    const { wrapper } = createQueryClientTestHarness();
    vi.mocked(gitPluginReads.branches).mockResolvedValue({
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
      expect(gitPluginReads.branches).toHaveBeenCalledTimes(1),
    );

    for (const query of ["m", "ma", "mai"]) {
      rerender({ query });
    }
    rerender({ query: "main" });

    await waitFor(() =>
      expect(gitPluginReads.branches).toHaveBeenCalledWith(
        expect.objectContaining({ query: "main" }),
        expect.any(AbortSignal),
      ),
    );
    expect(gitPluginReads.branches).toHaveBeenCalledTimes(2);
  });
});
