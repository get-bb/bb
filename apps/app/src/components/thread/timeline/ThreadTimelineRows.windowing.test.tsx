// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { buildTimelineViewRows } from "@bb/thread-view";
import {
  BottomAnchorContext,
  type BottomAnchorContextValue,
} from "@/components/ui/bottom-anchored-scroll-body";
import {
  conversationRow,
  delegationRow,
} from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { collectSearchedMessageAncestorRowIds } from "./useScrollToSearchedMessage";

function rect(top: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 600,
    top,
    width: 600,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0];
  disconnect = vi.fn();
  observe = vi.fn();
  takeRecords = vi.fn(() => []);
  unobserve = vi.fn();
}

class ResizeObserverStub implements ResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

const nestedRows = Array.from({ length: 30 }, (_, index) =>
  conversationRow({
    id: `nested-${index}`,
    role: index % 2 === 0 ? "assistant" : "user",
    seq: index + 2,
    text: `Nested message ${index}`,
    turnId: `turn-${index}`,
  }),
);

function renderDelegation(timelineWindowingEnabled: boolean) {
  const queryClient = new QueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ThreadTimelineRows
          initialExpanded={new Set(["large-delegation"])}
          timelineRows={[
            delegationRow({
              childRows: nestedRows,
              id: "large-delegation",
              output: "",
              sourceSeqEnd: 31,
              sourceSeqStart: 1,
            }),
          ]}
          timelineWindowingEnabled={timelineWindowingEnabled}
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      if (this.hasAttribute("data-detail-scroll-area")) return 200;
      if (this.hasAttribute("data-test-main-scroll")) return 800;
      return 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      if (this.hasAttribute("data-detail-scroll-area")) return 200;
      if (this.hasAttribute("data-test-main-scroll")) return 800;
      return 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.hasAttribute("data-detail-scroll-area")) {
        return rect(0, 200);
      }
      if (this.hasAttribute("data-test-main-scroll")) {
        return rect(0, 800);
      }
      const rowId = this.dataset.timelineRowId;
      const match = rowId?.match(/^nested-(\d+)$/);
      if (match?.[1] !== undefined) {
        const index = Number(match[1]);
        return index < 4 ? rect(index * 40, 32) : rect(2_000, 32);
      }
      const searchMatch = rowId?.match(/^search-message-(\d+)$/);
      if (searchMatch?.[1] !== undefined) {
        return rect(Number(searchMatch[1]) * 100, 32);
      }
      return rect(0, 32);
    },
  );
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ThreadTimelineRows windowing experiment", () => {
  it("keeps the control timeline fully mounted", () => {
    const view = renderDelegation(false);
    const nestedList = view.container.querySelector(
      '[data-timeline-row-list="nested"]',
    );

    for (let index = 0; index < 30; index += 1) {
      expect(nestedList?.textContent).toContain(`Nested message ${index}`);
    }
  });

  it("windows the rows inside a large expanded detail", async () => {
    const view = renderDelegation(true);
    const detailScroll = view.container.querySelector<HTMLElement>(
      "[data-detail-scroll-area]",
    );

    expect(detailScroll?.clientHeight).toBe(200);
    await waitFor(() => {
      const nestedList = view.container.querySelector(
        '[data-timeline-row-list="nested"]',
      );
      const wrappers = nestedList?.querySelectorAll(
        ":scope > [data-timeline-virtual-spacer] > [data-timeline-row-id]",
      );
      expect(wrappers?.length).toBeGreaterThan(0);
      expect(wrappers?.length).toBeLessThan(30);
      expect(nestedList?.textContent).toContain("Nested message 0");
      expect(nestedList?.textContent).not.toContain("Nested message 20");
    });
  });

  it("keeps an offscreen search target realized and reveals it", async () => {
    const scrollElement = document.createElement("div");
    scrollElement.setAttribute("data-test-main-scroll", "");
    Object.defineProperty(scrollElement, "clientHeight", { value: 800 });
    Object.defineProperty(scrollElement, "scrollHeight", { value: 8_000 });
    const scrollElementIntoView = vi.fn();
    const bottomAnchor: BottomAnchorContextValue = {
      captureScrollAnchor: vi.fn(),
      getScrollElement: () => scrollElement,
      isAtBottom: false,
      scrollElementIntoView,
      scrollElementIntoViewClampedToMaxScroll: vi.fn(),
      scrollToBottom: vi.fn(),
    };
    const rows = Array.from({ length: 80 }, (_, index) =>
      conversationRow({
        id: `search-message-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        sourceSeqEnd: index + 1,
        sourceSeqStart: index + 1,
        text: `Search message ${index}`,
        threadId: "thr_large_search",
      }),
    );
    const queryClient = new QueryClient();
    expect(
      collectSearchedMessageAncestorRowIds(buildTimelineViewRows(rows), 21),
    ).toContain("search-message-20");
    const view = render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/thread",
            state: {
              searchMessageSeq: 21,
              searchThreadId: "thr_large_search",
            },
          },
        ]}
      >
        <QueryClientProvider client={queryClient}>
          <BottomAnchorContext.Provider value={bottomAnchor}>
            <CompactViewportOverrideProvider isCompactViewport>
              <ThreadTimelineRows
                threadId="thr_large_search"
                timelineRows={rows}
                timelineWindowingEnabled
                threadRuntimeDisplayStatus="idle"
                workspaceRootPath={undefined}
              />
            </CompactViewportOverrideProvider>
          </BottomAnchorContext.Provider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const target = view.container.querySelector<HTMLElement>(
      '[data-timeline-row-id="search-message-20"]',
    );

    expect(target?.dataset.timelineWindowedRealized).toBe("true");
    expect(target?.textContent).toContain("Search message 20");
    await waitFor(() =>
      expect(scrollElementIntoView).toHaveBeenCalledWith({
        element: target,
        options: { block: "center" },
      }),
    );
  });
});
