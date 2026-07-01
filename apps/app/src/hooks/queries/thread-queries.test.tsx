// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ARCHIVED_THREADS_PAGE_SIZE } from "./archived-threads-page-size";
import {
  threadHostFilePreviewQueryKey,
  threadQueuedMessagesQueryKey,
} from "./query-keys";
import {
  useArchivedThreads,
  useThreadHostFilePreview,
  useThreadQueuedMessages,
} from "./thread-queries";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getThreadHostFilePreview: vi.fn(),
    listThreadQueuedMessages: vi.fn(),
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
  vi.mocked(api.listThreadQueuedMessages).mockResolvedValue([]);
  vi.mocked(api.getThreadHostFilePreview).mockResolvedValue({
    kind: "text",
    path: "/tmp/log.txt",
    url: "/api/v1/threads/thread-1/host-files/content?path=%2Ftmp%2Flog.txt",
    mimeType: "text/plain",
    content: "preview",
  });
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

describe("useThreadQueuedMessages", () => {
  it("refetches stale queue data on window focus", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();

    renderHook(() => useThreadQueuedMessages("thread-1"), { wrapper });

    await waitFor(() => {
      expect(api.listThreadQueuedMessages).toHaveBeenCalledTimes(1);
    });

    const query = queryClient.getQueryCache().find({
      queryKey: threadQueuedMessagesQueryKey("thread-1"),
    });

    expect(query?.options).toEqual(
      expect.objectContaining({
        refetchOnMount: true,
        refetchOnWindowFocus: true,
      }),
    );
  });
});

describe("useThreadHostFilePreview", () => {
  it("refetches stale host file previews on focus and reconnect", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();

    renderHook(
      () => useThreadHostFilePreview("thread-1", "env-1", "/tmp/log.txt"),
      { wrapper },
    );

    await waitFor(() => {
      expect(api.getThreadHostFilePreview).toHaveBeenCalledTimes(1);
    });

    const query = queryClient.getQueryCache().find({
      queryKey: threadHostFilePreviewQueryKey(
        "thread-1",
        "env-1",
        "/tmp/log.txt",
      ),
    });

    expect(query?.options).toEqual(
      expect.objectContaining({
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
      }),
    );
  });
});
