// @vitest-environment jsdom

import { createRef, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ThreadListEntry } from "@bb/domain";
import type { ThreadSearchResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { ProjectListActionButtons } from "./ProjectList";
import { SidebarThreadSearchPanel } from "./SidebarThreadSearchPanel";

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentBranchName: null,
    environmentHostId: null,
    environmentId: null,
    environmentName: null,
    environmentWorkspaceDisplayKind: "other",
    hasPendingInteraction: false,
    id: "thread-1",
    lastReadAt: null,
    latestAttentionAt: 1,
    parentThreadId: null,
    pinnedAt: null,
    pinSortKey: null,
    projectId: "project-1",
    providerId: "codex",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    status: "idle",
    stopRequestedAt: null,
    title: "Thread title",
    titleFallback: "Thread title",
    updatedAt: 1,
    ...overrides,
  };
}

function renderWithQueryClient(children: ReactNode): void {
  const harness = createQueryClientTestHarness();
  render(children, { wrapper: harness.wrapper });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("sidebar thread search actions", () => {
  it("renders the search affordance without adding a New thread tooltip and morphs into an input", () => {
    const inputRef = createRef<HTMLInputElement | null>();
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const onNewChat = vi.fn();
    const onQueryChange = vi.fn();
    const { rerender } = render(
      <ProjectListActionButtons
        onNewChat={onNewChat}
        threadSearch={{
          inputRef,
          isActive: false,
          onActivate,
          onClose,
          onQueryChange,
          query: "",
        }}
      />,
    );

    const newThreadButton = screen.getByRole("button", {
      name: "New thread",
    });
    expect(newThreadButton.getAttribute("title")).toBeNull();
    const searchButton = screen.getByRole("button", {
      name: /Search threads/,
    });
    expect(searchButton.getAttribute("title")).toMatch(
      /^Search threads - (Cmd|Ctrl)\+K$/u,
    );
    fireEvent.click(searchButton);
    expect(onActivate).toHaveBeenCalledTimes(1);

    rerender(
      <ProjectListActionButtons
        onNewChat={onNewChat}
        threadSearch={{
          inputRef,
          isActive: true,
          onActivate,
          onClose,
          onQueryChange,
          query: "needle",
        }}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Search threads" });
    fireEvent.change(input, { target: { value: "updated" } });
    expect(onQueryChange).toHaveBeenCalledWith("updated");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onQueryChange).toHaveBeenCalledWith("");

    rerender(
      <ProjectListActionButtons
        onNewChat={onNewChat}
        threadSearch={{
          inputRef,
          isActive: true,
          onActivate,
          onClose,
          onQueryChange,
          query: "",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("SidebarThreadSearchPanel", () => {
  it("renders recent active threads for an empty query without searching", () => {
    const fetchMock = installFetchRoutes([
      {
        pathname: "/api/v1/threads/search",
        handler: () =>
          jsonResponse({
            active: { total: 0, results: [] },
            archived: { total: 0, results: [] },
          }),
      },
    ]);

    renderWithQueryClient(
      <SidebarThreadSearchPanel
        activeIndex={0}
        isRecentsLoading={false}
        onActiveIndexChange={vi.fn()}
        onNavigationItemsChange={vi.fn()}
        onSelect={vi.fn()}
        projectNamesById={new Map([["project-1", "Project One"]])}
        query=""
        recentThreads={[makeThread({ title: "Recent thread" })]}
      />,
    );

    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByRole("option", { name: /Recent thread/u })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders active and archived server results and selects rows", async () => {
    const activeThread = makeThread({
      id: "thread-active",
      title: "Active result",
    });
    const archivedThread = makeThread({
      archivedAt: 10,
      id: "thread-archived",
      title: "Archived result",
    });
    const response: ThreadSearchResponse = {
      active: {
        total: 1,
        results: [
          {
            thread: activeThread,
            matches: [
              {
                sourceKind: "user_message",
                text: "needle in active content",
                highlightRanges: [{ start: 0, end: 6 }],
              },
            ],
          },
        ],
      },
      archived: {
        total: 1,
        results: [
          {
            thread: archivedThread,
            matches: [
              {
                sourceKind: "assistant_message",
                text: "needle in archived content",
                highlightRanges: [{ start: 0, end: 6 }],
              },
            ],
          },
        ],
      },
    };
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/search",
        handler: () => jsonResponse(response),
      },
    ]);
    const onNavigationItemsChange = vi.fn();
    const onSelect = vi.fn();

    renderWithQueryClient(
      <SidebarThreadSearchPanel
        activeIndex={1}
        isRecentsLoading={false}
        onActiveIndexChange={vi.fn()}
        onNavigationItemsChange={onNavigationItemsChange}
        onSelect={onSelect}
        projectNamesById={new Map([["project-1", "Project One"]])}
        query="needle"
        recentThreads={[]}
      />,
    );

    expect(await screen.findByText("Active")).toBeTruthy();
    expect(screen.getAllByText("Archived")).toHaveLength(2);
    expect(screen.getByRole("option", { name: /Active result/u })).toBeTruthy();
    const archivedOption = screen.getByRole("option", {
      name: /Archived result/u,
    });
    expect(archivedOption.getAttribute("aria-selected")).toBe("true");
    await waitFor(() => {
      expect(onNavigationItemsChange).toHaveBeenCalledWith([
        {
          id: "active:thread-active",
          projectId: "project-1",
          threadId: "thread-active",
        },
        {
          id: "archived:thread-archived",
          projectId: "project-1",
          threadId: "thread-archived",
        },
      ]);
    });

    fireEvent.click(archivedOption);
    expect(onSelect).toHaveBeenCalledWith({
      id: "archived:thread-archived",
      projectId: "project-1",
      threadId: "thread-archived",
    });
  });
});
