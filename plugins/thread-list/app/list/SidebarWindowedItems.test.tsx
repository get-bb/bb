// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SIDEBAR_CONTENT_SELECTOR,
  SidebarContentElementContext,
  SidebarContentElementProvider,
} from "../ui/sidebar.js";
import { SidebarWindowedItems } from "./SidebarWindowedItems.js";

const selectorMatch = SIDEBAR_CONTENT_SELECTOR.match(/^\[([\w-]+)="(.+)"\]$/);
if (!selectorMatch) {
  throw new Error(
    `Unparseable SIDEBAR_CONTENT_SELECTOR: ${SIDEBAR_CONTENT_SELECTOR}`,
  );
}
const [, SIDEBAR_CONTENT_ATTR, SIDEBAR_CONTENT_VALUE] = selectorMatch;

const VIEWPORT_RECT = new DOMRect(0, 0, 300, 500);

const OFFSCREEN_ROW_RECT = new DOMRect(0, 1_000, 300, 30);

let scrollElement: HTMLDivElement;

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

function withScrollRef(
  ref: RefObject<HTMLElement | null>,
  children: ReactNode,
) {
  return (
    <SidebarContentElementContext.Provider value={ref}>
      {children}
    </SidebarContentElementContext.Provider>
  );
}

function list() {
  return (
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
  );
}

function renderList(
  ref: RefObject<HTMLElement | null>,
  container?: HTMLElement,
) {
  return render(
    withScrollRef(ref, list()),
    container ? { container } : undefined,
  );
}

beforeEach(() => {
  scrollElement = document.createElement("div");
  Object.defineProperty(scrollElement, "clientHeight", {
    configurable: true,
    value: 500,
  });

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SidebarWindowedItems", () => {
  it("mounts and focuses an offscreen item on request without refocusing on updates", () => {
    const tree = (focusItemKey?: string) =>
      withScrollRef(
        { current: scrollElement },
        <SidebarWindowedItems
          itemKeys={["first", "second", "third"]}
          focusItemKey={focusItemKey}
          estimateRows={() => 1}
          renderItem={(index) => (
            <a href="#thread" data-sidebar-thread-id={`thr_${index}`}>
              Thread {index}
            </a>
          )}
        />,
      );
    const { rerender } = render(tree());
    expect(screen.queryByText("Thread 1")).toBeNull();
    rerender(tree("second"));
    const target = screen.getByRole("link", { name: "Thread 1" });
    expect(document.activeElement).toBe(target);
    target.blur();
    rerender(tree("second"));
    expect(document.activeElement).not.toBe(target);
  });

  it("focuses a collapsed group disclosure when no thread link is rendered", () => {
    render(
      withScrollRef(
        { current: scrollElement },
        <SidebarWindowedItems
          itemKeys={["group"]}
          focusItemKey="group"
          estimateRows={() => 1}
          renderItem={() => <button aria-expanded={false}>Worktree</button>}
        />,
      ),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Worktree" }),
    );
  });

  it("windows a short list when every item is outside the viewport margin", () => {
    renderList({ current: scrollElement });

    expect(screen.queryByTestId("real-item-0")).toBeNull();
    expect(
      document.querySelectorAll("[data-sidebar-windowed-item]"),
    ).toHaveLength(3);
    expect(
      document.querySelectorAll("[data-sidebar-windowed-nav]"),
    ).toHaveLength(3);
  });

  it("windows rows when the scroll container ref is not attached yet (same-commit mount)", () => {
    const container = mountSidebarContentContainer(500);

    renderList({ current: null }, container);

    expect(screen.queryByTestId("real-item-0")).toBeNull();
    expect(
      container.querySelectorAll("[data-sidebar-windowed-item]"),
    ).toHaveLength(3);
    expect(
      container.querySelectorAll("[data-sidebar-windowed-nav]"),
    ).toHaveLength(3);
  });

  it("windows rows under the sidebar scroller resolved by the list provider", () => {
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(
      function (this: Element) {
        return this.matches(SIDEBAR_CONTENT_SELECTOR) ? 500 : 0;
      },
    );

    const { container } = render(
      <div data-sidebar="content">
        <SidebarContentElementProvider>{list()}</SidebarContentElementProvider>
      </div>,
    );

    const scroller = container.querySelector(SIDEBAR_CONTENT_SELECTOR);
    expect(scroller).not.toBeNull();
    expect(
      scroller?.querySelectorAll("[data-sidebar-windowed-item]"),
    ).toHaveLength(3);
    expect(screen.queryByTestId("real-item-0")).toBeNull();
    expect(
      document.querySelectorAll("[data-sidebar-windowed-nav]"),
    ).toHaveLength(3);
  });

  it("realizes every row when no scroll container can be found", () => {
    renderList({ current: null });

    expect(screen.getAllByTestId(/^real-item-/)).toHaveLength(3);
    expect(
      document.querySelectorAll("[data-sidebar-windowed-nav]"),
    ).toHaveLength(0);
  });

  it("realizes every row without a list provider", () => {
    render(list());

    expect(screen.getAllByTestId(/^real-item-/)).toHaveLength(3);
  });

  it("keeps all overflow rows mounted when a portal opts out of sidebar windowing", () => {
    render(
      withScrollRef(
        { current: scrollElement },
        createPortal(
          <SidebarContentElementContext.Provider value={null}>
            <SidebarWindowedItems
              itemKeys={Array.from({ length: 40 }, (_, index) => `${index}`)}
              estimateRows={() => 1}
              renderItem={(index) => (
                <span data-testid={`overflow-item-${index}`}>
                  Thread {index}
                </span>
              )}
            />
          </SidebarContentElementContext.Provider>,
          document.body,
        ),
      ),
    );

    expect(screen.getAllByTestId(/^overflow-item-/)).toHaveLength(40);
    expect(
      document.querySelectorAll("[data-sidebar-windowed-item]:empty"),
    ).toHaveLength(0);
  });

  it("keeps promote-all for a zero-height container", () => {
    const container = mountSidebarContentContainer(0);

    renderList({ current: null }, container);

    expect(screen.getAllByTestId(/^real-item-/)).toHaveLength(3);
  });
});
