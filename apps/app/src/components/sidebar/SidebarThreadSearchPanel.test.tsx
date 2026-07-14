// @vitest-environment jsdom

import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import type {
  ThreadSearchMatch,
  ThreadSearchResponse,
} from "@bb/server-contract";
import {
  useThreadSearch,
  type UseThreadSearchResult,
} from "@/hooks/queries/thread-queries";
import { isThreadSearchKeyboardEventTarget } from "./AppSidebar";
import { ProjectListActionButtons } from "./ProjectList";
import { SidebarThreadSearchPanel } from "./SidebarThreadSearchPanel";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  getSidebarThreadSearchOptionId,
  haveSameSidebarThreadSearchNavigationItems,
  type SidebarThreadSearchNavigationItem,
} from "./sidebarThreadSearch";

vi.mock("@/hooks/queries/thread-queries", () => ({
  hasThreadSearchableQuery: (value: string) =>
    value.replace(/\s/g, "").length >= 2,
  useThreadSearch: vi.fn(),
}));

const mockUseThreadSearch = vi.mocked(useThreadSearch);

function createThreadListEntry({
  folderId = null,
  id,
  title,
}: {
  folderId?: string | null;
  id: string;
  title: string;
}): ThreadListEntry {
  return {
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    archivedAt: null,
    childOrigin: null,
    createdAt: 1000,
    deletedAt: null,
    environmentBranchName: null,
    environmentHostId: null,
    environmentId: null,
    environmentName: null,
    environmentWorkspaceDisplayKind: "other",
    hasPendingInteraction: false,
    id,
    lastReadAt: null,
    latestAttentionAt: 1000,
    originKind: null,
    originPluginId: null,
    parentThreadId: null,
    pinSortKey: null,
    pinnedAt: null,
    projectId: "proj_search",
    providerId: "codex",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    sourceThreadId: null,
    status: "idle",
    title,
    titleFallback: null,
    folderId,
    updatedAt: 1000,
  };
}

function createSearchResponse(
  thread: ThreadListEntry,
  matches: readonly ThreadSearchMatch[] = [],
): ThreadSearchResponse {
  return {
    active: {
      results: [
        {
          matches: [...matches],
          thread,
        },
      ],
      total: 1,
    },
    archived: {
      results: [],
      total: 0,
    },
  };
}

