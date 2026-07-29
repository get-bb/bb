// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { BottomAnchorContext } from "@/components/ui/bottom-anchored-scroll-body.js";
import type { BottomAnchorContextValue } from "@/components/ui/bottom-anchored-scroll-body.js";
import { useAutoLoadOlderRows } from "./useAutoLoadOlderRows.js";

interface ObserverHandle {
  emit: (isIntersecting: boolean) => void;
}

let observers: ObserverHandle[] = [];

function installIntersectionObserverStub(): void {
  class ControllableIntersectionObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {
      observers.push({
        emit: (isIntersecting: boolean) => {
          this.callback(
            [{ isIntersecting } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        },
      });
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", ControllableIntersectionObserver);
}

function emitIntersection(isIntersecting: boolean): void {
  act(() => {
    for (const observer of observers) {
      observer.emit(isIntersecting);
    }
  });
}

function createBottomAnchor(): BottomAnchorContextValue {
  return {
    getScrollElement: () => null,
    isAtBottom: false,
    scrollToBottom: vi.fn(),
    scrollElementIntoView: vi.fn(),
    scrollElementIntoViewClampedToMaxScroll: vi.fn(),
    captureScrollAnchor: vi.fn(),
  };
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
  // Mounting the sentinel is what starts observing.
  act(() => {
    result.result.current.sentinelRef(document.createElement("div"));
  });
  return result;
}

beforeEach(() => {
  observers = [];
  installIntersectionObserverStub();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useAutoLoadOlderRows", () => {
  it("loads the next page when the top of the window scrolls into view", async () => {
    const onLoadOlderRows = vi.fn(() => Promise.resolve());
    const anchor = createBottomAnchor();
    const { result } = renderAutoLoad({ anchor, onLoadOlderRows });

    expect(result.current.isAutoLoadEnabled).toBe(true);
    expect(onLoadOlderRows).not.toHaveBeenCalled();

    emitIntersection(true);

    expect(onLoadOlderRows).toHaveBeenCalledTimes(1);
    // Captured before the fetch, otherwise prepended rows shift the view out
    // from under whatever the user was reading.
    expect(anchor.captureScrollAnchor).toHaveBeenCalledTimes(1);
  });

  it("stays manual with no bottom anchor to keep the reading position", () => {
    const onLoadOlderRows = vi.fn(() => Promise.resolve());
    const { result } = renderAutoLoad({ anchor: null, onLoadOlderRows });

    expect(result.current.isAutoLoadEnabled).toBe(false);
    emitIntersection(true);
    expect(onLoadOlderRows).not.toHaveBeenCalled();

    act(() => {
      result.current.loadOlderRows();
    });
    expect(onLoadOlderRows).toHaveBeenCalledTimes(1);
  });

  it("keeps loading while the sentinel stays visible after a page settles", async () => {
    // A page that does not fill the viewport leaves the sentinel on screen, and
    // IntersectionObserver reports changes rather than steady state — so this
    // only continues if the settle path re-checks.
    const onLoadOlderRows = vi.fn(() => Promise.resolve());
    const { rerender } = renderAutoLoad({
      anchor: createBottomAnchor(),
      onLoadOlderRows,
    });

    emitIntersection(true);
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

  it("stops auto-loading after a failure instead of retrying in a loop", async () => {
    // The sentinel is still visible when the loading flag clears, so without a
    // failure latch a persistently failing page would be refetched forever.
    const onLoadOlderRows = vi.fn(() => Promise.reject(new Error("boom")));
    const { result, rerender } = renderAutoLoad({
      anchor: createBottomAnchor(),
      onLoadOlderRows,
    });

    emitIntersection(true);
    await act(async () => {});
    expect(onLoadOlderRows).toHaveBeenCalledTimes(1);
    expect(result.current.isAutoLoadEnabled).toBe(false);

    await act(async () => {
      rerender({ isLoading: false });
    });
    emitIntersection(true);
    await act(async () => {});
    expect(onLoadOlderRows).toHaveBeenCalledTimes(1);

    // The button reappears, and pressing it clears the latch for one retry.
    await act(async () => {
      result.current.loadOlderRows();
    });
    expect(onLoadOlderRows).toHaveBeenCalledTimes(2);
  });
});
