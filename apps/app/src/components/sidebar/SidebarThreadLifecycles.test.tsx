// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadLifecycle } from "@bb/domain";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { SidebarThreadLifecycles } from "./SidebarThreadLifecycles";
import { sidebarThreadLifecyclesAtom } from "./sidebarCollapsedAtoms";

const archiveQuery = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  enabled: false,
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useArchivedThreads: (_filters: object, { enabled }: { enabled: boolean }) => {
    archiveQuery.enabled = enabled;
    return {
      data: {
        pages: [
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
  const store = createStore();
  store.set(sidebarThreadLifecyclesAtom, lifecycles);
  render(
    <Provider store={store}>
      <TooltipProvider>
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
            <div>Active hierarchy</div>
          </SidebarThreadLifecycles>
        </MemoryRouter>
      </TooltipProvider>
    </Provider>,
  );
  return store;
}

describe("sidebar lifecycle groups", () => {
  it.each<{ lifecycles: ThreadLifecycle[] }>(
    ([
      ["active"],
      ["draft"],
      ["archived"],
      ["active", "draft"],
      ["active", "archived"],
      ["draft", "archived"],
      ["active", "draft", "archived"],
    ] satisfies ThreadLifecycle[][]).map((lifecycles) => ({ lifecycles })),
  )("shows only selected semantic groups for $lifecycles", ({ lifecycles }) => {
    setup(lifecycles);
    expect(screen.queryByText("Active hierarchy") !== null).toBe(
      lifecycles.includes("active"),
    );
    expect(screen.queryByText("Saved work") !== null).toBe(
      lifecycles.includes("draft"),
    );
    expect(screen.queryByText("Archived work") !== null).toBe(
      lifecycles.includes("archived"),
    );
    expect(
      screen.getAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual(
      ["Active", "Drafts", "Archived"].filter((_, index) =>
        lifecycles.includes((["active", "draft", "archived"] as const)[index]!),
      ),
    );
    expect(archiveQuery.enabled).toBe(lifecycles.includes("archived"));
  });

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
