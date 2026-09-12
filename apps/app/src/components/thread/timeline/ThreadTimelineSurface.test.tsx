// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ThreadTimelineResponse, TimelineRow } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BottomAnchorContext,
  type BottomAnchorContextValue,
} from "@/components/ui/bottom-anchored-scroll-body.js";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { BbHttpError, sdk } from "@/lib/sdk";
import { makeThreadTimelineResponse } from "@/test/fixtures/thread-responses";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadTimelineSurface } from "./ThreadTimelineSurface";
import { useThreadTimelineController } from "./useThreadTimelineController";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: { threads: { timeline: vi.fn() } },
  };
});

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: undefined }),
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useThreadDetailRealtimeSubscription: vi.fn(),
}));

vi.mock("@/hooks/useServerConnectionState", () => ({
  useServerConnectionState: () => "connected",
}));

vi.mock("./ThreadTimelineRows.js", () => ({
  ThreadTimelineRows: () => null,
}));

afterEach(() => {
  cleanup();
  vi.mocked(sdk.threads.timeline).mockReset();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const THREAD_ID = "thread-1";

const latestRow = conversationRow({
  id: "row-latest",
  role: "user",
  sourceSeqStart: 1,
  text: "Latest request",
  threadId: THREAD_ID,
});

const contextClearRow: TimelineRow = {
  id: "context-clear-10",
  kind: "system",
  threadId: THREAD_ID,
  turnId: null,
  sourceSeqStart: 10,
  sourceSeqEnd: 10,
  startedAt: 10,
  createdAt: 10,
  systemKind: "operation",
  operationKind: "generic",
  title: "Context cleared",
  detail: null,
  status: "completed",
  completedAt: 10,
};

function installIntersectionObserverStub(): IntersectionObserverCallback[] {
  const callbacks: IntersectionObserverCallback[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        callbacks.push(callback);
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
  return callbacks;
}

function createBottomAnchor(): BottomAnchorContextValue {
  const scrollElement = document.createElement("div");
  vi.spyOn(scrollElement, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 100, 500),
  );
  return {
    captureScrollAnchor: vi.fn(),
    getScrollElement: () => scrollElement,
    isAtBottom: false,
    scrollElementIntoView: vi.fn(),
    scrollElementIntoViewClampedToMaxScroll: vi.fn(),
    scrollToBottom: vi.fn(),
  };
}

function emitLatestSentinelIntersection(
  callbacks: IntersectionObserverCallback[],
): void {
  const callback = callbacks.at(-1);
  if (callback === undefined) {
    throw new Error("The load-older sentinel is not observed");
  }
  act(() => {
    callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

function ControlledTimelineSurface() {
  const timeline = useThreadTimelineController({ threadId: THREAD_ID });
  return (
    <ThreadTimelineSurface
      activeThinking={timeline.activeThinking}
      contextBoundarySeq={timeline.contextBoundarySeq}
      hasOlderTimelineRows={timeline.hasOlderTimelineRows}
      isLoadingOlderTimelineRows={timeline.isLoadingOlderTimelineRows}
      isThreadTimelinePending={
        timeline.timelineLoading && timeline.timelineRows.length === 0
      }
      onLoadOlderRows={timeline.loadOlderTimelineRows}
      showOngoingIndicator={false}
      threadId={THREAD_ID}
      threadRuntimeDisplayStatus="idle"
      timelineError={timeline.timelineError !== null}
      timelineRows={timeline.timelineRows}
      workspaceRootPath={undefined}
    />
  );
}

describe("ThreadTimelineSurface load-older control", () => {
  it("resumes auto-loading after a context boundary replaces a timeline whose older page failed", async () => {
    const intersectionCallbacks = installIntersectionObserverStub();
    vi.mocked(sdk.threads.timeline)
      .mockResolvedValueOnce(
        makeThreadTimelineResponse({
          rows: [latestRow],
          maxSeq: 1,
          timelinePage: {
            historySnapshot: "snapshot-1",
            hasOlderRows: true,
            olderCursor: { anchorId: latestRow.id, anchorSeq: 1 },
          },
        }),
      )
      .mockRejectedValueOnce(
        new BbHttpError({
          body: null,
          code: null,
          message: "Server error",
          status: 500,
        }),
      )
      .mockImplementationOnce(
        () => new Promise<ThreadTimelineResponse>(() => {}),
      );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const anchor = createBottomAnchor();
    render(
      <BottomAnchorContext.Provider value={anchor}>
        <ControlledTimelineSurface />
      </BottomAnchorContext.Provider>,
      { wrapper },
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).not.toBeNull();
    });

    emitLatestSentinelIntersection(intersectionCallbacks);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Load older messages" }),
      ).not.toBeNull();
    });
    expect(sdk.threads.timeline).toHaveBeenCalledTimes(2);

    act(() => {
      queryClient.setQueryData(
        threadTimelineQueryKey(THREAD_ID),
        makeThreadTimelineResponse({
          contextBoundarySeq: 10,
          rows: [contextClearRow],
          maxSeq: 10,
          timelinePage: {
            historySnapshot: "snapshot-2",
            hasOlderRows: true,
            olderCursor: { anchorId: contextClearRow.id, anchorSeq: 10 },
          },
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).not.toBeNull();
    });
    expect(
      screen.queryByRole("button", { name: "Load older messages" }),
    ).toBeNull();

    emitLatestSentinelIntersection(intersectionCallbacks);
    await waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(3);
    });
    expect(vi.mocked(sdk.threads.timeline).mock.calls[2]?.[0]).toMatchObject({
      beforeAnchorId: contextClearRow.id,
      beforeAnchorSeq: "10",
      threadId: THREAD_ID,
    });
  });
});
