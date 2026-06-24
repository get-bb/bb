// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ARCHIVED_THREADS_PAGE_SIZE } from "./archived-threads-page-size";
import { useArchivedThreads } from "./thread-queries";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listThreads: vi.fn(),
  };
});

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useThreadDetailRealtimeSubscription: vi.fn(),
  useThreadListRealtimeSubscription: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(api.listThreads).mockResolvedValue([]);
});

describe("useArchivedThreads", () => {
  it("omits projectId for folder-scoped archived lists", async () => {
    const { wrapper } = createQueryClientTestHarness();

    renderHook(() => useArchivedThreads({ folderId: "fld_work" }), { wrapper });

    await waitFor(() => {
      expect(api.listThreads).toHaveBeenCalled();
    });
    expect(vi.mocked(api.listThreads).mock.calls[0]?.[0]).toEqual({
      archived: true,
      folderId: "fld_work",
      limit: ARCHIVED_THREADS_PAGE_SIZE,
      offset: 0,
    });
  });

  it("keeps project scope for project archived lists", async () => {
    const { wrapper } = createQueryClientTestHarness();

    renderHook(() => useArchivedThreads({ projectId: "proj_1" }), {
      wrapper,
    });

    await waitFor(() => {
      expect(api.listThreads).toHaveBeenCalled();
    });
    expect(vi.mocked(api.listThreads).mock.calls[0]?.[0]).toEqual({
      archived: true,
      limit: ARCHIVED_THREADS_PAGE_SIZE,
      offset: 0,
      projectId: "proj_1",
    });
  });

  it("omits projectId for global loose archived lists", async () => {
    const { wrapper } = createQueryClientTestHarness();

    renderHook(() => useArchivedThreads({ unfiled: true }), { wrapper });

    await waitFor(() => {
      expect(api.listThreads).toHaveBeenCalled();
    });
    expect(vi.mocked(api.listThreads).mock.calls[0]?.[0]).toEqual({
      archived: true,
      limit: ARCHIVED_THREADS_PAGE_SIZE,
      offset: 0,
      unfiled: true,
    });
  });
});
