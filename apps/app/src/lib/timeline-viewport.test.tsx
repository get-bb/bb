// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BottomAnchorContext,
  type BottomAnchorContextValue,
} from "@/components/ui/bottom-anchored-scroll-body";
import { createInertScrollPositionKeeper } from "@/test/scroll-position-keeper";
import {
  readTimelineViewport,
  TIMELINE_VIEWPORT_SETTLE_MS,
  TimelineViewportProvider,
  TimelineViewportScrollSource,
  useTimelineViewport,
} from "./timeline-viewport";

interface RowPosition {
  id: string;
  top: number;
  bottom: number;
}

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    height: bottom - top,
    left: 0,
    right: 100,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function createScrollElement({
  scrollTop,
  rows,
}: {
  scrollTop: number;
  rows: readonly RowPosition[];
}): HTMLElement {
  const scrollElement = document.createElement("div");
  Object.defineProperty(scrollElement, "clientHeight", { value: 100 });
  Object.defineProperty(scrollElement, "scrollHeight", { value: 1_000 });
  scrollElement.scrollTop = scrollTop;
  scrollElement.getBoundingClientRect = () => rect(0, 100);
  for (const row of rows) {
    const element = document.createElement("div");
    element.dataset.timelineRowId = row.id;
    element.getBoundingClientRect = vi.fn(() => rect(row.top, row.bottom));
    scrollElement.appendChild(element);
  }
  document.body.appendChild(scrollElement);
  return scrollElement;
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("readTimelineViewport", () => {
  it("lists the messages with any part in view, top to bottom, skipping other rows", () => {
    const scrollElement = createScrollElement({
      scrollTop: 400,
      rows: [
        { id: "user-1", top: -30, bottom: -10 },
        { id: "agent-1", top: -8, bottom: 2 },
        { id: "work-1", top: 5, bottom: 20 },
        { id: "user-2", top: 30, bottom: 50 },
        { id: "agent-2", top: 90, bottom: 130 },
        { id: "user-3", top: 100, bottom: 120 },
      ],
    });
    expect(
      readTimelineViewport(
        scrollElement,
        new Set(["user-1", "agent-1", "user-2", "agent-2", "user-3"]),
      ),
    ).toEqual({
      visibleMessageIds: ["agent-1", "user-2", "agent-2"],
      atLatest: false,
    });
  });

  it("reports the latest message as reached within four pixels of the bottom", () => {
    const rows = [{ id: "user-1", top: 10, bottom: 30 }];
    const ids = new Set(["user-1"]);
    expect(
      readTimelineViewport(createScrollElement({ scrollTop: 896, rows }), ids)
        .atLatest,
    ).toBe(true);
    expect(
      readTimelineViewport(createScrollElement({ scrollTop: 895, rows }), ids)
        .atLatest,
    ).toBe(false);
  });

  it("measures a logarithmic number of rows above the view", () => {
    const rows = Array.from({ length: 256 }, (_, index) => {
      const top = (index - 200) * 10;
      return { id: `item-${index}`, top, bottom: top + 10 };
    });
    const scrollElement = createScrollElement({ scrollTop: 400, rows });
    const viewport = readTimelineViewport(
      scrollElement,
      new Set(rows.map((row) => row.id)),
    );
    expect(viewport.visibleMessageIds[0]).toBe("item-200");
    expect(viewport.visibleMessageIds).toHaveLength(10);
    const measured = Array.from(
      scrollElement.querySelectorAll<HTMLElement>("[data-timeline-row-id]"),
    ).reduce(
      (count, row) =>
        count + vi.mocked(row.getBoundingClientRect).mock.calls.length,
      0,
    );
    expect(measured).toBeLessThanOrEqual(8 + 11);
  });
});

describe("useTimelineViewport", () => {
  it("is null outside a thread pane", () => {
    expect(renderHook(() => useTimelineViewport()).result.current).toBeNull();
  });

  it("answers once scrolling settles and re-renders only when the answer changes", () => {
    vi.useFakeTimers();
    const positions = new Map([
      ["user-1", { top: 10, bottom: 30 }],
      ["user-2", { top: 200, bottom: 220 }],
    ]);
    const scrollElement = createScrollElement({ scrollTop: 400, rows: [] });
    for (const [id] of positions) {
      const element = document.createElement("div");
      element.dataset.timelineRowId = id;
      element.getBoundingClientRect = () => {
        const position = positions.get(id) ?? { top: 0, bottom: 0 };
        return rect(position.top, position.bottom);
      };
      scrollElement.appendChild(element);
    }
    const bottomAnchor: BottomAnchorContextValue = {
      positionKeeper: createInertScrollPositionKeeper(),
      holdContentPosition: vi.fn(),
      getScrollElement: () => scrollElement,
      isAtBottom: false,
      scrollElementIntoView: vi.fn(),
      scrollToBottom: vi.fn(),
    };
    const messageIds = new Set(positions.keys());
    let renders = 0;
    const view = renderHook(
      () => {
        renders += 1;
        return useTimelineViewport();
      },
      {
        wrapper: ({ children }) => (
          <TimelineViewportProvider
            messageIds={messageIds}
            threadId="thr_viewport"
          >
            <BottomAnchorContext.Provider value={bottomAnchor}>
              <TimelineViewportScrollSource />
              {children}
            </BottomAnchorContext.Provider>
          </TimelineViewportProvider>
        ),
      },
    );
    act(() => {
      vi.advanceTimersByTime(TIMELINE_VIEWPORT_SETTLE_MS);
    });
    expect(view.result.current?.visibleMessageIds).toEqual(["user-1"]);
    const settledRenders = renders;

    positions.set("user-1", { top: -40, bottom: -20 });
    positions.set("user-2", { top: 20, bottom: 40 });
    for (let index = 0; index < 5; index += 1) {
      act(() => {
        scrollElement.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(TIMELINE_VIEWPORT_SETTLE_MS - 1);
      });
    }
    expect(view.result.current?.visibleMessageIds).toEqual(["user-1"]);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(view.result.current?.visibleMessageIds).toEqual(["user-2"]);
    expect(renders).toBe(settledRenders + 1);

    act(() => {
      scrollElement.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(TIMELINE_VIEWPORT_SETTLE_MS);
    });
    expect(renders).toBe(settledRenders + 1);
  });
});
