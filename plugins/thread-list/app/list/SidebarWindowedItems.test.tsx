// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SidebarOverflowScrollArea,
  SidebarScrollAreaProvider,
} from "../ui/sidebar.js";
import { SidebarWindowedItems } from "./SidebarWindowedItems.js";

const VIEWPORT_RECT = new DOMRect(0, 0, 300, 500);

const OFFSCREEN_ROW_RECT = new DOMRect(0, 1_000, 300, 30);

let scrollElement: HTMLDivElement;
interface FakeIntersectionObserver {
  callback: IntersectionObserverCallback;
  observed: Set<Element>;
}

const observerInstances: FakeIntersectionObserver[] = [];

function wrapperAt(index: number): Element {
  const wrapper = document.querySelectorAll("[data-sidebar-windowed-item]")[
    index
  ];
  if (!wrapper) {
    throw new Error(`No windowed wrapper at index ${index}`);
  }
  return wrapper;
}

function emitIntersections(
  entries: readonly {
    target: Element;
    isIntersecting: boolean;
    boundingClientRect?: DOMRectReadOnly;
  }[],
) {
  const observer = observerInstances.at(-1);
  if (!observer) {
    throw new Error("No IntersectionObserver was created");
  }
  observer.callback(
    entries.map(
      (entry) =>
        ({
          target: entry.target,
          isIntersecting: entry.isIntersecting,
          boundingClientRect: entry.boundingClientRect ?? OFFSCREEN_ROW_RECT,
        }) as unknown as IntersectionObserverEntry,
    ),
    observer as unknown as IntersectionObserver,
  );
}

function withScrollElement(element: HTMLElement, children: ReactNode) {
  return (
    <SidebarScrollAreaProvider scrollElement={element}>
      {children}
    </SidebarScrollAreaProvider>
  );
}

