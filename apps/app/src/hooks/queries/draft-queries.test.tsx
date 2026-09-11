// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { draftContentSchema, type Draft } from "@bb/server-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { listDraftResources } from "@/lib/drafts/resource-api";
import { allDraftQueryKeyPrefix } from "./query-keys";
import { useDrafts } from "./draft-queries";

vi.mock("@/lib/drafts/resource-api", () => ({
  draftResourceListQueryKey: (query: object) => ["drafts", "list", query],
  listDraftResources: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const saved: Draft = {
  id: "drf_savedfixture",
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  content: draftContentSchema.parse({ prompt: { text: "Saved draft" } }),
};

describe("useDrafts", () => {
  it("does not read drafts when disabled", () => {
    const { wrapper } = createQueryClientTestHarness();
    renderHook(() => useDrafts({}, { enabled: false }), { wrapper });
    expect(listDraftResources).not.toHaveBeenCalled();
  });

  it("uses server pagination and refreshes under the shared realtime invalidation prefix", async () => {
    vi.mocked(listDraftResources)
      .mockResolvedValueOnce({ drafts: [saved], nextOffset: 12 })
      .mockResolvedValueOnce({ drafts: [], nextOffset: null })
      .mockResolvedValue({ drafts: [saved], nextOffset: null });
    const { wrapper, queryClient } = createQueryClientTestHarness();
    const { result } = renderHook(() => useDrafts({ query: "Saved" }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listDraftResources).toHaveBeenNthCalledWith(
      1,
      { query: "Saved", limit: "50", offset: "0" },
      expect.any(AbortSignal),
    );
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(listDraftResources).toHaveBeenNthCalledWith(
      2,
      { query: "Saved", limit: "50", offset: "12" },
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: allDraftQueryKeyPrefix(),
      });
    });
    expect(listDraftResources).toHaveBeenCalledTimes(3);
    queryClient.clear();
  });
});
