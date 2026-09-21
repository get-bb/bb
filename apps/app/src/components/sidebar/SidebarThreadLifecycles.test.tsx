// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadArchiveFilter } from "@/lib/thread-lifecycle-filter";
import {
  buildMachineThreadGroups,
  buildPinnedSidebarState,
  buildProjectThreadGroups,
  buildSectionThreadList,
  buildSidebarEntitySectionId,
} from "@bb/client-core";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { SidebarThreadLifecycles, useSidebarThreadLifecycles } from "./SidebarThreadLifecycles";
import { SidebarHeaderControls } from "./SidebarHeaderControls";
import { ChronologicalSectionThreadSections } from "./ProjectRow";
import { sidebarThreadLifecyclesAtom } from "./sidebarCollapsedAtoms";

const archiveQuery = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  enabled: false,
  empty: false,
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useArchivedThreads: (_filters: object, { enabled }: { enabled: boolean }) => {
    archiveQuery.enabled = enabled;
    return {
      data: {
        pages: archiveQuery.empty
          ? [[]]
          : [
              [
                makeThreadListEntry({
                  id: "archived-thread",
                  title: "Archived work",
                  archivedAt: 1,
                  projectId: "archive-project",
                  sectionId: "archive-section",
                  environmentId: "archive-environment",
                  environmentHostId: "archive-host",
                  pinnedAt: 1,
                  pinSortKey: "a0",
                }),
              ],
            ],
      },
      isFetching: false,
      isLoadingError: false,
      error: null,
      hasNextPage: true,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      fetchNextPage: archiveQuery.fetchNextPage,
    };
  },
}));

vi.mock("@/hooks/useServerConnectionState", () => ({
  useServerConnectionState: () => "connected",
}));
vi.mock("@/hooks/useThreadSplitsEnabled", () => ({
  useThreadSplitsEnabled: () => false,
}));
vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftHasInput: () => false,
  usePromptDraftInputThreadIds: () => new Set(),
}));
vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    renameThread: vi.fn(),
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    archiveThreadAndChildren: vi.fn(),
    unarchiveThread: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function LifecycleContents({ empty }: { empty: boolean }) {
  const lifecycles = useSidebarThreadLifecycles(empty ? [] : [
    makeThreadListEntry({ id: "active-thread", title: "Active work" }),
    makeThreadListEntry({
      id: "old-draft",
      title: "Saved work",
      status: "pending",
      createdAt: 1,
      updatedAt: 1,
    }),
  ]);
  return (
    <SidebarThreadLifecycles
      lifecycles={lifecycles}
      treeProps={{
        compareThreads: () => 0,
        collapsedThreadIds: new Set(),
        collapsedEnvironmentIds: new Set(),
        onToggleThreadCollapsed: vi.fn(),
        onToggleEnvironmentCollapsed: vi.fn(),
      }}
    >
      <ChronologicalSectionThreadSections
        threadListState={{
          status: "ready",
          threads: lifecycles.threads,
        }}
        compareThreads={() => 0}
        sections={lifecycles.threads.some((thread) => thread.sectionId === "archive-section")
          ? [{ id: "archive-section", name: "Review" }]
          : []}
        collapsedThreadIds={new Set()}
        collapsedEnvironmentIds={new Set()}
        onToggleThreadCollapsed={vi.fn()}
        onToggleEnvironmentCollapsed={vi.fn()}
        topLevelSectionOrder={[
          "threads",
          buildSidebarEntitySectionId("section", "archive-section"),
        ]}
        fullSectionOrder={[
          "threads",
          buildSidebarEntitySectionId("section", "archive-section"),
        ]}
        onTopLevelSectionOrderChange={vi.fn()}
        pinnedReorderPending={false}
        pinnedThreads={[]}
        onReorderPinnedThread={vi.fn()}
        builtInSections={{
          collapsedSectionIds: new Set(),
          onToggleCollapsed: vi.fn(),
          pinned: { label: "Pinned", content: null },
          threads: {
            label: "Threads",
            actions: <SidebarHeaderControls label="Threads" />,
          },
        }}
      />
    </SidebarThreadLifecycles>
  );
}

function setup(lifecycles: ThreadArchiveFilter[] = ["active"], empty = false) {
  archiveQuery.empty = empty;
  const store = createStore();
  store.set(sidebarThreadLifecyclesAtom, lifecycles);
  render(
    <Provider store={store}>
      <TooltipProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <LifecycleContents empty={empty} />
          </MemoryRouter>
        </QueryClientProvider>
      </TooltipProvider>
    </Provider>,
  );
  return store;
}

