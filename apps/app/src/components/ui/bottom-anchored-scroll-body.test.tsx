// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { useContext, useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BottomAnchoredScrollBody,
  TimelineScrollRestoreContext,
  useBottomAnchoredScroll,
  type BottomAnchorContextValue,
} from "@/components/ui/bottom-anchored-scroll-body";
import { TimelineWindowedItems } from "@/components/thread/timeline/TimelineWindowedItems";
import { scrollPageToTop } from "@/lib/page-scroll-to-top";
import { threadTimelineScrollAnchorAtomFamily } from "@/lib/thread-timeline-scroll-anchor";
import { installFakeFlowLayout } from "@/test/fake-flow-layout";

const VIEWPORT_HEIGHT = 600;
const FOOTER_HEIGHT = 80;
const THREADS = ["thread-a", "thread-b"];
let restoreLayout: (() => void) | null = null;

afterEach(() => {
  cleanup();
  restoreLayout?.();
  restoreLayout = null;
  for (const threadId of THREADS) {
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily(threadId), null);
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function rowKeys(threadId: string, count: number) {
  return Array.from(
    { length: count },
    (_, index) => `${threadId}:row-${index}`,
  );
}

function heightOf(key: string) {
  return 60 + ((key.length * 13 + Number(key.split("-").at(-1))) % 5) * 40;
}

const handles: {
  bottomAnchor: BottomAnchorContextValue | null;
  setHeights: (update: (heights: Map<string, number>) => void) => void;
} = { bottomAnchor: null, setHeights: () => undefined };

function Timeline({ keys }: { keys: string[] }) {
  const anchor = useBottomAnchoredScroll();
  const restore = useContext(TimelineScrollRestoreContext);
  const [measurements] = useState(() => new Map<string, number>());
  const [overrides, setOverrides] = useState(() => new Map<string, number>());
  useEffect(() => {
    handles.bottomAnchor = anchor;
    handles.setHeights = (update) =>
      setOverrides((previous) => {
        const next = new Map(previous);
        update(next);
        return next;
      });
  });
  return (
    <div data-timeline-row-list="top-level">
      <TimelineWindowedItems
        estimateItemHeight={() => 100}
        gap={8}
        initialWindowAnchor={restore}
        itemKeys={keys}
        measurements={measurements}
        positionKeeper={anchor?.positionKeeper ?? null}
        pinnedToEnd={anchor?.isAtBottom === true}
        renderItem={(index, state) => {
          const key = keys[index] ?? "";
          return (
            <div
              key={key}
              ref={state.itemRef}
              data-timeline-row-id={key}
              data-timeline-window-key={key}
              data-fake-height={overrides.get(key) ?? heightOf(key)}
            >
              {key}
            </div>
          );
        }}
      />
    </div>
  );
}

function Shell({ threadId, keys }: { threadId: string; keys: string[] }) {
  return (
    <BottomAnchoredScrollBody
      key={threadId}
      footer={<div data-fake-height={FOOTER_HEIGHT}>composer</div>}
      maxWidthClassName="max-w-none"
      scrollAnchorThreadId={threadId}
    >
      <Timeline keys={keys} />
    </BottomAnchoredScrollBody>
  );
}

function setup(threadId: string, keys: string[]) {
  restoreLayout?.();
  const layout = installFakeFlowLayout({
    scrollElement: () =>
      document.querySelector<HTMLElement>("[data-page-scroll-viewport]"),
    viewportHeight: VIEWPORT_HEIGHT,
  });
  restoreLayout = layout.restore;
  const view = render(<Shell threadId={threadId} keys={keys} />);
  act(() => layout.flushResizeObservers());
  const topOf = (key: string) => {
    const row = document.querySelector(`[data-timeline-row-id="${key}"]`);
    if (row === null) throw new Error(`${key} is not mounted`);
    return row.getBoundingClientRect().top;
  };
  const firstVisible = () =>
    [...document.querySelectorAll<HTMLElement>("[data-timeline-row-id]")]
      .map((row) => ({
        key: row.dataset.timelineRowId ?? "",
        top: row.getBoundingClientRect().top,
      }))
      .find((row) => row.top >= 0)?.key ?? "";
  const scrollElement = document.querySelector<HTMLElement>(
    "[data-page-scroll-viewport]",
  );
  if (scrollElement === null) throw new Error("no scroll element");
  return { layout, topOf, firstVisible, view, scrollElement };
}

function savedAnchor(threadId: string) {
  return getDefaultStore().get(threadTimelineScrollAnchorAtomFamily(threadId));
}

describe("BottomAnchoredScrollBody", () => {
  it("restores the reading row exactly after switching threads and back", () => {
    const keysA = rowKeys("thread-a", 120);
    const first = setup("thread-a", keysA);
    act(() => first.layout.userScrollTo(first.layout.maxScrollTop() - 2_500));
    const reader = first.firstVisible();
    const before = first.topOf(reader);

    first.view.rerender(
      <Shell threadId="thread-b" keys={rowKeys("thread-b", 40)} />,
    );
    first.view.unmount();
    const second = setup("thread-a", keysA);

    expect(second.topOf(reader)).toBe(before);
    expect(handles.bottomAnchor?.isAtBottom).toBe(false);
  });

  it("returns to the end when the thread was left at the end", () => {
    const keysA = rowKeys("thread-a", 120);
    const first = setup("thread-a", keysA);
    first.view.unmount();

    const second = setup("thread-a", keysA);

    expect(second.layout.scrollTop).toBe(second.layout.maxScrollTop());
    expect(handles.bottomAnchor?.isAtBottom).toBe(true);
  });

  it("waits at the end for a saved row that has not loaded, then restores it when it arrives", () => {
    const keysA = rowKeys("thread-a", 120);
    const first = setup("thread-a", keysA);
    act(() => first.layout.userScrollTo(400));
    const reader = first.firstVisible();
    const before = first.topOf(reader);
    first.view.unmount();

    const second = setup("thread-a", keysA.slice(60));
    expect(second.layout.scrollTop).toBe(second.layout.maxScrollTop());
    act(() => second.view.rerender(<Shell threadId="thread-a" keys={keysA} />));

    expect(second.topOf(reader)).toBe(before);
    expect(handles.bottomAnchor?.isAtBottom).toBe(false);
  });

  it("keeps an explicit jump to the end when the saved row it was waiting for arrives afterwards", () => {
    const keysA = rowKeys("thread-a", 120);
    const first = setup("thread-a", keysA);
    act(() => first.layout.userScrollTo(400));
    first.view.unmount();

    const second = setup("thread-a", keysA.slice(60));
    expect(second.layout.scrollTop).toBe(second.layout.maxScrollTop());
    act(() => handles.bottomAnchor?.scrollToBottom());
    act(() => second.view.rerender(<Shell threadId="thread-a" keys={keysA} />));
    act(() => second.layout.flushResizeObservers());

    expect(second.layout.scrollTop).toBe(second.layout.maxScrollTop());
    expect(handles.bottomAnchor?.isAtBottom).toBe(true);
  });

  it("stays at the end and keeps following new content when the saved row never loads", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily("thread-a"), {
      rowId: "thread-a:row-gone",
      offsetWithinRow: 20,
      atBottom: false,
    });
    const { layout, view } = setup("thread-a", rowKeys("thread-a", 60));
    expect(layout.scrollTop).toBe(layout.maxScrollTop());

    act(() => vi.advanceTimersByTime(1_500));
    act(() => layout.flushResizeObservers());
    act(() =>
      view.rerender(
        <Shell threadId="thread-a" keys={rowKeys("thread-a", 64)} />,
      ),
    );
    act(() => layout.flushResizeObservers());

    expect(layout.scrollTop).toBe(layout.maxScrollTop());
    expect(handles.bottomAnchor?.isAtBottom).toBe(true);
  });

  it("saves the end when the timeline unmounts during a transient off-bottom layout", () => {
    const keysA = rowKeys("thread-a", 60);
    const first = setup("thread-a", keysA);
    const last = keysA.at(-1) ?? "";
    document
      .querySelector(`[data-timeline-row-id="${last}"]`)
      ?.setAttribute("data-fake-height", String(heightOf(last) + 300));

    first.view.unmount();

    expect(savedAnchor("thread-a")).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });
  });

  it("saves the row the reader scrolled to when the timeline unmounts before the scroll event lands", () => {
    const keysA = rowKeys("thread-a", 120);
    const first = setup("thread-a", keysA);
    const target = first.layout.maxScrollTop() - 2_000;
    first.scrollElement.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -2_000 }),
    );
    first.layout.bounceTo(target);
    const reader = first.firstVisible();
    const before = first.topOf(reader);

    first.view.unmount();
    expect(savedAnchor("thread-a")?.atBottom).toBe(false);
    const second = setup("thread-a", keysA);

    expect(second.topOf(reader)).toBe(before);
  });

  it("detaches when the reader scrolls up and re-attaches only when they scroll back down to the end", () => {
    const { layout } = setup("thread-a", rowKeys("thread-a", 60));
    const end = layout.maxScrollTop();

    act(() => layout.userScrollTo(end - 400));
    expect(handles.bottomAnchor?.isAtBottom).toBe(false);
    act(() => layout.userScrollTo(end - 100));
    expect(handles.bottomAnchor?.isAtBottom).toBe(false);
    act(() => layout.userScrollTo(end));
    expect(handles.bottomAnchor?.isAtBottom).toBe(true);
  });

  it("keeps following new content when the reader wheels back to the end and keeps wheeling there", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const keys = rowKeys("thread-a", 60);
    const { layout, view, scrollElement } = setup("thread-a", keys);
    const end = layout.maxScrollTop();
    act(() => layout.userScrollTo(end - 500));
    act(() => layout.userScrollTo(end));
    expect(handles.bottomAnchor?.isAtBottom).toBe(true);

    act(() => {
      scrollElement.dispatchEvent(new WheelEvent("wheel", { deltaY: 200 }));
    });
    const grown = rowKeys("thread-a", 61);
    act(() => view.rerender(<Shell threadId="thread-a" keys={grown} />));
    act(() => {
      scrollElement.dispatchEvent(new Event("scroll"));
    });
    act(() => layout.flushResizeObservers());

    expect(layout.maxScrollTop()).toBe(end + 8 + heightOf(grown.at(-1) ?? ""));
    expect(layout.scrollTop).toBe(layout.maxScrollTop());
    expect(handles.bottomAnchor?.isAtBottom).toBe(true);
    view.unmount();
    expect(savedAnchor("thread-a")).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });
  });

  it("detaches from new content when a header tap scrolls the timeline to the top", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const keys = rowKeys("thread-a", 60);
    const { layout, view, topOf, scrollElement } = setup("thread-a", keys);
    const header = document.createElement("header");
    scrollElement.parentElement?.prepend(header);
    scrollElement.getClientRects = () =>
      [new DOMRect(0, 0, 400, VIEWPORT_HEIGHT)] as unknown as DOMRectList;
    const nativeScrollTo = vi.fn();
    scrollElement.scrollTo = nativeScrollTo;
    expect(handles.bottomAnchor?.isAtBottom).toBe(true);

    act(() => scrollPageToTop(header));
    expect(nativeScrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    for (const top of [layout.maxScrollTop() - 300, 800, 0]) {
      act(() => layout.layoutScrollTo(top));
    }
    expect(handles.bottomAnchor?.isAtBottom).toBe(false);

    act(() =>
      view.rerender(
        <Shell threadId="thread-a" keys={rowKeys("thread-a", 62)} />,
      ),
    );
    act(() => layout.flushResizeObservers());
    expect(layout.scrollTop).toBe(0);
    expect(topOf(keys[0] ?? "")).toBe(0);
    view.unmount();
    expect(savedAnchor("thread-a")).toEqual({
      rowId: keys[0],
      offsetWithinRow: 0,
      atBottom: false,
    });
  });

  it.each([
    { delivery: "its scroll event arrives first", reRendersFirst: false },
    {
      delivery: "the timeline re-renders before its scroll event",
      reRendersFirst: true,
    },
  ])(
    "follows a scroll made without input when nothing changed size, such as find in page, when $delivery",
    ({ reRendersFirst }) => {
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "performance"],
      });
      const keys = rowKeys("thread-a", 60);
      const { layout, topOf, firstVisible, view, scrollElement } = setup(
        "thread-a",
        keys,
      );
      act(() => layout.userScrollTo(layout.maxScrollTop() - 1_500));
      act(() => vi.advanceTimersByTime(500));
      const fromEnd = layout.maxScrollTop() - layout.scrollTop + 300;

      layout.bounceTo(layout.scrollTop - 300);
      const reader = firstVisible();
      const before = topOf(reader);
      if (reRendersFirst) {
        act(() =>
          view.rerender(<Shell threadId="thread-a" keys={[...keys]} />),
        );
      }
      act(() => {
        scrollElement.dispatchEvent(new Event("scroll"));
      });
      act(() => layout.flushResizeObservers());

      expect(layout.maxScrollTop() - layout.scrollTop).toBe(fromEnd);
      expect(topOf(reader)).toBe(before);
      expect(handles.bottomAnchor?.isAtBottom).toBe(false);
    },
  );

  it("treats a scroll without input that comes with a size change as layout, so it neither detaches nor moves the reader", () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });
    const keys = rowKeys("thread-a", 60);
    const { layout, topOf, firstVisible } = setup("thread-a", keys);
    const last = keys.at(-1) ?? "";

    document
      .querySelector(`[data-timeline-row-id="${last}"]`)
      ?.setAttribute("data-fake-height", "20");
    act(() => layout.layoutScrollTo(layout.maxScrollTop()));
    act(() => layout.flushResizeObservers());
    expect(handles.bottomAnchor?.isAtBottom).toBe(true);
    document
      .querySelector(`[data-timeline-row-id="${last}"]`)
      ?.setAttribute("data-fake-height", String(heightOf(last)));
    act(() => layout.flushResizeObservers());
    expect(layout.scrollTop).toBe(layout.maxScrollTop());

    act(() => layout.userScrollTo(layout.maxScrollTop() - 1_500));
    act(() => vi.advanceTimersByTime(500));
    const reader = firstVisible();
    const before = topOf(reader);
    const above = document.querySelector(
      `[data-timeline-row-id="${keys[keys.indexOf(reader) - 1]}"]`,
    );
    above?.setAttribute("data-fake-height", "30");
    act(() => layout.layoutScrollTo(layout.scrollTop - 40));

    expect(topOf(reader)).toBe(before);
    expect(handles.bottomAnchor?.isAtBottom).toBe(false);
  });

  it("keeps the end and the composer still while an attached row expands", () => {
    const keys = rowKeys("thread-a", 60);
    const { layout, topOf } = setup("thread-a", keys);
    const last = keys.at(-1) ?? "";
    const toggled = keys.at(-3) ?? "";
    const lastBefore = topOf(last);
    const toggledBefore = topOf(toggled);
    const growth = 260;

    act(() =>
      handles.setHeights((heights) =>
        heights.set(toggled, heightOf(toggled) + growth),
      ),
    );
    act(() => layout.flushResizeObservers());

    expect(topOf(last)).toBe(lastBefore);
    expect(topOf(toggled)).toBe(toggledBefore - growth);
    expect(handles.bottomAnchor?.isAtBottom).toBe(true);
  });

  it("renders the composer inside the timeline's scroll area, so wheel and gutter scrolling over it scroll the timeline", () => {
    const { scrollElement } = setup("thread-a", rowKeys("thread-a", 5));

    expect(scrollElement.contains(screen.getByText("composer"))).toBe(true);
  });

  it("holds a collapsing row's bottom edge when the reader holds it", () => {
    const keys = rowKeys("thread-a", 60);
    const { layout, topOf, firstVisible } = setup("thread-a", keys);
    act(() => layout.userScrollTo(layout.maxScrollTop() - 1_200));
    const key = firstVisible();
    const row = document.querySelector<HTMLElement>(
      `[data-timeline-row-id="${key}"]`,
    );
    if (row === null || handles.bottomAnchor === null)
      throw new Error("not mounted");
    const bottomBefore = topOf(key) + heightOf(key);
    const anchor = handles.bottomAnchor;

    act(() =>
      anchor.holdContentPosition({
        edge: "bottom",
        element: row,
        update: () => handles.setHeights((heights) => heights.set(key, 40)),
      }),
    );
    act(() => layout.flushResizeObservers());

    expect(topOf(key) + 40).toBe(bottomBefore);
  });
});
