// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadLifecycle } from "@bb/domain";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { SidebarThreadLifecycles } from "./SidebarThreadLifecycles";
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
                  lifecycle: "archived",
                  archivedAt: 1,
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

function setup(lifecycles: ThreadLifecycle[] = ["active"], empty = false) {
  archiveQuery.empty = empty;
  const store = createStore();
  store.set(sidebarThreadLifecyclesAtom, lifecycles);
  render(
    <Provider store={store}>
      <TooltipProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <SidebarThreadLifecycles
              status="ready"
              drafts={
                empty
                  ? []
                  : [
                      makeThreadListEntry({
                        id: "old-draft",
                        title: "Saved work",
                        lifecycle: "draft",
                        status: "pending",
                        createdAt: 1,
                        updatedAt: 1,
                      }),
                    ]
              }
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
                  threads: empty
                    ? []
                    : [makeThreadListEntry({ title: "Active work" })],
                }}
                compareThreads={() => 0}
                sections={[]}
                collapsedThreadIds={new Set()}
                collapsedEnvironmentIds={new Set()}
                onToggleThreadCollapsed={vi.fn()}
                onToggleEnvironmentCollapsed={vi.fn()}
                topLevelSectionOrder={["threads"]}
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
          </MemoryRouter>
        </QueryClientProvider>
      </TooltipProvider>
    </Provider>,
  );
  return store;
}

describe("sidebar lifecycle groups", () => {
  it.each<{ lifecycles: ThreadLifecycle[] }>(
    (
      [
        ["active"],
        ["draft"],
        ["archived"],
        ["active", "draft"],
        ["active", "archived"],
        ["draft", "archived"],
        ["active", "draft", "archived"],
      ] satisfies ThreadLifecycle[][]
    ).map((lifecycles) => ({ lifecycles })),
  )("shows only selected semantic groups for $lifecycles", ({ lifecycles }) => {
    setup(lifecycles);
    expect(screen.queryByText("Active work") !== null).toBe(
      lifecycles.includes("active"),
    );
    expect(screen.queryByText("Saved work") !== null).toBe(
      lifecycles.includes("draft"),
    );
    expect(screen.queryByText("Archived work") !== null).toBe(
      lifecycles.includes("archived"),
    );
    expect(
      screen.queryAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual(
      ["Drafts", "Archived"].filter((_, index) =>
        lifecycles.includes((["draft", "archived"] as const)[index]!),
      ),
    );
    expect(archiveQuery.enabled).toBe(lifecycles.includes("archived"));
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
        await screen.findByRole("menuitem", { name: "Filter threads" }),
      ).toBeTruthy();
    },
  );

  it.each(["draft", "archived"] as const)(
    "keeps the combined menu reachable in an empty %s-only group",
    async (lifecycle) => {
      const store = setup([lifecycle], true);
      expect(screen.getByText("No threads")).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: /Thread lifecycle:/ }),
      ).toBeNull();
      const label = lifecycle === "draft" ? "Drafts" : "Archived";
      fireEvent.keyDown(
        screen.getByRole("button", {
          name: new RegExp(`^${label} actions(?:;|$)`),
        }),
        {
          key: "Enter",
        },
      );
      fireEvent.keyDown(
        await screen.findByRole("menuitem", { name: "Filter threads" }),
        {
          key: "ArrowRight",
        },
      );
      fireEvent.click(
        await screen.findByRole("menuitemcheckbox", { name: "Active" }),
      );
      expect(store.get(sidebarThreadLifecyclesAtom)).toEqual([
        "active",
        lifecycle,
      ]);
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: label }));
      expect(store.get(sidebarThreadLifecyclesAtom)).toEqual(["active"]);
      expect(screen.getByText("No threads")).toBeTruthy();
      const trigger = screen.getByRole("button", {
        name: /^Threads actions(?:;|$)/,
      });
      fireEvent.keyDown(trigger, { key: "Enter" });
      expect(
        await screen.findByRole("menuitem", { name: "Filter threads" }),
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
    act(() => store.set(sidebarThreadLifecyclesAtom, ["draft"]));
    expect(archiveQuery.enabled).toBe(false);
    expect(screen.queryByText("Archived work")).toBeNull();
  });

  it("reuses the no-threads state for an empty selected group", () => {
    setup(["draft"], true);
    expect(screen.getByText("No threads")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Drafts" })).toBeDefined();
  });
});
