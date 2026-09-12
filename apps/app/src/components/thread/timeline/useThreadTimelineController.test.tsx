// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type {
  ThreadTimelineResponse,
  TimelineRow,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import { mergeLatestTimelineRows } from "@bb/client-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BottomAnchorContext,
  type BottomAnchorContextValue,
} from "@/components/ui/bottom-anchored-scroll-body.js";
import { BbHttpError, sdk } from "@/lib/sdk";
import { OPTIMISTIC_TIMELINE_ROW_ID_PREFIX } from "@bb/client-core";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useAutoLoadOlderRows } from "./useAutoLoadOlderRows";
import { useScrollToSearchedMessage } from "./useScrollToSearchedMessage";
import { useThreadTimelineController } from "./useThreadTimelineController";
import { makeThreadTimelineResponse as makeTimelineResponse } from "@/test/fixtures/thread-responses";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: { threads: { timeline: vi.fn() } },
  };
});

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useThreadDetailRealtimeSubscription: vi.fn(),
}));

vi.mock("@/hooks/useServerConnectionState", () => ({
  useServerConnectionState: () => "connected",
}));

afterEach(() => {
  cleanup();
  vi.mocked(sdk.threads.timeline).mockReset();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function makeUserRow(
  id: string,
  sourceSeq: number,
): TimelineUserConversationRow {
  return {
    id,
    kind: "conversation",
    role: "user",
    threadId: "thread-1",
    turnId: null,
    sourceSeqStart: sourceSeq,
    sourceSeqEnd: sourceSeq,
    startedAt: 1,
    createdAt: 1,
    text: "hello",
    mentions: [],
    attachments: null,
    initiator: "user",
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
  };
}

function makeContextClearRow(sourceSeq: number): TimelineRow {
  return {
    id: `context-clear-${sourceSeq}`,
    kind: "system",
    threadId: "thread-1",
    turnId: null,
    sourceSeqStart: sourceSeq,
    sourceSeqEnd: sourceSeq,
    startedAt: sourceSeq,
    createdAt: sourceSeq,
    systemKind: "operation",
    operationKind: "generic",
    title: "Context cleared",
    detail: null,
    status: "completed",
    completedAt: sourceSeq,
  };
}

const newestLoadedRow = makeUserRow("thread-1:user-seed:1", 1);
const olderPageRow = makeUserRow("thread-1:user-seed:0", 0);
const realtimeRow = makeUserRow("thread-1:user-seed:2", 2);

async function renderControllerWithPendingOlderPage() {
  let resolveOlder: (value: ThreadTimelineResponse) => void = () => {};
  vi.mocked(sdk.threads.timeline)
    .mockResolvedValueOnce(
      makeTimelineResponse({
        rows: [newestLoadedRow],
        maxSeq: 1,
        timelinePage: {
          historySnapshot: "snapshot-1",
          hasOlderRows: true,
          olderCursor: { anchorId: newestLoadedRow.id, anchorSeq: 1 },
        },
      }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<ThreadTimelineResponse>((resolve) => {
          resolveOlder = resolve;
        }),
    );

  const { queryClient, wrapper } = createQueryClientTestHarness();
  const { result } = renderHook(
    () => useThreadTimelineController({ threadId: "thread-1" }),
    { wrapper },
  );
  await waitFor(() => {
    expect(result.current.hasOlderTimelineRows).toBe(true);
  });

  let olderRequest: Promise<void> = Promise.resolve();
  act(() => {
    olderRequest = result.current.loadOlderTimelineRows();
  });
  await waitFor(() => {
    expect(sdk.threads.timeline).toHaveBeenCalledTimes(2);
  });

  const settleOlderPage = async () => {
    resolveOlder(
      makeTimelineResponse({
        rows: [olderPageRow],
        maxSeq: 1,
        timelinePage: { kind: "older", historySnapshot: "snapshot-1" },
      }),
    );
    await act(async () => {
      await olderRequest;
    });
  };
  const publishLatest = (response: ThreadTimelineResponse) => {
    act(() => {
      queryClient.setQueryData(threadTimelineQueryKey("thread-1"), response);
    });
  };

  return { publishLatest, result, settleOlderPage };
}

function makeSameSnapshotRealtimeResponse(): ThreadTimelineResponse {
  return makeTimelineResponse({
    rows: [newestLoadedRow, realtimeRow],
    maxSeq: 2,
    timelinePage: {
      historySnapshot: "snapshot-1",
      hasOlderRows: true,
      olderCursor: { anchorId: newestLoadedRow.id, anchorSeq: 1 },
    },
  });
}

function installAutoLoadEnvironment() {
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
  const scrollElement = document.createElement("div");
  const sentinel = document.createElement("div");
  vi.spyOn(scrollElement, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 100, 500),
  );
  vi.spyOn(sentinel, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 10, 100, 10),
  );
  const anchor: BottomAnchorContextValue = {
    captureScrollAnchor: vi.fn(),
    getScrollElement: () => scrollElement,
    isAtBottom: false,
    scrollElementIntoView: vi.fn(),
    scrollElementIntoViewClampedToMaxScroll: vi.fn(),
    scrollToBottom: vi.fn(),
  };
  return { anchor, intersectionCallbacks, sentinel };
}

function renderControllerWithAutoLoad(anchor: BottomAnchorContextValue) {
  const { queryClient, wrapper: queryWrapper } = createQueryClientTestHarness();
  const wrapper = ({ children }: { children: ReactNode }) =>
    queryWrapper({
      children: (
        <BottomAnchorContext.Provider value={anchor}>
          {children}
        </BottomAnchorContext.Provider>
      ),
    });
  const { result } = renderHook(
    () => {
      const timeline = useThreadTimelineController({ threadId: "thread-1" });
      const autoLoad = useAutoLoadOlderRows({
        hasOlderTimelineRows: timeline.hasOlderTimelineRows,
        isLoadingOlderTimelineRows: timeline.isLoadingOlderTimelineRows,
        onLoadOlderRows: timeline.loadOlderTimelineRows,
      });
      return { autoLoad, timeline };
    },
    { wrapper },
  );
  return { queryClient, result };
}

async function withReactSchedulerOutsideAct(
  run: () => Promise<void>,
): Promise<void> {
  const previousActEnvironment: unknown = Reflect.get(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  try {
    await run();
  } finally {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
  }
}

describe("mergeLatestTimelineRows", () => {
  it("replaces a retained optimistic row with the server row it stands in for", () => {
    const optimistic = makeUserRow(`${OPTIMISTIC_TIMELINE_ROW_ID_PREFIX}a1`, 0);
    const serverRow = makeUserRow("thread-1:user-seed:5", 5);

    const merged = mergeLatestTimelineRows({
      latestRows: [serverRow],
      latestWindowStartSequence: 0,
      loadedRows: [optimistic],
    });

    expect(merged.rows.map((row) => row.id)).toEqual([serverRow.id]);
  });

  it("still appends genuinely disjoint server rows to retained ones", () => {
    const older = makeUserRow("thread-1:user-seed:1", 1);
    const newer = makeUserRow("thread-1:user-seed:5", 5);

    const merged = mergeLatestTimelineRows({
      latestRows: [newer],
      latestWindowStartSequence: 5,
      loadedRows: [older],
    });

    expect(merged.rows.map((row) => row.id)).toEqual([older.id, newer.id]);
  });

  it("keeps a pending optimistic row that the latest snapshot still carries", () => {
    const optimistic = makeUserRow(`${OPTIMISTIC_TIMELINE_ROW_ID_PREFIX}a1`, 0);

    const merged = mergeLatestTimelineRows({
      latestRows: [optimistic],
      latestWindowStartSequence: 0,
      loadedRows: [optimistic],
    });

    expect(merged.rows.map((row) => row.id)).toEqual([optimistic.id]);
  });
});

describe("useThreadTimelineController", () => {
  it("replaces loaded rows when realtime data starts a new context epoch", async () => {
    const oldRow = makeUserRow("thread-1:user-seed:1", 1);
    const boundaryRow: TimelineRow = {
      id: "context-clear-10",
      kind: "system",
      threadId: "thread-1",
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
    vi.mocked(sdk.threads.timeline).mockResolvedValue(
      makeTimelineResponse({ rows: [oldRow], maxSeq: 1 }),
    );

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useThreadTimelineController({ threadId: "thread-1" }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.timelineRows.map((row) => row.id)).toEqual([
        oldRow.id,
      ]);
    });

    act(() => {
      queryClient.setQueryData(
        threadTimelineQueryKey("thread-1"),
        makeTimelineResponse({
          contextBoundarySeq: 10,
          maxSeq: 10,
          rows: [boundaryRow],
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.contextBoundarySeq).toBe(10);
      expect(result.current.timelineRows.map((row) => row.id)).toEqual([
        boundaryRow.id,
      ]);
    });
  });

  it("discards an in-flight older page when a context reset changes the surface", async () => {
    const oldRow = makeUserRow("thread-1:user-seed:1", 1);
    const olderRow = makeUserRow("thread-1:user-seed:0", 0);
    const boundaryRow: TimelineRow = {
      id: "context-clear-10",
      kind: "system",
      threadId: "thread-1",
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
    let resolveOlder: (value: ThreadTimelineResponse) => void = () => {};
    vi.mocked(sdk.threads.timeline)
      .mockResolvedValueOnce(
        makeTimelineResponse({
          rows: [oldRow],
          maxSeq: 1,
          timelinePage: {
            hasOlderRows: true,
            olderCursor: { anchorId: oldRow.id, anchorSeq: 1 },
          },
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ThreadTimelineResponse>((resolve) => {
            resolveOlder = resolve;
          }),
      );

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useThreadTimelineController({ threadId: "thread-1" }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.hasOlderTimelineRows).toBe(true);
    });

    let olderRequest: Promise<void> = Promise.resolve();
    act(() => {
      olderRequest = result.current.loadOlderTimelineRows();
    });
    await waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(2);
    });
    act(() => {
      queryClient.setQueryData(
        threadTimelineQueryKey("thread-1"),
        makeTimelineResponse({
          contextBoundarySeq: 10,
          maxSeq: 10,
          rows: [boundaryRow],
        }),
      );
    });
    await waitFor(() => {
      expect(result.current.timelineRows.map((row) => row.id)).toEqual([
        boundaryRow.id,
      ]);
    });

    resolveOlder(
      makeTimelineResponse({
        rows: [olderRow],
        maxSeq: 1,
        timelinePage: { kind: "older" },
      }),
    );
    await act(async () => {
      await olderRequest;
    });

    expect(result.current.contextBoundarySeq).toBe(10);
    expect(result.current.timelineRows.map((row) => row.id)).toEqual([
      boundaryRow.id,
    ]);
  });

  it("discards an in-flight older page when latest changes the history snapshot", async () => {
    const oldRow = makeUserRow("thread-1:user-seed:1", 1);
    const olderRow = makeUserRow("thread-1:user-seed:0", 0);
    const boundaryRow: TimelineRow = {
      id: "context-clear-10",
      kind: "system",
      threadId: "thread-1",
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
    let resolveOlder: (value: ThreadTimelineResponse) => void = () => {};
    vi.mocked(sdk.threads.timeline)
      .mockResolvedValueOnce(
        makeTimelineResponse({
          rows: [oldRow],
          maxSeq: 1,
          timelinePage: {
            historySnapshot: "before",
            hasOlderRows: true,
            olderCursor: { anchorId: oldRow.id, anchorSeq: 1 },
          },
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ThreadTimelineResponse>((resolve) => {
            resolveOlder = resolve;
          }),
      );

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useThreadTimelineController({ threadId: "thread-1" }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.hasOlderTimelineRows).toBe(true);
    });

    let olderRequest: Promise<void> = Promise.resolve();
    act(() => {
      olderRequest = result.current.loadOlderTimelineRows();
    });
    await waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(2);
    });
    act(() => {
      queryClient.setQueryData(
        threadTimelineQueryKey("thread-1"),
        makeTimelineResponse({
          timelinePage: { historySnapshot: "after" },
          maxSeq: 10,
          rows: [boundaryRow],
        }),
      );
    });
    await waitFor(() => {
      expect(result.current.timelineRows.map((row) => row.id)).toEqual([
        boundaryRow.id,
      ]);
    });

    resolveOlder(
      makeTimelineResponse({
        rows: [olderRow],
        maxSeq: 1,
        timelinePage: { kind: "older", historySnapshot: "before" },
      }),
    );
    await act(async () => {
      await olderRequest;
    });

    expect(result.current.timelineRows.map((row) => row.id)).toEqual([
      boundaryRow.id,
    ]);
  });

  it("keeps an initial timeline refetch in loading state instead of showing the previous error", async () => {
    const response = makeTimelineResponse();
    let resolveRefetch: (value: ThreadTimelineResponse) => void = () => {};
    vi.mocked(sdk.threads.timeline)
      .mockRejectedValueOnce(
        new BbHttpError({
          body: null,
          code: null,
          status: 500,
          message: "Server error",
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ThreadTimelineResponse>((resolve) => {
            resolveRefetch = resolve;
          }),
      );

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useThreadTimelineController({ threadId: "thread-1" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.timelineError).toBeInstanceOf(BbHttpError);
    });

    act(() => {
      void queryClient.refetchQueries({
        queryKey: threadTimelineQueryKey("thread-1"),
      });
    });

    await waitFor(() => {
      expect(result.current.timelineLoading).toBe(true);
    });
    expect(result.current.timelineError).toBeNull();

    resolveRefetch(response);

    await waitFor(() => {
      expect(result.current.timelineLoading).toBe(false);
      expect(result.current.timelineError).toBeNull();
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(2);
    });
  });

  it("keeps an older page that resolves before a same-snapshot realtime update", async () => {
    const { publishLatest, result, settleOlderPage } =
      await renderControllerWithPendingOlderPage();

    await settleOlderPage();
    expect(result.current.timelineRows.map((row) => row.id)).toEqual([
      olderPageRow.id,
      newestLoadedRow.id,
    ]);
    publishLatest(makeSameSnapshotRealtimeResponse());

    await waitFor(() => {
      expect(result.current.timelineRows.map((row) => row.id)).toEqual([
        olderPageRow.id,
        newestLoadedRow.id,
        realtimeRow.id,
      ]);
    });
    expect(result.current.hasOlderTimelineRows).toBe(false);
  });

  it("keeps an older page that resolves after a same-snapshot realtime update", async () => {
    const { publishLatest, result, settleOlderPage } =
      await renderControllerWithPendingOlderPage();

    publishLatest(makeSameSnapshotRealtimeResponse());
    await waitFor(() => {
      expect(result.current.timelineRows.map((row) => row.id)).toEqual([
        newestLoadedRow.id,
        realtimeRow.id,
      ]);
    });
    await settleOlderPage();

    expect(result.current.timelineRows.map((row) => row.id)).toEqual([
      olderPageRow.id,
      newestLoadedRow.id,
      realtimeRow.id,
    ]);
    expect(result.current.hasOlderTimelineRows).toBe(false);
  });

  it("replaces an applied older page when a later realtime update changes the history snapshot", async () => {
    const boundaryRow = makeContextClearRow(10);
    const { publishLatest, result, settleOlderPage } =
      await renderControllerWithPendingOlderPage();

    await settleOlderPage();
    expect(result.current.timelineRows.map((row) => row.id)).toEqual([
      olderPageRow.id,
      newestLoadedRow.id,
    ]);
    publishLatest(
      makeTimelineResponse({
        rows: [boundaryRow],
        maxSeq: 10,
        timelinePage: {
          historySnapshot: "snapshot-2",
          hasOlderRows: true,
          olderCursor: { anchorId: boundaryRow.id, anchorSeq: 10 },
        },
      }),
    );

    await waitFor(() => {
      expect(result.current.timelineRows.map((row) => row.id)).toEqual([
        boundaryRow.id,
      ]);
    });
    expect(result.current.hasOlderTimelineRows).toBe(true);
  });

  it("adopts the refetched latest cursor after a stale older-page cursor", async () => {
    vi.mocked(sdk.threads.timeline)
      .mockResolvedValueOnce(
        makeTimelineResponse({
          rows: [newestLoadedRow],
          maxSeq: 1,
          timelinePage: {
            historySnapshot: "snapshot-1",
            hasOlderRows: true,
            olderCursor: { anchorId: newestLoadedRow.id, anchorSeq: 1 },
          },
        }),
      )
      .mockResolvedValueOnce(
        makeTimelineResponse({
          rows: [olderPageRow],
          maxSeq: 1,
          timelinePage: {
            kind: "older",
            historySnapshot: "snapshot-1",
            hasOlderRows: true,
            olderCursor: { anchorId: olderPageRow.id, anchorSeq: 0 },
          },
        }),
      )
      .mockRejectedValueOnce(
        new BbHttpError({
          body: null,
          code: "invalid_request",
          message: "Stale timeline cursor",
          status: 400,
        }),
      )
      .mockResolvedValueOnce(makeSameSnapshotRealtimeResponse())
      .mockImplementationOnce(
        () => new Promise<ThreadTimelineResponse>(() => {}),
      );

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useThreadTimelineController({ threadId: "thread-1" }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.hasOlderTimelineRows).toBe(true);
    });
    await act(async () => {
      await result.current.loadOlderTimelineRows();
    });
    expect(result.current.timelineRows.map((row) => row.id)).toEqual([
      olderPageRow.id,
      newestLoadedRow.id,
    ]);

    await act(async () => {
      await result.current.loadOlderTimelineRows();
    });

    await waitFor(() => {
      expect(result.current.timelineRows.map((row) => row.id)).toEqual([
        olderPageRow.id,
        newestLoadedRow.id,
        realtimeRow.id,
      ]);
    });
    const timelineRequests = vi.mocked(sdk.threads.timeline).mock.calls;
    expect(timelineRequests[2]?.[0]).toMatchObject({
      beforeAnchorId: olderPageRow.id,
      beforeAnchorSeq: "0",
    });
    expect(timelineRequests[3]?.[0]).toMatchObject({ afterSequence: "1" });
    expect(result.current.isLoadingOlderTimelineRows).toBe(false);
    expect(result.current.hasOlderTimelineRows).toBe(true);

    act(() => {
      void result.current.loadOlderTimelineRows();
    });
    await waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(5);
    });
    expect(vi.mocked(sdk.threads.timeline).mock.calls[4]?.[0]).toMatchObject({
      beforeAnchorId: newestLoadedRow.id,
      beforeAnchorSeq: "1",
    });
  });

  it("keeps auto-loading when an older page settles before its loading state renders", async () => {
    const { anchor, intersectionCallbacks, sentinel } =
      installAutoLoadEnvironment();
    vi.mocked(sdk.threads.timeline)
      .mockResolvedValueOnce(
        makeTimelineResponse({
          rows: [realtimeRow],
          maxSeq: 2,
          timelinePage: {
            historySnapshot: "snapshot-1",
            hasOlderRows: true,
            olderCursor: { anchorId: realtimeRow.id, anchorSeq: 2 },
          },
        }),
      )
      .mockResolvedValueOnce(
        makeTimelineResponse({
          rows: [newestLoadedRow],
          maxSeq: 2,
          timelinePage: {
            kind: "older",
            historySnapshot: "snapshot-1",
            hasOlderRows: true,
            olderCursor: { anchorId: newestLoadedRow.id, anchorSeq: 1 },
          },
        }),
      )
      .mockResolvedValueOnce(
        makeTimelineResponse({
          rows: [olderPageRow],
          maxSeq: 2,
          timelinePage: {
            kind: "older",
            historySnapshot: "snapshot-1",
            hasOlderRows: false,
            olderCursor: null,
          },
        }),
      );

    const { result } = renderControllerWithAutoLoad(anchor);
    await waitFor(() => {
      expect(result.current.timeline.hasOlderTimelineRows).toBe(true);
    });
    act(() => {
      result.current.autoLoad.sentinelRef(sentinel);
    });

    await withReactSchedulerOutsideAct(async () => {
      for (const callback of intersectionCallbacks) {
        callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      }
      await waitFor(() => {
        expect(result.current.timeline.hasOlderTimelineRows).toBe(false);
      });
    });

    expect(sdk.threads.timeline).toHaveBeenCalledTimes(3);
    expect(result.current.timeline.timelineRows.map((row) => row.id)).toEqual([
      olderPageRow.id,
      newestLoadedRow.id,
      realtimeRow.id,
    ]);
  });

  it("retries revealing a searched row when a realtime update changes only top-level fields", async () => {
    const { queryClient, wrapper: queryWrapper } = createQueryClientTestHarness(
      { queries: { staleTime: Infinity } },
    );
    queryClient.setQueryData(
      threadTimelineQueryKey("thread-1"),
      makeTimelineResponse({ rows: [newestLoadedRow], maxSeq: 1 }),
    );
    const wrapper = ({ children }: { children: ReactNode }) =>
      queryWrapper({
        children: (
          <MemoryRouter
            initialEntries={[
              {
                pathname: "/thread",
                state: { searchMessageSeq: 1, searchThreadId: "thread-1" },
              },
            ]}
          >
            {children}
          </MemoryRouter>
        ),
      });
    const { result } = renderHook(
      () => {
        const timeline = useThreadTimelineController({ threadId: "thread-1" });
        useScrollToSearchedMessage(timeline.timelineRows, "thread-1", {
          hasOlderRows: timeline.hasOlderTimelineRows,
          isLoadingOlderRows: timeline.isLoadingOlderTimelineRows,
          onLoadOlderRows: timeline.loadOlderTimelineRows,
        });
        return timeline;
      },
      { wrapper },
    );
    expect(result.current.timelineRows.map((row) => row.id)).toEqual([
      newestLoadedRow.id,
    ]);
    const scrollIntoView = vi.fn();
    const renderedTarget = document.createElement("div");
    renderedTarget.setAttribute("data-timeline-row-id", newestLoadedRow.id);
    renderedTarget.scrollIntoView = scrollIntoView;
    document.body.appendChild(renderedTarget);

    try {
      act(() => {
        queryClient.setQueryData(
          threadTimelineQueryKey("thread-1"),
          makeTimelineResponse({
            activeThinking: {
              id: "thinking-1",
              startedAt: 2,
              text: "Thinking",
              updatedAt: 2,
            },
            rows: [{ ...newestLoadedRow }],
            maxSeq: 2,
          }),
        );
      });

      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
      });
      expect(result.current.activeThinking?.id).toBe("thinking-1");
    } finally {
      renderedTarget.remove();
    }
  });

  it("restarts auto-load with the new cursor after a discarded older page settles", async () => {
    const { anchor, intersectionCallbacks, sentinel } =
      installAutoLoadEnvironment();
    const boundaryRow = makeContextClearRow(10);
    let resolveDiscardedPage: (
      value: ThreadTimelineResponse,
    ) => void = () => {};
    vi.mocked(sdk.threads.timeline)
      .mockResolvedValueOnce(
        makeTimelineResponse({
          rows: [newestLoadedRow],
          maxSeq: 1,
          timelinePage: {
            historySnapshot: "snapshot-1",
            hasOlderRows: true,
            olderCursor: { anchorId: newestLoadedRow.id, anchorSeq: 1 },
          },
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ThreadTimelineResponse>((resolve) => {
            resolveDiscardedPage = resolve;
          }),
      )
      .mockImplementationOnce(
        () => new Promise<ThreadTimelineResponse>(() => {}),
      );

    const { queryClient, result } = renderControllerWithAutoLoad(anchor);
    await waitFor(() => {
      expect(result.current.timeline.hasOlderTimelineRows).toBe(true);
    });
    act(() => {
      result.current.autoLoad.sentinelRef(sentinel);
    });
    act(() => {
      for (const callback of intersectionCallbacks) {
        callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      }
    });
    await waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(sdk.threads.timeline).mock.calls[1]?.[0]).toMatchObject({
      beforeAnchorId: newestLoadedRow.id,
      beforeAnchorSeq: "1",
    });

    act(() => {
      queryClient.setQueryData(
        threadTimelineQueryKey("thread-1"),
        makeTimelineResponse({
          rows: [boundaryRow],
          maxSeq: 10,
          timelinePage: {
            historySnapshot: "snapshot-2",
            hasOlderRows: true,
            olderCursor: { anchorId: boundaryRow.id, anchorSeq: 10 },
          },
        }),
      );
    });
    await waitFor(() => {
      expect(result.current.timeline.timelineRows.map((row) => row.id)).toEqual(
        [boundaryRow.id],
      );
    });
    expect(sdk.threads.timeline).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveDiscardedPage(
        makeTimelineResponse({
          rows: [olderPageRow],
          maxSeq: 1,
          timelinePage: { kind: "older", historySnapshot: "snapshot-1" },
        }),
      );
    });

    await waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(3);
    });
    expect(vi.mocked(sdk.threads.timeline).mock.calls[2]?.[0]).toMatchObject({
      beforeAnchorId: boundaryRow.id,
      beforeAnchorSeq: "10",
      threadId: "thread-1",
    });
    expect(result.current.timeline.timelineRows.map((row) => row.id)).toEqual([
      boundaryRow.id,
    ]);
  });
});