describe("sidebar lifecycle placement", () => {
  it("merges selected rows once and preserves archived hierarchy metadata", () => {
    archiveQuery.empty = false;
    const store = createStore();
    store.set(sidebarThreadLifecyclesAtom, ["active", "archived"]);
    const active = makeThreadListEntry({ id: "active" });
    const duplicate = makeThreadListEntry({ id: "archived-thread" });
    const draft = makeThreadListEntry({ id: "draft" });
    const client = new QueryClient();
    const { result, rerender } = renderHook(
      ({ bootstrap }) => useSidebarThreadLifecycles(bootstrap),
      {
        initialProps: { bootstrap: [active, duplicate, draft] },
        wrapper: ({ children }) => (
          <Provider store={store}>
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
          </Provider>
        ),
      },
    );
    expect(result.current.threads).toEqual([duplicate, active, draft]);
    rerender({ bootstrap: [active, draft] });
    expect(result.current.threads[0]).toMatchObject({
      id: "archived-thread",
      projectId: "archive-project",
      sectionId: "archive-section",
      environmentId: "archive-environment",
      environmentHostId: "archive-host",
      pinnedAt: 1,
      pinSortKey: "a0",
    });
    const archived = result.current.threads[0]!;
    expect(buildPinnedSidebarState({ threads: result.current.threads }).rootNodes)
      .toMatchObject([{ thread: archived }]);
    expect(buildProjectThreadGroups([archived]))
      .toMatchObject([{ kind: "thread", node: { thread: archived } }]);
    expect(buildMachineThreadGroups([archived], []))
      .toMatchObject([{ key: "archive-host", threads: [archived] }]);
    expect(buildSectionThreadList([archived], () => 0, [
      { id: "archive-section", name: "Review" },
    ])).toMatchObject([{
      kind: "section",
      group: { id: "archive-section", items: [{ kind: "thread", node: { thread: archived } }] },
    }]);
    act(() => store.set(sidebarThreadLifecyclesAtom, ["active"]));
    expect(result.current.threads).toEqual([active, draft]);
  });

  it.each<{ lifecycles: ThreadArchiveFilter[]; active: boolean; archived: boolean }>([
    { lifecycles: ["active"], active: true, archived: false },
    { lifecycles: ["archived"], active: false, archived: true },
    { lifecycles: ["active", "archived"], active: true, archived: true },
  ])("includes saved messages in the ordinary hierarchy for $lifecycles", ({ lifecycles, active, archived }) => {
    setup(lifecycles);
    expect(screen.queryByText("Active work") !== null).toBe(active);
    expect(screen.queryByText("Saved work") !== null).toBe(active);
    expect(screen.queryByText("Archived work") !== null).toBe(archived);
    expect(screen.queryByRole("region", { name: "Drafts" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Drafts" })).toBeNull();
    expect(archiveQuery.enabled).toBe(archived);
  });

  it.each([false, true])(
    "uses the existing hierarchy menu without an Active header (empty=%s)",
    async (empty) => {
      setup(["active"], empty);
      expect(screen.queryByRole("heading", { name: "Active" })).toBeNull();
      expect(screen.queryByRole("region", { name: "Active" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: /^Active actions/ }),
      ).toBeNull();
      expect(
        screen.getByText(empty ? "No threads" : "Active work"),
      ).toBeTruthy();
      fireEvent.keyDown(
        screen.getByRole("button", { name: /^Threads actions(?:;|$)/ }),
        { key: "Enter" },
      );
      expect(
        await screen.findByRole("menuitem", { name: "Filter" }),
      ).toBeTruthy();
    },
  );

  it(
    "keeps the combined menu reachable in an empty archived-only group",
    async () => {
      const store = setup(["archived"], true);
      expect(screen.getByText("No threads")).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: /Filter:/ }),
      ).toBeNull();
      fireEvent.keyDown(
        screen.getByRole("button", {
          name: "Threads actions",
        }),
        {
          key: "Enter",
        },
      );
      fireEvent.keyDown(
        await screen.findByRole("menuitem", { name: "Filter" }),
        {
          key: "ArrowRight",
        },
      );
      fireEvent.click(
        await screen.findByRole("menuitemcheckbox", { name: "Active" }),
      );
      expect(store.get(sidebarThreadLifecyclesAtom)).toEqual([
        "active",
        "archived",
      ]);
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Archived" }));
      expect(store.get(sidebarThreadLifecyclesAtom)).toEqual(["active"]);
      expect(screen.getByText("No threads")).toBeTruthy();
      for (const menu of screen.queryAllByRole("menu").reverse()) {
        fireEvent.keyDown(menu, { key: "Escape" });
      }
      const trigger = await screen.findByRole("button", {
        name: /^Threads actions(?:;|$)/,
      });
      fireEvent.keyDown(trigger, { key: "Enter" });
      expect(
        await screen.findByRole("menuitem", { name: "Filter" }),
      ).toBeTruthy();
    },
  );

  it("starts and stops archived paging when the synced preference changes", () => {
    const store = setup();
    expect(archiveQuery.enabled).toBe(false);
    act(() => store.set(sidebarThreadLifecyclesAtom, ["archived"]));
    expect(archiveQuery.enabled).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Load more archived threads" }),
    );
    expect(archiveQuery.fetchNextPage).toHaveBeenCalledOnce();
    act(() => store.set(sidebarThreadLifecyclesAtom, ["active"]));
    expect(archiveQuery.enabled).toBe(false);
    expect(screen.queryByText("Archived work")).toBeNull();
  });
});