function HostScroller({ children }: { children: ReactNode }) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  return (
    <div ref={setElement} data-testid="host-scroller">
      {element === null ? null : withScrollElement(element, children)}
    </div>
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

function renderList(element: HTMLElement) {
  return render(withScrollElement(element, list()));
}

beforeEach(() => {
  scrollElement = document.createElement("div");
  Object.defineProperty(scrollElement, "clientHeight", {
    configurable: true,
    value: 500,
  });

  observerInstances.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      callback: IntersectionObserverCallback;
      observed = new Set<Element>();
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        observerInstances.push(this as unknown as FakeIntersectionObserver);
      }
      observe(element: Element) {
        this.observed.add(element);
      }
      unobserve(element: Element) {
        this.observed.delete(element);
      }
      disconnect() {
        this.observed.clear();
      }
    },
  );

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this === scrollElement) {
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
      withScrollElement(
        scrollElement,
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
      withScrollElement(
        scrollElement,
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
    renderList(scrollElement);

    expect(screen.queryByTestId("real-item-0")).toBeNull();
    expect(
      document.querySelectorAll("[data-sidebar-windowed-item]"),
    ).toHaveLength(3);
    expect(
      document.querySelectorAll("[data-sidebar-windowed-nav]"),
    ).toHaveLength(3);
  });

  it("windows against the host scroll element the list mounts inside", () => {
    const ONSCREEN_ROW_RECT = new DOMRect(0, 0, 300, 30);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === "host-scroller" ? 500 : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "host-scroller") {
          return VIEWPORT_RECT;
        }
        if (this.hasAttribute("data-sidebar-windowed-item")) {
          return this === wrapperAt(0) ? ONSCREEN_ROW_RECT : OFFSCREEN_ROW_RECT;
        }
        return new DOMRect();
      },
    );

    render(<HostScroller>{list()}</HostScroller>);

    expect(screen.getAllByTestId(/^real-item-/)).toHaveLength(1);
    expect(screen.getByTestId("real-item-0")).toBeDefined();
    expect(observerInstances).toHaveLength(1);
    expect(observerInstances[0]?.observed.size).toBe(3);
  });

  it("realizes every row without a list provider", () => {
    render(list());

    expect(screen.getAllByTestId(/^real-item-/)).toHaveLength(3);
  });

  it("keeps all overflow rows mounted when a portal opts out of sidebar windowing", () => {
    render(
      withScrollElement(
        scrollElement,
        createPortal(
          <SidebarOverflowScrollArea>
            <SidebarWindowedItems
              itemKeys={Array.from({ length: 40 }, (_, index) => `${index}`)}
              estimateRows={() => 1}
              renderItem={(index) => (
                <span data-testid={`overflow-item-${index}`}>
                  Thread {index}
                </span>
              )}
            />
          </SidebarOverflowScrollArea>,
          document.body,
        ),
      ),
    );

    expect(screen.getAllByTestId(/^overflow-item-/)).toHaveLength(40);
    expect(
      document.querySelectorAll("[data-sidebar-windowed-item]:empty"),
    ).toHaveLength(0);
  });

  it("keeps observer realizations when the item list changes in the same batch", () => {
    const ONSCREEN_ROW_RECT = new DOMRect(0, 0, 300, 30);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this === scrollElement) {
          return VIEWPORT_RECT;
        }
        if (this.hasAttribute("data-sidebar-windowed-item")) {
          const wrappers = [
            ...document.querySelectorAll("[data-sidebar-windowed-item]"),
          ];
          return wrappers.indexOf(this) < 2
            ? ONSCREEN_ROW_RECT
            : OFFSCREEN_ROW_RECT;
        }
        return new DOMRect();
      },
    );

    const tree = (itemKeys: readonly string[]) =>
      withScrollElement(
        scrollElement,
        <SidebarWindowedItems
          itemKeys={itemKeys}
          estimateRows={() => 1}
          renderItem={(index) => (
            <span data-testid={`real-${itemKeys[index]}`}>
              {itemKeys[index]}
            </span>
          )}
        />,
      );
    const { rerender } = render(tree(["a", "b", "c", "d"]));
    expect(screen.queryByTestId("real-a")).not.toBeNull();
    expect(screen.queryByTestId("real-d")).toBeNull();

    const offscreenWrapper = wrapperAt(3);
    act(() => {
      emitIntersections([{ target: offscreenWrapper, isIntersecting: true }]);
      rerender(tree(["a", "c", "d", "e"]));
    });

    expect(screen.queryByTestId("real-d")).not.toBeNull();
  });

  it("keeps realized rows mounted while the sidebar is hidden and unmounts them once scrolled away", () => {
    const realizeAll = () =>
      emitIntersections(
        Array.from(
          document.querySelectorAll("[data-sidebar-windowed-item]"),
          (target) => ({ target, isIntersecting: true }),
        ),
      );
    const leaveAll = (boundingClientRect: DOMRectReadOnly) =>
      emitIntersections(
        Array.from(
          document.querySelectorAll("[data-sidebar-windowed-item]"),
          (target) => ({ target, isIntersecting: false, boundingClientRect }),
        ),
      );
    renderList(scrollElement);
    act(realizeAll);
    expect(screen.getAllByTestId(/^real-item-/)).toHaveLength(3);

    act(() => leaveAll(new DOMRect()));
    expect(screen.getAllByTestId(/^real-item-/)).toHaveLength(3);

    act(() => leaveAll(OFFSCREEN_ROW_RECT));
    expect(screen.queryAllByTestId(/^real-item-/)).toHaveLength(0);
  });

  it("re-observes wrappers on list changes so a stuck placeholder self-heals", () => {
    const tree = (itemKeys: readonly string[]) =>
      withScrollElement(
        scrollElement,
        <SidebarWindowedItems
          itemKeys={itemKeys}
          estimateRows={() => 1}
          renderItem={(index) => (
            <span data-testid={`real-${itemKeys[index]}`}>
              {itemKeys[index]}
            </span>
          )}
        />,
      );
    const { rerender } = render(tree(["a", "b", "c"]));
    const observer = observerInstances.at(-1);
    expect(observer?.observed.size).toBe(3);
    const unobserve = vi.spyOn(IntersectionObserver.prototype, "unobserve");

    observer?.observed.clear();
    rerender(tree(["a", "b", "c", "d"]));

    expect(observer?.observed.size).toBe(4);
    expect(unobserve).not.toHaveBeenCalled();
  });

  it("connects the observer once a zero-height scroll container gains height", () => {
    const pendingLayoutElement = document.createElement("div");
    let clientHeight = 0;
    Object.defineProperty(pendingLayoutElement, "clientHeight", {
      configurable: true,
      get: () => clientHeight,
    });
    const resizeCallbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    renderList(pendingLayoutElement);
    expect(screen.queryAllByTestId(/^real-item-/)).toHaveLength(0);
    expect(observerInstances).toHaveLength(0);

    clientHeight = 500;
    act(() => {
      for (const callback of resizeCallbacks) {
        callback([], {} as ResizeObserver);
      }
    });

    expect(observerInstances).toHaveLength(1);
    expect(observerInstances[0]?.observed.size).toBe(3);

    act(() =>
      emitIntersections(
        Array.from(
          document.querySelectorAll("[data-sidebar-windowed-item]"),
          (target) => ({ target, isIntersecting: true }),
        ),
      ),
    );
    expect(screen.getAllByTestId(/^real-item-/)).toHaveLength(3);
  });

  it("mounts no rows while the scroll container has no height", () => {
    const collapsed = document.createElement("div");
    Object.defineProperty(collapsed, "clientHeight", {
      configurable: true,
      value: 0,
    });

    renderList(collapsed);

    expect(screen.queryAllByTestId(/^real-item-/)).toHaveLength(0);
    expect(
      document.querySelectorAll("[data-sidebar-windowed-item]"),
    ).toHaveLength(3);
  });
});
