// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { BottomAnchorContext } from "@/components/ui/bottom-anchored-scroll-body.js";
import type { BottomAnchorContextValue } from "@/components/ui/bottom-anchored-scroll-body.js";
import { useAutoLoadOlderRows } from "./useAutoLoadOlderRows.js";
import { ScrollPositionKeeper } from "@/components/ui/scroll-position-keeper";

function createBottomAnchor(
  scrollElement: HTMLElement = document.createElement("div"),
): BottomAnchorContextValue {
  const positionKeeper = new ScrollPositionKeeper({
    bottomThresholdPx: 4,
    deferWritesWhileScrolling: false,
    getContentElement: () => null,
    getFloorElement: () => null,
    getFooterElement: () => null,
    getScrollElement: () => scrollElement,
    getTopLevelRows: () => [],
    initiallyAttached: false,
  });
  return {
    getScrollElement: () => scrollElement,
    isAtBottom: false,
    scrollToBottom: vi.fn(),
    scrollElementIntoView: vi.fn(),
    positionKeeper,
    holdContentPosition: vi.fn(),
  };
}

function notifyPosition(anchor: BottomAnchorContextValue): void {
  act(() => {
    anchor.positionKeeper.reconcile();
    vi.runOnlyPendingTimers();
  });
}

function mockElementRect(
  element: HTMLElement,
  { bottom, top }: { bottom: number; top: number },
): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    bottom,
    height: bottom - top,
    left: 0,
    right: 100,
    top,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
}

function renderAutoLoad(args: {
  anchor: BottomAnchorContextValue | null;
  onLoadOlderRows: () => Promise<void> | void;
}) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    args.anchor === null ? (
      <>{children}</>
    ) : (
      <BottomAnchorContext.Provider value={args.anchor}>
        {children}
      </BottomAnchorContext.Provider>
    );
  const result = renderHook(
    ({ isLoading }: { isLoading: boolean }) =>
      useAutoLoadOlderRows({
        hasOlderTimelineRows: true,
        isLoadingOlderTimelineRows: isLoading,
        onLoadOlderRows: args.onLoadOlderRows,
      }),
    { initialProps: { isLoading: false }, wrapper },
  );
  const sentinel = document.createElement("div");
  document.body.append(sentinel);
  mockElementRect(sentinel, { top: -2_000, bottom: -1_980 });
  act(() => {
    result.result.current.sentinelRef(sentinel);
  });
  return { ...result, sentinel };
}

function scrollElementAt(top: number, bottom: number): HTMLElement {
  const scrollElement = document.createElement("div");
  mockElementRect(scrollElement, { top, bottom });
  return scrollElement;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAutoLoadOlderRows", () => {
  it("loads the next page when a position update brings the top of the window into range", () => {
    const onLoadOlderRows = vi.fn(() => Promise.resolve());
    const anchor = createBottomAnchor(scrollElementAt(0, 500));
    const { result, sentinel } = renderAutoLoad({ anchor, onLoadOlderRows });

    expect(result.current.isAutoLoadEnabled).toBe(true);
    expect(onLoadOlderRows).not.toHaveBeenCalled();

    mockElementRect(sentinel, { top: -400, bottom: -380 });
    notifyPosition(anchor);

    expect(onLoadOlderRows).toHaveBeenCalledTimes(1);
  });

  it("stays manual with no bottom anchor to keep the reading position", () => {
    const onLoadOlderRows = vi.fn(() => Promise.resolve());
    const { result } = renderAutoLoad({ anchor: null, onLoadOlderRows });

    expect(result.current.isAutoLoadEnabled).toBe(false);
    expect(onLoadOlderRows).not.toHaveBeenCalled();

    act(() => {
      result.current.loadOlderRows();
    });
    expect(onLoadOlderRows).toHaveBeenCalledTimes(1);
  });

  it("keeps loading while the sentinel stays in range after a page settles", async () => {
    const onLoadOlderRows = vi.fn(() => Promise.resolve());
    const anchor = createBottomAnchor(scrollElementAt(0, 500));
    const { rerender, sentinel } = renderAutoLoad({ anchor, onLoadOlderRows });

    mockElementRect(sentinel, { top: 100, bottom: 120 });
    notifyPosition(anchor);
    expect(onLoadOlderRows).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ isLoading: true });
    });
    expect(onLoadOlderRows).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ isLoading: false });
    });
    expect(onLoadOlderRows).toHaveBeenCalledTimes(2);
  });

  it("does not load again when a prepend moves the sentinel out of range", async () => {
    const onLoadOlderRows = vi.fn(() => Promise.resolve());
    const anchor = createBottomAnchor(scrollElementAt(0, 500));
    const { rerender, sentinel } = renderAutoLoad({ anchor, onLoadOlderRows });

    mockElementRect(sentinel, { top: 100, bottom: 120 });
    notifyPosition(anchor);
    expect(onLoadOlderRows).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ isLoading: true });
    });
    mockElementRect(sentinel, { top: -3_800, bottom: -3_780 });
    await act(async () => {
      rerender({ isLoading: false });
    });
    notifyPosition(anchor);

    expect(onLoadOlderRows).toHaveBeenCalledTimes(1);
  });

  it("loads when the reader later scrolls back to the top after a prepend moved the sentinel away", async () => {
    const onLoadOlderRows = vi.fn(() => Promise.resolve());
    const anchor = createBottomAnchor(scrollElementAt(48, 900));
    const { rerender, sentinel } = renderAutoLoad({ anchor, onLoadOlderRows });

    mockElementRect(sentinel, { top: -540, bottom: -512 });
    notifyPosition(anchor);
    await act(async () => {
      rerender({ isLoading: true });
    });
    mockElementRect(sentinel, { top: -3_790, bottom: -3_762 });
    await act(async () => {
      rerender({ isLoading: false });
    });
    expect(onLoadOlderRows).toHaveBeenCalledTimes(1);

    for (const top of [-2_400, -1_200, -564, 64]) {
      mockElementRect(sentinel, { top, bottom: top + 28 });
      notifyPosition(anchor);
    }

    expect(onLoadOlderRows).toHaveBeenCalledTimes(2);
  });

  it("stops auto-loading after a failure instead of retrying in a loop", async () => {
    const onLoadOlderRows = vi.fn(() => Promise.reject(new Error("boom")));
    const anchor = createBottomAnchor(scrollElementAt(0, 500));
    const { result, rerender, sentinel } = renderAutoLoad({
      anchor,
      onLoadOlderRows,
    });

    mockElementRect(sentinel, { top: 100, bottom: 120 });
    notifyPosition(anchor);
    await act(async () => {});
    expect(onLoadOlderRows).toHaveBeenCalledTimes(1);
    expect(result.current.isAutoLoadEnabled).toBe(false);

    await act(async () => {
      rerender({ isLoading: false });
    });
    notifyPosition(anchor);
    await act(async () => {});
    expect(onLoadOlderRows).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.loadOlderRows();
    });
    expect(onLoadOlderRows).toHaveBeenCalledTimes(2);
  });
});
