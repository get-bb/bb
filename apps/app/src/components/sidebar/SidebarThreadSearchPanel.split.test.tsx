// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useThreadSearch } from "@/hooks/queries/thread-queries";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { countPanes, type SplitLayout } from "@/lib/split-layout";
import { beginSplitDrag } from "@/lib/split-drag";
import { SidebarThreadSearchPanel } from "./SidebarThreadSearchPanel";

const mocks = vi.hoisted(() => ({ beginSplitDrag: vi.fn() }));

vi.mock("@/hooks/queries/thread-queries", () => ({
  hasThreadSearchableQuery: () => false,
  useThreadSearch: vi.fn(),
}));
vi.mock("@/lib/split-drag", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/split-drag")>()),
  beginSplitDrag: mocks.beginSplitDrag,
}));

const THREAD: ThreadListEntry = {
  activity: {
    activeWorkflowCount: 0,
    activeBackgroundAgentCount: 0,
    activeBackgroundCommandCount: 0,
    activePlanModeCount: 0,
    activeGoalCount: 0,
  },
  archivedAt: null,
  createdAt: 1,
  deletedAt: null,
  environmentBranchName: null,
  environmentHostId: null,
  environmentId: null,
  environmentName: null,
  environmentWorkspaceDisplayKind: "other",
  hasPendingInteraction: false,
  id: "thr_search",
  lastReadAt: null,
  latestAttentionAt: 1,
  originKind: null,
  originPluginId: null,
  visibility: "visible",
  parentThreadId: null,
  pinSortKey: null,
  pinnedAt: null,
  projectId: "proj_search",
  providerId: "codex",
  runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
  sectionId: null,
  sourceThreadId: null,
  status: "idle",
  title: "Search result",
  titleFallback: null,
  updatedAt: 1,
};

function onePaneLayout(): SplitLayout {
  return {
    focusedPaneId: "pane-current",
    root: {
      type: "pane",
      paneId: "pane-current",
      content: {
        kind: "thread",
        projectId: "proj_current",
        threadId: "thr_current",
      },
    },
  };
}

afterEach(() => {
  cleanup();
  mocks.beginSplitDrag.mockReset();
  vi.clearAllMocks();
});

describe("SidebarThreadSearchPanel split navigation", () => {
  it("preserves normal, modifier-click, and drag-to-split behavior", () => {
    vi.mocked(useThreadSearch).mockReturnValue({
      data: undefined,
      debouncedQuery: "",
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
      hasSearchableQuery: false,
    });
    const store = createStore();
    store.set(splitLayoutAtom, onePaneLayout());
    const onNavigate = vi.fn();
    const onSelect = vi.fn();
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <Provider store={store}>
          <MemoryRouter>
            <main />
            <SidebarThreadSearchPanel
              activeIndex={0}
              isRecentsLoading={false}
              onActiveIndexChange={vi.fn()}
              onNavigationItemsChange={vi.fn()}
              onNavigate={onNavigate}
              onSelect={onSelect}
              projectNamesById={new Map()}
              query=""
              recentThreads={[THREAD]}
              splitEnabled
            />
          </MemoryRouter>
        </Provider>
      </CompactViewportOverrideProvider>,
    );
    const row = screen.getByRole("option");

    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledOnce();

    fireEvent.click(row, { ctrlKey: true });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(countPanes(store.get(splitLayoutAtom)!.root)).toBe(2);

    store.set(splitLayoutAtom, onePaneLayout());
    onNavigate.mockClear();
    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10 });
    expect(mocks.beginSplitDrag).toHaveBeenCalledOnce();
    const drag = mocks.beginSplitDrag.mock.calls[0]?.[0] as Parameters<
      typeof beginSplitDrag
    >[0];
    drag.onDrop({ paneId: "pane-current", zone: "right" });
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(countPanes(store.get(splitLayoutAtom)!.root)).toBe(2);
  });
});
