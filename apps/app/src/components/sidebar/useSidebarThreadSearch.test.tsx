// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSidebarThreadSearchOptionId,
  type SidebarThreadSearchNavigationItem,
} from "./sidebarThreadSearch";
import {
  useSidebarThreadSearch,
  type SidebarThreadSearchController,
} from "./useSidebarThreadSearch";

function createNavigationItem(
  threadId: string,
): SidebarThreadSearchNavigationItem {
  return {
    id: `active:${threadId}`,
    optionId: getSidebarThreadSearchOptionId(`active:${threadId}`),
    projectId: "proj_search",
    threadId,
    messageSeq: null,
  };
}

const FIRST_ITEM = createNavigationItem("thr_first");
const SECOND_ITEM = createNavigationItem("thr_second");

function renderSearch() {
  const onOpenSidebar = vi.fn();
  const onOpenThread = vi.fn();
  const onThreadOpened = vi.fn();
  let controller: SidebarThreadSearchController | null = null;

  function Harness({
    onController,
  }: {
    onController: (next: SidebarThreadSearchController) => void;
  }) {
    const search = useSidebarThreadSearch({
      isPointerCoarse: false,
      onOpenSidebar,
      onOpenThread,
      onThreadOpened,
    });
    // Publish the controller of every render, so each assertion reads the
    // state the sidebar currently shows.
    useEffect(() => {
      onController(search);
    });
    const { inputRef, onKeyDown, onQueryChange, query } = search;
    return (
      <div onKeyDown={onKeyDown}>
        <input
          aria-label="Search threads"
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
      </div>
    );
  }

  render(
    <Harness
      onController={(next) => {
        controller = next;
      }}
    />,
  );

  const getController = () => {
    if (controller === null) {
      throw new Error("The search controller is not ready.");
    }
    return controller;
  };

  return { getController, onOpenSidebar, onOpenThread, onThreadOpened };
}

function openSearchWithResults(
  getController: () => SidebarThreadSearchController,
) {
  act(() => {
    getController().onActivate();
  });
  act(() => {
    getController().onQueryChange("needle");
  });
  act(() => {
    getController().onNavigationItemsChange([FIRST_ITEM, SECOND_ITEM]);
  });
}

function expectSearchIsReset(controller: SidebarThreadSearchController): void {
  expect(controller.isActive).toBe(false);
  expect(controller.query).toBe("");
  expect(controller.activeIndex).toBe(0);
  expect(controller.activeDescendantId).toBeUndefined();
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSidebarThreadSearch", () => {
  it("clears the search state after the keyboard opens a thread", () => {
    const { getController, onOpenThread } = renderSearch();
    openSearchWithResults(getController);
    const input = screen.getByLabelText("Search threads");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(getController().activeIndex).toBe(1);

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onOpenThread).toHaveBeenCalledWith(SECOND_ITEM);
    expectSearchIsReset(getController());
  });

  it("clears the search state after a pointer click opens a thread", () => {
    const { getController, onOpenThread, onThreadOpened } = renderSearch();
    openSearchWithResults(getController);

    act(() => {
      getController().onSelectItem(FIRST_ITEM);
    });

    expect(onOpenThread).toHaveBeenCalledWith(FIRST_ITEM);
    expect(onThreadOpened).toHaveBeenCalledTimes(1);
    expectSearchIsReset(getController());
  });

  // A plugin thread list filters by the host query and opens threads itself, so
  // its `onNavigate` must end search on every viewport, not only on mobile.
  it("clears the search state when a plugin thread list opens a thread", () => {
    const { getController, onOpenThread, onThreadOpened } = renderSearch();
    openSearchWithResults(getController);

    act(() => {
      getController().onExternalThreadOpen();
    });

    expect(onThreadOpened).toHaveBeenCalledTimes(1);
    expect(onOpenThread).not.toHaveBeenCalled();
    expectSearchIsReset(getController());
  });

  it("keeps search open when Escape only clears the query", () => {
    const { getController } = renderSearch();
    openSearchWithResults(getController);
    const input = screen.getByLabelText("Search threads");

    fireEvent.keyDown(input, { key: "Escape" });

    expect(getController().isActive).toBe(true);
    expect(getController().query).toBe("");

    fireEvent.keyDown(input, { key: "Escape" });

    expect(getController().isActive).toBe(false);
  });

  it("opens the sidebar when search activates", () => {
    const { getController, onOpenSidebar } = renderSearch();

    act(() => {
      getController().onActivate();
    });

    expect(onOpenSidebar).toHaveBeenCalledTimes(1);
    expect(getController().isActive).toBe(true);
  });
});
