// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sidebarMocks = vi.hoisted(() => ({
  scrollElementRef: { current: null as HTMLDivElement | null },
}));

vi.mock("@/components/ui/sidebar.js", () => ({
  useSidebarContentElementRef: () => sidebarMocks.scrollElementRef,
}));

import { SidebarWindowedItems } from "./SidebarWindowedItems";

const VIEWPORT_RECT = new DOMRect(0, 0, 300, 500);

// Rows sit 1000px down, well outside the 500px viewport plus its 240px margin.
const OFFSCREEN_ROW_RECT = new DOMRect(0, 1_000, 300, 30);

// Stands in for the `SidebarContent` div while its ref is still unattached.
let detachedContainer: HTMLDivElement | null = null;

function mountSidebarContentContainer(clientHeight: number) {
  const container = document.createElement("div");
  container.setAttribute("data-sidebar", "content");
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  document.body.appendChild(container);
  detachedContainer = container;
  return container;
}

function renderList(container?: HTMLElement) {
  return render(
    <SidebarWindowedItems
      itemKeys={["first", "second", "third"]}
      estimateRows={() => 1}
      getNavigationEntries={(index) => [
        { projectId: "proj_test", threadId: `thr_${index}` },
      ]}
      renderItem={(index) => (
        <span data-testid={`real-item-${index}`}>Real item {index}</span>
      )}
    />,
    container ? { container } : undefined,
  );
}

beforeEach(() => {
  const scrollElement = document.createElement("div");
  Object.defineProperty(scrollElement, "clientHeight", {
    configurable: true,
    value: 500,
  });
  sidebarMocks.scrollElementRef.current = scrollElement;

  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (
        this === scrollElement ||
        this.getAttribute("data-sidebar") === "content"
      ) {
        return VIEWPORT_RECT;
      }
      if (this.hasAttribute("data-sidebar-windowed-item")) {
        return OFFSCREEN_ROW_RECT;
      }
      return new DOMRect();
    },
  );
});

afterEach(() => {
  cleanup();
  detachedContainer?.remove();
  detachedContainer = null;
  sidebarMocks.scrollElementRef.current = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SidebarWindowedItems", () => {
  it("windows a short list when every item is outside the viewport margin", () => {
    renderList();

    expect(screen.queryByTestId("real-item-0")).toBeNull();
    expect(
      document.querySelectorAll("[data-sidebar-windowed-item]"),
    ).toHaveLength(3);
    expect(
      document.querySelectorAll("[data-sidebar-windowed-nav]"),
    ).toHaveLength(3);
  });

  // React attaches a host element's ref after its descendants' layout effects
  // have run, so a list that commits in the same pass as `SidebarContent`
  // sees an empty ref. It must find the scrollport through the DOM instead of
  // realizing every row and demoting them once the observer catches up.
  it("windows rows when the scroll container ref is not attached yet (same-commit mount)", () => {
    sidebarMocks.scrollElementRef.current = null;
    const container = mountSidebarContentContainer(500);

    renderList(container);

    expect(screen.queryByTestId("real-item-0")).toBeNull();
    expect(
      container.querySelectorAll("[data-sidebar-windowed-item]"),
    ).toHaveLength(3);
    expect(
      container.querySelectorAll("[data-sidebar-windowed-nav]"),
    ).toHaveLength(3);
  });

  it("realizes every row when no scroll container can be found", () => {
    sidebarMocks.scrollElementRef.current = null;

    renderList();

    expect(screen.getAllByTestId(/^real-item-/)).toHaveLength(3);
    expect(
      document.querySelectorAll("[data-sidebar-windowed-nav]"),
    ).toHaveLength(0);
  });

  it("keeps promote-all for a zero-height container", () => {
    sidebarMocks.scrollElementRef.current = null;
    const container = mountSidebarContentContainer(0);

    renderList(container);

    expect(screen.getAllByTestId(/^real-item-/)).toHaveLength(3);
  });
});
