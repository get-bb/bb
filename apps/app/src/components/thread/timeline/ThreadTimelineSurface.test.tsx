// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomAnchorContext } from "@/components/ui/bottom-anchored-scroll-body.js";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineSurface } from "./ThreadTimelineSurface";
import { createInertScrollPositionKeeper } from "@/test/scroll-position-keeper";

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: undefined }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
      positionKeeper: createInertScrollPositionKeeper(),
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

describe("ThreadTimelineSurface working indicator", () => {
  const INDICATOR_HEIGHT_PX = 44;
  const runningProps = {
    activeThinking: null,
    contextBoundarySeq: null,
    threadId: "running",
    threadRuntimeDisplayStatus: "active" as const,
    timelineError: false,
    workspaceRootPath: undefined,
  };
  const loadedRows = [
    conversationRow({ id: "request", role: "user", seq: 1, text: "Go" }),
  ];

  function renderSurface() {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(
      INDICATOR_HEIGHT_PX,
    );
    const queryClient = new QueryClient();
    const surface = (
      props: Pick<
        ComponentProps<typeof ThreadTimelineSurface>,
        "isThreadTimelinePending" | "showOngoingIndicator" | "timelineRows"
      >,
    ) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ThreadTimelineSurface {...runningProps} {...props} />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const view = render(
      surface({
        isThreadTimelinePending: true,
        showOngoingIndicator: false,
        timelineRows: [],
      }),
    );
    const styleChanges = new MutationObserver(() => {});
    styleChanges.observe(view.container, {
      attributeFilter: ["style"],
      attributeOldValue: true,
      subtree: true,
    });
    return { styleChanges, surface, view };
  }

  function indicatorHeightWrapper(): HTMLElement {
    const wrapper = screen
      .getByText("Working...")
      .closest<HTMLElement>('[style*="height 180ms"]');
    if (wrapper === null) throw new Error("Missing indicator height wrapper");
    return wrapper;
  }

  function grewFromCollapsed(
    records: MutationRecord[],
    wrapper: HTMLElement,
  ): boolean {
    return records.some(
      (record) =>
        record.target === wrapper &&
        (record.oldValue ?? "").includes("height: 0px") &&
        wrapper.style.transitionDuration !== "0s",
    );
  }

  it("appears at full height when it arrives with the thread's timeline", () => {
    const { styleChanges, surface, view } = renderSurface();

    view.rerender(
      surface({
        isThreadTimelinePending: false,
        showOngoingIndicator: true,
        timelineRows: loadedRows,
      }),
    );

    const wrapper = indicatorHeightWrapper();
    expect(wrapper.style.height).toBe(`${INDICATOR_HEIGHT_PX}px`);
    expect(grewFromCollapsed(styleChanges.takeRecords(), wrapper)).toBe(false);
  });

  it("still animates open when a turn starts on a loaded timeline", () => {
    const { styleChanges, surface, view } = renderSurface();
    view.rerender(
      surface({
        isThreadTimelinePending: false,
        showOngoingIndicator: false,
        timelineRows: loadedRows,
      }),
    );
    styleChanges.takeRecords();

    view.rerender(
      surface({
        isThreadTimelinePending: false,
        showOngoingIndicator: true,
        timelineRows: loadedRows,
      }),
    );

    const wrapper = indicatorHeightWrapper();
    expect(wrapper.style.height).toBe(`${INDICATOR_HEIGHT_PX}px`);
    expect(grewFromCollapsed(styleChanges.takeRecords(), wrapper)).toBe(true);
  });
});
