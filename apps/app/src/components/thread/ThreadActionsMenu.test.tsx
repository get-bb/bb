// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ThreadWithRuntime } from "@bb/domain";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createAppQueryClient } from "@/lib/query-client";
import { ThreadActionsProvider } from "./ThreadActionsProvider";
import { ThreadActionsMenu } from "./ThreadActionsMenu";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    archiveThreadAndChildren: vi.fn(),
    archiveThread: vi.fn(),
    deleteThread: vi.fn(),
    getThreadChildSummary: vi.fn(),
    markThreadRead: vi.fn(),
    markThreadUnread: vi.fn(),
    pinThread: vi.fn(),
    unarchiveThread: vi.fn(),
    unpinThread: vi.fn(),
    updateThread: vi.fn(),
  };
});

function makeThread(
  overrides: Partial<ThreadWithRuntime> = {},
): ThreadWithRuntime {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "environment-1",
    id: "thread-1",
    lastReadAt: null,
    latestAttentionAt: 10,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "project-1",
    providerId: "provider-1",
    stopRequestedAt: null,
    status: "idle",
    title: "Thread title",
    titleFallback: "Thread title",
    updatedAt: 10,
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

function renderMenu(thread: ThreadWithRuntime) {
  const queryClient = createAppQueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: Infinity, retry: false },
    },
  });

  return render(
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ThreadActionsProvider>
            <ThreadActionsMenu thread={thread} />
          </ThreadActionsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>,
  );
}

describe("ThreadActionsMenu", () => {
  it("archives threads and children from the archive action", async () => {
    const thread = makeThread();
    vi.mocked(api.archiveThreadAndChildren).mockResolvedValue({
      ok: true,
      archivedThreadIds: [thread.id, "child-1"],
    });
    renderMenu(thread);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      {
        button: 0,
        ctrlKey: false,
      },
    );

    const archiveAction = await screen.findByText("Archive");
    expect(screen.queryByText("Archive thread")).toBeNull();
    expect(screen.queryByText("Archive all")).toBeNull();

    fireEvent.click(archiveAction);

    await waitFor(() => {
      expect(api.archiveThreadAndChildren).toHaveBeenCalledWith(thread.id);
    });
    expect(api.archiveThread).not.toHaveBeenCalled();
  });
});
