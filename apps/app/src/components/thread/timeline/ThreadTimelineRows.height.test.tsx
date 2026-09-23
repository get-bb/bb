// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import {
  BottomAnchorContext,
  type BottomAnchorContextValue,
} from "@/components/ui/bottom-anchored-scroll-body";
import { conversationRow, turnRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

class ResizeObserverStub implements ResizeObserver {
  static instances: ResizeObserverStub[] = [];

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  observe: ResizeObserver["observe"] = vi.fn();
  unobserve: ResizeObserver["unobserve"] = vi.fn();
  disconnect: ResizeObserver["disconnect"] = vi.fn();
}

afterEach(() => {
  ResizeObserverStub.instances.length = 0;
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("snap-syncs the timeline height when older rows are prepended", () => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return (
        this.querySelectorAll(
          '[data-timeline-row-list="top-level"] > [data-timeline-row-id]',
        ).length * 100
      );
    },
  );

  const latestRows = [
    conversationRow({
      id: "newer_user",
      role: "user",
      seq: 20,
      text: "Newest request",
    }),
    turnRow({ id: "newest_turn", seq: 21, status: "completed" }),
  ];
  const olderRows = [
    conversationRow({
      id: "older_user",
      role: "user",
      seq: 10,
      text: "Older request",
    }),
    turnRow({ id: "older_turn", seq: 11, status: "completed" }),
  ];
  const queryClient = new QueryClient();
  const timeline = (rows: typeof latestRows) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ThreadTimelineRows
          threadId="thr_main"
          timelineRows={rows}
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(timeline(latestRows));
  const rowList = view.container.querySelector<HTMLElement>(
    '[data-timeline-row-list="top-level"]',
  );
  const heightWrapper = rowList?.parentElement?.parentElement;

  expect(heightWrapper?.style.height).toBe("200px");

  view.rerender(timeline([...olderRows, ...latestRows]));

  expect(heightWrapper?.style.height).toBe("400px");
  expect(heightWrapper?.style.transitionDuration).toBe("0s");
});

it("snaps active timeline growth on fine-pointer browsers", () => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("CSS", {
    supports: (property: string) => property === "overflow-anchor",
  });
  const queryClient = new QueryClient();
  const rows = [turnRow({ id: "active_turn", seq: 1, status: "pending" })];
  const timeline = (active: boolean) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ThreadTimelineRows
          threadId="thr_main"
          timelineRows={rows}
          threadRuntimeDisplayStatus={active ? "active" : "idle"}
          workspaceRootPath={undefined}
        />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(timeline(false));
  const rowList = view.container.querySelector<HTMLElement>(
    '[data-timeline-row-list="top-level"]',
  );
  const wrapper = rowList?.parentElement?.parentElement;
  expect(wrapper?.style.transition).toContain("height 180ms");
  view.rerender(timeline(true));
  expect(wrapper?.style.transition).toContain("height 0ms");
  view.rerender(timeline(false));
  expect(wrapper?.style.transition).toContain("height 180ms");
});

function stubFullContainmentSupport(): void {
  vi.stubGlobal("CSS", {
    supports: (property: string) =>
      property === "overflow-anchor" ||
      property === "content-visibility" ||
      property === "contain-intrinsic-block-size",
  });
}

function renderTimelineWithContainmentSupport(
  timelineWindowingEnabled: boolean,
): HTMLElement {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  stubFullContainmentSupport();
  const rows = [turnRow({ id: "idle_turn", seq: 1, status: "completed" })];
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <ThreadTimelineRows
          threadId="thr_main"
          timelineRows={rows}
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
          timelineWindowingEnabled={timelineWindowingEnabled}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const rowList = view.container.querySelector<HTMLElement>(
    '[data-timeline-row-list="top-level"]',
  );
  const wrapper = rowList?.parentElement?.parentElement;
  if (!wrapper) {
    throw new Error("Timeline height wrapper was not rendered");
  }
  return wrapper;
}

it("keeps idle growth animated once row containment is armed", () => {
  expect(
    renderTimelineWithContainmentSupport(false).style.transition,
  ).toContain("height 180ms");
});

it("keeps idle growth animated when timeline windowing disables containment", () => {
  expect(
    renderTimelineWithContainmentSupport(true).style.transition,
  ).toContain("height 180ms");
});

function growArmedTimelineAfterSettle(
  hasRecentViewportChange: () => boolean,
  timelineWindowingEnabled = false,
): string {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  stubFullContainmentSupport();
  try {
    const anchor: BottomAnchorContextValue = {
      getScrollElement: () => null,
      isAtBottom: true,
      scrollToBottom: vi.fn(),
      scrollElementIntoView: vi.fn(),
      scrollElementIntoViewClampedToMaxScroll: vi.fn(),
      captureScrollAnchor: vi.fn(),
      hasRecentViewportChange,
    };
    const rows = [turnRow({ id: "idle_turn", seq: 1, status: "completed" })];
    const view = render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <BottomAnchorContext.Provider value={anchor}>
            <ThreadTimelineRows
              threadId="thr_main"
              timelineRows={rows}
              threadRuntimeDisplayStatus="idle"
              workspaceRootPath={undefined}
              timelineWindowingEnabled={timelineWindowingEnabled}
            />
          </BottomAnchorContext.Provider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const rowList = view.container.querySelector<HTMLElement>(
      '[data-timeline-row-list="top-level"]',
    );
    const inner = rowList?.parentElement;
    const wrapper = inner?.parentElement;
    const observer = ResizeObserverStub.instances.find((instance) =>
      vi
        .mocked(instance.observe)
        .mock.calls.some(([target]) => target === inner),
    );
    if (!inner || !wrapper || !observer) {
      throw new Error("Timeline height wrapper was not observed");
    }
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      observer.callback(
        [
          {
            target: inner,
            contentRect: new DOMRect(0, 0, 200, 500),
            borderBoxSize: [{ blockSize: 500, inlineSize: 200 }],
            contentBoxSize: [{ blockSize: 500, inlineSize: 200 }],
            devicePixelContentBoxSize: [{ blockSize: 500, inlineSize: 200 }],
          },
        ],
        observer,
      );
    });
    expect(wrapper.style.height).toBe("500px");
    return wrapper.style.transitionDuration;
  } finally {
    vi.useRealTimers();
  }
}

it("snaps idle growth right after a viewport change while containment is armed", () => {
  expect(growArmedTimelineAfterSettle(() => true)).toBe("0s");
});

it("eases idle growth while containment is armed and the viewport is still", () => {
  expect(growArmedTimelineAfterSettle(() => false)).toBe("");
});

it("ignores viewport changes when windowing keeps containment off", () => {
  expect(growArmedTimelineAfterSettle(() => true, true)).toBe("");
});
