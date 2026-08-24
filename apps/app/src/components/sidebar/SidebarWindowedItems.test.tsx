// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sidebarMocks = vi.hoisted(() => ({
  // Stands in for the context ref of a `SidebarContent` that is not rendered.
  // `null` hands the hook back to the real module, so a case that renders the
  // real `SidebarContent` reads the ref it actually provides.
  scrollElementRef: null as { current: HTMLDivElement | null } | null,
}));

vi.mock("@/components/ui/sidebar.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/sidebar.js")>();
  return {
    ...actual,
    useSidebarContentElementRef: () => {
      const contextRef = actual.useSidebarContentElementRef();
      return sidebarMocks.scrollElementRef ?? contextRef;
    },
  };
});

import {
  SIDEBAR_CONTENT_SELECTOR,
  SidebarContent,
} from "@/components/ui/sidebar.js";
import { SidebarWindowedItems } from "./SidebarWindowedItems";

// The hand-built container below has to carry the attribute the component
// walks up to. Parse it out of the exported selector instead of spelling it
// by hand, so a rename of `SIDEBAR_CONTENT_SELECTOR` in sidebar.tsx does not
// fail the same-commit case against a component that still works.
const selectorMatch = SIDEBAR_CONTENT_SELECTOR.match(/^\[([\w-]+)="(.+)"\]$/);
if (!selectorMatch) {
  throw new Error(
    `Unparseable SIDEBAR_CONTENT_SELECTOR: ${SIDEBAR_CONTENT_SELECTOR}`,
  );
}
const [, SIDEBAR_CONTENT_ATTR, SIDEBAR_CONTENT_VALUE] = selectorMatch;

const VIEWPORT_RECT = new DOMRect(0, 0, 300, 500);

// Rows sit 1000px down, well outside the 500px viewport plus its 240px margin.
const OFFSCREEN_ROW_RECT = new DOMRect(0, 1_000, 300, 30);

// A bare `SidebarContent`-shaped div: the attribute the component walks up
// to, with an explicit height because jsdom lays nothing out. Passed to
// `render` as the container, so RTL `cleanup()` removes it.
function mountSidebarContentContainer(clientHeight: number) {
  const container = document.createElement("div");
  container.setAttribute(SIDEBAR_CONTENT_ATTR, SIDEBAR_CONTENT_VALUE);
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  document.body.appendChild(container);
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
  sidebarMocks.scrollElementRef = { current: scrollElement };

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
      if (this === scrollElement || this.matches(SIDEBAR_CONTENT_SELECTOR)) {
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
  sidebarMocks.scrollElementRef = null;
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
    sidebarMocks.scrollElementRef = { current: null };
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

  // The same-commit walk only works while `SidebarContent` keeps the
  // `SIDEBAR_CONTENT_SELECTOR` attribute on the element its context ref points
  // at, and while React still attaches that ref after this list's layout
  // effect. The hand-built container above asserts neither, so this case
  // mounts the real `SidebarContent` around the list in one render and checks
  // that the element the walk resolves is the one the ref lands on.
  it("windows rows under the real SidebarContent mounted in the same commit", () => {
    sidebarMocks.scrollElementRef = null;
    // jsdom reports 0 for every clientHeight, which is the promote-all
    // signal; give the real scroller a height so the walk can succeed.
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(
      function (this: Element) {
        return this.matches(SIDEBAR_CONTENT_SELECTOR) ? 500 : 0;
      },
    );

    const contentRef = createRef<HTMLDivElement>();
    const { container } = render(
      <SidebarContent ref={contentRef}>
        <SidebarWindowedItems
          itemKeys={["first", "second", "third"]}
          estimateRows={() => 1}
          getNavigationEntries={(index) => [
            { projectId: "proj_test", threadId: `thr_${index}` },
          ]}
          renderItem={(index) => (
            <span data-testid={`real-item-${index}`}>Real item {index}</span>
          )}
        />
      </SidebarContent>,
    );

    const scroller = container.querySelector(SIDEBAR_CONTENT_SELECTOR);
    expect(scroller).not.toBeNull();
    // `setContentRef` writes one node to both the forwarded ref and the
    // context ref, so this is the element the passive effect later uses as
    // the IntersectionObserver root. Both spies above key off the selector,
    // so without this check an attribute moved onto an inner wrapper still
    // looks like a 500px scrollport here while in a browser that wrapper is
    // content-sized: every row is realized, then the observer rooted at the
    // real scroller demotes them again.
    expect(scroller).toBe(contentRef.current);
    expect(
      scroller?.querySelectorAll("[data-sidebar-windowed-item]"),
    ).toHaveLength(3);
    expect(screen.queryByTestId("real-item-0")).toBeNull();
    expect(
      document.querySelectorAll("[data-sidebar-windowed-nav]"),
    ).toHaveLength(3);
  });

  it("realizes every row when no scroll container can be found", () => {
    sidebarMocks.scrollElementRef = { current: null };

    renderList();

    expect(screen.getAllByTestId(/^real-item-/)).toHaveLength(3);
    expect(
      document.querySelectorAll("[data-sidebar-windowed-nav]"),
    ).toHaveLength(0);
  });

  it("keeps promote-all for a zero-height container", () => {
    sidebarMocks.scrollElementRef = { current: null };
    const container = mountSidebarContentContainer(0);

    renderList(container);

    expect(screen.getAllByTestId(/^real-item-/)).toHaveLength(3);
  });
});