function mockThreadSearch(result: UseThreadSearchResult): void {
  mockUseThreadSearch.mockReturnValue(result);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("SidebarThreadSearchPanel", () => {
  it("clears stale search rows while the visible query is debouncing", () => {
    mockThreadSearch({
      data: createSearchResponse(
        createThreadListEntry({
          id: "thr_previous",
          title: "Previous needle",
        }),
      ),
      debouncedQuery: "needle",
      hasSearchableQuery: true,
      isDebouncing: true,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    render(
      <SidebarThreadSearchPanel
        activeIndex={0}
        isRecentsLoading={false}
        onActiveIndexChange={vi.fn()}
        onNavigationItemsChange={vi.fn()}
        onSelect={vi.fn()}
        projectNamesById={new Map()}
        query="needle updated"
        recentThreads={[]}
      />,
    );

    expect(screen.getByText("Searching threads...")).not.toBeNull();
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("uses a stable option id and scrolls the active search row into view", () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const thread = createThreadListEntry({
      id: "thr_current",
      title: "Current needle",
    });
    const optionId = getSidebarThreadSearchOptionId("active:thr_current");
    mockThreadSearch({
      data: createSearchResponse(thread),
      debouncedQuery: "needle",
      hasSearchableQuery: true,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    render(
      <SidebarThreadSearchPanel
        activeIndex={0}
        isRecentsLoading={false}
        onActiveIndexChange={vi.fn()}
        onNavigationItemsChange={vi.fn()}
        onSelect={vi.fn()}
        projectNamesById={new Map()}
        query="needle"
        recentThreads={[]}
      />,
    );

    expect(screen.getByRole("option").id).toBe(optionId);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("shows folder metadata instead of project metadata in folder mode", () => {
    const thread = createThreadListEntry({
      folderId: "fld_ci",
      id: "thr_folder",
      title: "CI cleanup",
    });
    mockThreadSearch({
      data: createSearchResponse(thread),
      debouncedQuery: "needle",
      hasSearchableQuery: true,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    render(
      <SidebarThreadSearchPanel
        activeIndex={0}
        folderNamesById={new Map([["fld_ci", "Infra / CI"]])}
        isRecentsLoading={false}
        onActiveIndexChange={vi.fn()}
        onNavigationItemsChange={vi.fn()}
        onSelect={vi.fn()}
        projectNamesById={new Map([["proj_search", "Search project"]])}
        query="needle"
        recentThreads={[]}
        showFolderLabels
      />,
    );

    const rowText = screen.getByRole("option").textContent ?? "";
    expect(rowText).toContain("Infra / CI");
    expect(rowText).not.toContain("Search project");
  });

  it("shows overflow counts for capped archived search results", () => {
    const archivedThread = createThreadListEntry({
      id: "thr_archived",
      title: "Archived cleanup",
    });
    mockThreadSearch({
      data: {
        active: {
          results: [],
          total: 0,
        },
        archived: {
          results: [
            {
              matches: [],
              thread: archivedThread,
            },
          ],
          total: 3,
        },
      },
      debouncedQuery: "cleanup",
      hasSearchableQuery: true,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    render(
      <SidebarThreadSearchPanel
        activeIndex={0}
        isRecentsLoading={false}
        onActiveIndexChange={vi.fn()}
        onNavigationItemsChange={vi.fn()}
        onSelect={vi.fn()}
        projectNamesById={new Map()}
        query="cleanup"
        recentThreads={[]}
      />,
    );

    expect(screen.getByText("Archived")).not.toBeNull();
    expect(screen.getByText("1/3")).not.toBeNull();
  });
});

describe("sidebar thread search navigation items", () => {
  it("treats rows with different message matches as different items", () => {
    const optionId = getSidebarThreadSearchOptionId("active:thr_search");
    const baseItem: SidebarThreadSearchNavigationItem = {
      id: "active:thr_search",
      optionId,
      projectId: "proj_search",
      threadId: "thr_search",
      messageSeq: 3,
    };

    expect(
      haveSameSidebarThreadSearchNavigationItems(
        [baseItem],
        [
          {
            ...baseItem,
            messageSeq: 7,
          },
        ],
      ),
    ).toBe(false);
  });
});

describe("ProjectListActionButtons", () => {
  it("shows the compose pane position when New thread is open in a split", () => {
    const store = createStore();
    store.set(splitLayoutAtom, {
      focusedPaneId: "pane-thread",
      root: {
        type: "split",
        dir: "row",
        sizes: [0.5, 0.5],
        children: [
          {
            type: "pane",
            paneId: "pane-compose",
            content: { kind: "new-thread" },
          },
          {
            type: "pane",
            paneId: "pane-thread",
            content: {
              kind: "thread",
              projectId: "proj_test",
              threadId: "thr_test",
            },
          },
        ],
      },
    });

    render(
      <Provider store={store}>
        <ProjectListActionButtons
          splitEnabled
          onNewChat={vi.fn()}
          newThreadSplit={{ openInSplit: vi.fn() }}
        />
      </Provider>,
    );

    expect(
      screen.getByRole("img", { name: "New thread — open in split" }),
    ).not.toBeNull();
  });

  it("exposes the active search option on the combobox input", () => {
    const inputRef = createRef<HTMLInputElement>();

    render(
      <ProjectListActionButtons
        onNewChat={vi.fn()}
        threadSearch={{
          activeDescendantId: "active-option",
          inputRef,
          isActive: true,
          onActivate: vi.fn(),
          onClose: vi.fn(),
          onQueryChange: vi.fn(),
          query: "needle",
        }}
      />,
    );

    expect(
      screen.getByRole("combobox").getAttribute("aria-activedescendant"),
    ).toBe("active-option");
  });

  it("labels the search close button as a close-and-clear action when a query exists", () => {
    const inputRef = createRef<HTMLInputElement>();

    render(
      <ProjectListActionButtons
        onNewChat={vi.fn()}
        threadSearch={{
          activeDescendantId: undefined,
          inputRef,
          isActive: true,
          onActivate: vi.fn(),
          onClose: vi.fn(),
          onQueryChange: vi.fn(),
          query: "needle",
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Clear and close search" }),
    ).not.toBeNull();
  });
});

describe("AppSidebar thread search keyboard routing", () => {
  it("handles search keys only from the input or search options", () => {
    const input = document.createElement("input");
    const closeButton = document.createElement("button");
    const option = document.createElement("button");
    const optionLabel = document.createElement("span");
    option.setAttribute("role", "option");
    option.append(optionLabel);

    expect(isThreadSearchKeyboardEventTarget(input, input)).toBe(true);
    expect(isThreadSearchKeyboardEventTarget(option, input)).toBe(true);
    expect(isThreadSearchKeyboardEventTarget(optionLabel, input)).toBe(true);
    expect(isThreadSearchKeyboardEventTarget(closeButton, input)).toBe(false);
  });
});
