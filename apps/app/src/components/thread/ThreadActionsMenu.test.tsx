// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { ThreadWithRuntime } from "@bb/domain";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { MACOS_WINDOW_NO_DRAG_CLASS } from "@/lib/bb-desktop";
import { createAppQueryClient } from "@/lib/query-client";
import { ThreadActionsProvider } from "./ThreadActionsProvider";
import { ThreadActionsMenu } from "./ThreadActionsMenu";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    archiveManagerThreads: vi.fn(),
    archiveThread: vi.fn(),
    deleteThread: vi.fn(),
    getThreadAssignedChildSummary: vi.fn(),
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
    type: "standard",
    updatedAt: 10,
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

interface RenderMenuOptions {
  triggerClassName?: string;
}

function renderMenu(
  thread: ThreadWithRuntime,
  options: RenderMenuOptions = {},
) {
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
            <ThreadActionsMenu
              thread={thread}
              showManagerArchiveAll
              triggerClassName={options.triggerClassName}
            />
          </ThreadActionsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>,
  );
}

describe("ThreadActionsMenu", () => {
  it("preserves caller-supplied trigger classes for header no-drag regions", () => {
    renderMenu(makeThread(), {
      triggerClassName: MACOS_WINDOW_NO_DRAG_CLASS,
    });

    expect(
      screen.getByRole("button", { name: "Thread actions" }).className,
    ).toContain(MACOS_WINDOW_NO_DRAG_CLASS);
  });

  it("shows manager-specific archive actions when requested", async () => {
    renderMenu(makeThread({ type: "manager" }));

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Manager actions" }),
      {
        button: 0,
        ctrlKey: false,
      },
    );

    expect(await screen.findByText("Archive Manager")).toBeTruthy();
    expect(screen.getByText("Archive All")).toBeTruthy();
  });
});
