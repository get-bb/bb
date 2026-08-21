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
      if (this === scrollElement) {
        return new DOMRect(0, 0, 300, 500);
      }
      if (this.hasAttribute("data-sidebar-windowed-item")) {
        return new DOMRect(0, 1_000, 300, 30);
      }
      return new DOMRect();
    },
  );
});

afterEach(() => {
  cleanup();
  sidebarMocks.scrollElementRef.current = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SidebarWindowedItems", () => {
  it("windows a short list when every item is outside the viewport margin", () => {
    render(
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
    );

    expect(screen.queryByTestId("real-item-0")).toBeNull();
    expect(
      document.querySelectorAll("[data-sidebar-windowed-item]"),
    ).toHaveLength(3);
    expect(
      document.querySelectorAll("[data-sidebar-windowed-nav]"),
    ).toHaveLength(3);
  });
});
