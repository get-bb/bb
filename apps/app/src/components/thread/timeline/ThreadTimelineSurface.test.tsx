// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomAnchorContext } from "@/components/ui/bottom-anchored-scroll-body.js";
import { ThreadTimelineSurface } from "./ThreadTimelineSurface";

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: undefined }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ThreadTimelineSurface load-older control", () => {
  it("resumes auto-loading after a context boundary replaces a timeline whose older page failed", async () => {
    const intersectionCallbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallbacks.push(callback);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const emitLatestSentinelIntersection = () => {
      act(() => {
        intersectionCallbacks.at(-1)?.(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
    };
    const scrollElement = document.createElement("div");
    vi.spyOn(scrollElement, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 500),
    );
    const anchor = {
      captureScrollAnchor: vi.fn(),
      holdContentPosition: vi.fn(),
      getScrollElement: () => scrollElement,
      isAtBottom: false,
      scrollElementIntoView: vi.fn(),
      scrollElementIntoViewClampedToMaxScroll: vi.fn(),
      scrollToBottom: vi.fn(),
    };
    const onLoadOlderRows = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Server error"))
      .mockReturnValue(new Promise(() => {}));
    const surface = (contextBoundarySeq: number | null) => (
      <BottomAnchorContext.Provider value={anchor}>
        <ThreadTimelineSurface
          activeThinking={null}
          contextBoundarySeq={contextBoundarySeq}
          hasOlderTimelineRows
          isThreadTimelinePending={false}
          onLoadOlderRows={onLoadOlderRows}
          showOngoingIndicator={false}
          threadId="thread-1"
          threadRuntimeDisplayStatus="idle"
          timelineError={false}
          timelineRows={[]}
          workspaceRootPath={undefined}
        />
      </BottomAnchorContext.Provider>
    );
    const view = render(surface(null));

    emitLatestSentinelIntersection();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Load older messages" }),
      ).not.toBeNull();
    });

    view.rerender(surface(10));
    expect(screen.getByRole("status")).not.toBeNull();

    emitLatestSentinelIntersection();
    expect(onLoadOlderRows).toHaveBeenCalledTimes(2);
  });
});

describe("ThreadTimelineSurface catch-up indicator", () => {
  const props = {
    activeThinking: null,
    contextBoundarySeq: null,
    isThreadTimelinePending: false,
    showOngoingIndicator: false,
    threadId: "catch-up",
    threadRuntimeDisplayStatus: "idle" as const,
    timelineError: false,
    timelineRows: [],
    workspaceRootPath: undefined,
  };

  it("never shows loading for a catch-up that finishes within one second", async () => {
    vi.useFakeTimers();
    const view = render(
      <ThreadTimelineSurface {...props} isCatchingUpTimeline />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(
      <ThreadTimelineSurface {...props} isCatchingUpTimeline={false} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("delays each thread's indicator and hides immediately when caught up", async () => {
    vi.useFakeTimers();
    const view = render(
      <ThreadTimelineSurface {...props} isCatchingUpTimeline />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole("status").textContent).toBe(
      "Loading latest messages…",
    );
    view.rerender(
      <ThreadTimelineSurface
        {...props}
        threadId="another-thread"
        isCatchingUpTimeline
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole("status").textContent).toBe(
      "Loading latest messages…",
    );
    view.rerender(
      <ThreadTimelineSurface
        {...props}
        threadId="another-thread"
        isCatchingUpTimeline={false}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(
      <ThreadTimelineSurface
        {...props}
        threadId="another-thread"
        isCatchingUpTimeline
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});
