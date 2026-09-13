// @vitest-environment jsdom

import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import {
  Profiler,
  useLayoutEffect,
  type ProfilerOnRenderCallback,
  type ReactNode,
} from "react";
import { MemoryRouter } from "react-router-dom";
import type { QueryClient } from "@tanstack/react-query";
import type {
  ThreadTimelineResponse,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import { mergeLatestTimelineRows } from "@bb/client-core";
import { createDeferredPromise, type DeferredPromise } from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BottomAnchorContext,
  type BottomAnchorContextValue,
} from "@/components/ui/bottom-anchored-scroll-body.js";
import { BbHttpError, sdk } from "@/lib/sdk";
import { OPTIMISTIC_TIMELINE_ROW_ID_PREFIX } from "@bb/client-core";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { systemRow } from "@/test/fixtures/thread-timeline-rows";
import { useAutoLoadOlderRows } from "./useAutoLoadOlderRows";
import { useScrollToSearchedMessage } from "./useScrollToSearchedMessage";
import {
  TIMELINE_CONTROLLER_PROPS_WITHOUT_ROWS,
  useThreadTimelineController,
  type UseThreadTimelineControllerResult,
} from "./useThreadTimelineController";
import { makeThreadTimelineResponse as makeTimelineResponse } from "@/test/fixtures/thread-responses";

const readTimelineQueryResultKeys = vi.hoisted(() => new Set<PropertyKey>());

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: { threads: { timeline: vi.fn() } },
  };
});

vi.mock("@/hooks/queries/thread-queries", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/queries/thread-queries")>();
  return {
    ...actual,
    useThreadTimeline: (...args: Parameters<typeof actual.useThreadTimeline>) =>
      new Proxy(actual.useThreadTimeline(...args), {
        get(target, key, receiver) {
          readTimelineQueryResultKeys.add(key);
          return Reflect.get(target, key, receiver);
        },
      }),
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
  readTimelineQueryResultKeys.clear();
});

const TIMELINE_QUERY_KEY = threadTimelineQueryKey("thread-1");

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

const contextClearRow = systemRow({
  id: "context-clear-10",
  seq: 10,
  title: "Context cleared",
  detail: null,
});
const newestLoadedRow = makeUserRow("thread-1:user-seed:1", 1);
const olderPageRow = makeUserRow("thread-1:user-seed:0", 0);
const realtimeRow = makeUserRow("thread-1:user-seed:2", 2);

function rowIds(controller: UseThreadTimelineControllerResult): string[] {
  return controller.timelineRows.map((row) => row.id);
}

function makeServerError(): BbHttpError {
  return new BbHttpError({
    body: null,
    code: null,
    message: "Server error",
    status: 500,
  });
}

async function renderControllerWithPendingOlderPage() {
  const olderPage = createDeferredPromise<ThreadTimelineResponse>();
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
    .mockReturnValueOnce(olderPage.promise);

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
    olderPage.resolve(
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
  const failOlderPage = async (error: BbHttpError) => {
    olderPage.reject(error);
    await act(async () => {
      await expect(olderRequest).rejects.toBe(error);
    });
  };
  const publishLatest = (response: ThreadTimelineResponse) => {
    act(() => {
      queryClient.setQueryData(TIMELINE_QUERY_KEY, response);
    });
  };

  return { failOlderPage, publishLatest, result, settleOlderPage };
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
  const emitIntersection = () => {
    for (const callback of intersectionCallbacks) {
      callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    }
  };
  return { anchor, emitIntersection, sentinel };
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

interface ProfiledController {
  latest: () => UseThreadTimelineControllerResult;
  profilerCommitCount: () => number;
}

function renderProfiledController(
  wrapper: (props: { children: ReactNode }) => ReactNode,
): ProfiledController {
  const latestResult: { current: UseThreadTimelineControllerResult | null } = {
    current: null,
  };
  let profilerCommits = 0;
  const onRender: ProfilerOnRenderCallback = () => {
    profilerCommits += 1;
  };

  function ControllerHost() {
    const controller = useThreadTimelineController({ threadId: "thread-1" });
    useLayoutEffect(() => {
      latestResult.current = controller;
    });
    return null;
  }

  render(
    <Profiler id="timeline-controller" onRender={onRender}>
      <ControllerHost />
    </Profiler>,
    { wrapper },
  );

  return {
    latest: () => {
      if (latestResult.current === null) {
        throw new Error("The timeline controller has not committed yet");
      }
      return latestResult.current;
    },
    profilerCommitCount: () => profilerCommits,
  };
}

function flushQueryNotifications(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
}

async function renderSettledController(
  wrapper: (props: { children: ReactNode }) => ReactNode,
  expectedRowIds: string[],
): Promise<ProfiledController> {
  const view = renderProfiledController(wrapper);
  await waitFor(() => {
    expect(view.latest().timelineLoading).toBe(false);
    expect(rowIds(view.latest())).toEqual(expectedRowIds);
  });
  await flushQueryNotifications();
  return view;
}

function startTimelineRefetch(queryClient: QueryClient): void {
  act(() => {
    void queryClient.refetchQueries({ queryKey: TIMELINE_QUERY_KEY });
  });
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
    vi.mocked(sdk.threads.timeline).mockResolvedValue(
      makeTimelineResponse({ rows: [oldRow], maxSeq: 1 }),
    );

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useThreadTimelineController({ threadId: "thread-1" }),
      { wrapper },
    );
    await waitFor(() => {
      expect(rowIds(result.current)).toEqual([oldRow.id]);
    });

    act(() => {
      queryClient.setQueryData(
        TIMELINE_QUERY_KEY,
        makeTimelineResponse({
          contextBoundarySeq: 10,
          maxSeq: 10,
          rows: [contextClearRow],
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.contextBoundarySeq).toBe(10);
      expect(rowIds(result.current)).toEqual([contextClearRow.id]);
    });
  });

  it.each([
    [
      "a context reset changes the surface",
      {
        contextBoundarySeq: 10,
        timelinePage: { historySnapshot: "snapshot-1" },
      },
    ],
    [
      "latest changes the history snapshot",
      { timelinePage: { historySnapshot: "snapshot-2" } },
    ],
  ])(
    "discards an in-flight older page when %s",
    async (_label, latestOverrides) => {
      const { publishLatest, result, settleOlderPage } =
        await renderControllerWithPendingOlderPage();

      publishLatest(
        makeTimelineResponse({
          ...latestOverrides,
          maxSeq: 10,
          rows: [contextClearRow],
        }),
      );
      await waitFor(() => {
        expect(rowIds(result.current)).toEqual([contextClearRow.id]);
      });
      await settleOlderPage();

      expect(rowIds(result.current)).toEqual([contextClearRow.id]);
    },
  );

  it("keeps an initial timeline refetch in loading state instead of showing the previous error", async () => {
    const refetch = createDeferredPromise<ThreadTimelineResponse>();
    vi.mocked(sdk.threads.timeline)
      .mockRejectedValueOnce(makeServerError())
      .mockReturnValueOnce(refetch.promise);

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useThreadTimelineController({ threadId: "thread-1" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.timelineError).toBeInstanceOf(BbHttpError);
    });

    startTimelineRefetch(queryClient);

    await waitFor(() => {
      expect(result.current.timelineLoading).toBe(true);
    });
    expect(result.current.timelineError).toBeNull();

    refetch.resolve(makeTimelineResponse());

    await waitFor(() => {
      expect(result.current.timelineLoading).toBe(false);
      expect(result.current.timelineError).toBeNull();
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(2);
    });
  });

  it.each([
    ["before", true],
    ["after", false],
  ])(
    "keeps an older page that resolves %s a same-snapshot realtime update",
    async (_order, olderPageFirst) => {
      const { publishLatest, result, settleOlderPage } =
        await renderControllerWithPendingOlderPage();
      const publishRealtimeUpdate = async () => {
        publishLatest(makeSameSnapshotRealtimeResponse());
        await waitFor(() => {
          expect(rowIds(result.current)).toContain(realtimeRow.id);
        });
      };

      if (olderPageFirst) {
        await settleOlderPage();
        await publishRealtimeUpdate();
      } else {
        await publishRealtimeUpdate();
        await settleOlderPage();
      }

      expect(rowIds(result.current)).toEqual([
        olderPageRow.id,
        newestLoadedRow.id,
        realtimeRow.id,
      ]);
      expect(result.current.hasOlderTimelineRows).toBe(false);
    },
  );

  it("rejects a failed older page so the caller can offer a retry", async () => {
    const { failOlderPage, result } =
      await renderControllerWithPendingOlderPage();
    expect(result.current.isLoadingOlderTimelineRows).toBe(true);

    await failOlderPage(makeServerError());

    expect(result.current.isLoadingOlderTimelineRows).toBe(false);
    expect(result.current.hasOlderTimelineRows).toBe(true);
    expect(rowIds(result.current)).toEqual([newestLoadedRow.id]);
  });

  it("replaces an applied older page when a later realtime update changes the history snapshot", async () => {
    const { publishLatest, result, settleOlderPage } =
      await renderControllerWithPendingOlderPage();

    await settleOlderPage();
    expect(rowIds(result.current)).toEqual([
      olderPageRow.id,
      newestLoadedRow.id,
    ]);
    publishLatest(
      makeTimelineResponse({
        rows: [contextClearRow],
        maxSeq: 10,
        timelinePage: {
          historySnapshot: "snapshot-2",
          hasOlderRows: true,
          olderCursor: { anchorId: contextClearRow.id, anchorSeq: 10 },
        },
      }),
    );

    await waitFor(() => {
      expect(rowIds(result.current)).toEqual([contextClearRow.id]);
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
      .mockReturnValueOnce(new Promise(() => {}));

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
    expect(rowIds(result.current)).toEqual([
      olderPageRow.id,
      newestLoadedRow.id,
    ]);

    await act(async () => {
      await result.current.loadOlderTimelineRows();
    });

    await waitFor(() => {
      expect(rowIds(result.current)).toEqual([
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
    const { anchor, emitIntersection, sentinel } = installAutoLoadEnvironment();
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
      emitIntersection();
      await waitFor(() => {
        expect(result.current.timeline.hasOlderTimelineRows).toBe(false);
      });
    });

    expect(sdk.threads.timeline).toHaveBeenCalledTimes(3);
    expect(rowIds(result.current.timeline)).toEqual([
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
      TIMELINE_QUERY_KEY,
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
    expect(rowIds(result.current)).toEqual([newestLoadedRow.id]);
    const scrollIntoView = vi.fn();
    const renderedTarget = document.createElement("div");
    renderedTarget.setAttribute("data-timeline-row-id", newestLoadedRow.id);
    renderedTarget.scrollIntoView = scrollIntoView;
    document.body.appendChild(renderedTarget);

    try {
      act(() => {
        queryClient.setQueryData(
          TIMELINE_QUERY_KEY,
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
    const { anchor, emitIntersection, sentinel } = installAutoLoadEnvironment();
    const discardedPage = createDeferredPromise<ThreadTimelineResponse>();
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
      .mockReturnValueOnce(discardedPage.promise)
      .mockReturnValueOnce(new Promise(() => {}));

    const { queryClient, result } = renderControllerWithAutoLoad(anchor);
    await waitFor(() => {
      expect(result.current.timeline.hasOlderTimelineRows).toBe(true);
    });
    act(() => {
      result.current.autoLoad.sentinelRef(sentinel);
    });
    act(emitIntersection);
    await waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(sdk.threads.timeline).mock.calls[1]?.[0]).toMatchObject({
      beforeAnchorId: newestLoadedRow.id,
      beforeAnchorSeq: "1",
    });

    act(() => {
      queryClient.setQueryData(
        TIMELINE_QUERY_KEY,
        makeTimelineResponse({
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
      expect(rowIds(result.current.timeline)).toEqual([contextClearRow.id]);
    });
    expect(sdk.threads.timeline).toHaveBeenCalledTimes(2);

    await act(async () => {
      discardedPage.resolve(
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
      beforeAnchorId: contextClearRow.id,
      beforeAnchorSeq: "10",
      threadId: "thread-1",
    });
    expect(rowIds(result.current.timeline)).toEqual([contextClearRow.id]);
  });
});

describe("useThreadTimelineController commits", () => {
  it.each([
    {
      outcome: "structurally equal data",
      settle: (refetch: DeferredPromise<ThreadTimelineResponse>) =>
        refetch.resolve(
          makeTimelineResponse({ rows: [{ ...newestLoadedRow }], maxSeq: 1 }),
        ),
      commits: 0,
      expectedRowIds: [newestLoadedRow.id],
      activeThinkingId: undefined,
    },
    {
      outcome: "new rows and top-level fields",
      settle: (refetch: DeferredPromise<ThreadTimelineResponse>) =>
        refetch.resolve(
          makeTimelineResponse({
            activeThinking: {
              id: "thinking-1",
              startedAt: 2,
              text: "Considering the request",
              updatedAt: 2,
            },
            maxSeq: 2,
            rows: [newestLoadedRow, realtimeRow],
          }),
        ),
      commits: 1,
      expectedRowIds: [newestLoadedRow.id, realtimeRow.id],
      activeThinkingId: "thinking-1",
    },
    {
      outcome: "an error",
      settle: (refetch: DeferredPromise<ThreadTimelineResponse>) =>
        refetch.reject(makeServerError()),
      commits: 1,
      expectedRowIds: [newestLoadedRow.id],
      activeThinkingId: undefined,
    },
  ])(
    "commits only for changed data when a refetch of a timeline with rows settles with $outcome",
    async ({ activeThinkingId, commits, expectedRowIds, settle }) => {
      const refetch = createDeferredPromise<ThreadTimelineResponse>();
      vi.mocked(sdk.threads.timeline)
        .mockResolvedValueOnce(
          makeTimelineResponse({ rows: [newestLoadedRow], maxSeq: 1 }),
        )
        .mockReturnValueOnce(refetch.promise);
      const { queryClient, wrapper } = createQueryClientTestHarness();
      const view = await renderSettledController(wrapper, [newestLoadedRow.id]);
      const settledCommitCount = view.profilerCommitCount();

      startTimelineRefetch(queryClient);
      await waitFor(() => {
        expect(sdk.threads.timeline).toHaveBeenCalledTimes(2);
      });
      await flushQueryNotifications();
      expect(queryClient.isFetching({ queryKey: TIMELINE_QUERY_KEY })).toBe(1);
      expect(view.profilerCommitCount()).toBe(settledCommitCount);

      await act(async () => {
        settle(refetch);
      });
      await flushQueryNotifications();

      expect(queryClient.isFetching({ queryKey: TIMELINE_QUERY_KEY })).toBe(0);
      expect(view.profilerCommitCount() - settledCommitCount).toBe(commits);
      expect(rowIds(view.latest())).toEqual(expectedRowIds);
      expect(view.latest().activeThinking?.id).toBe(activeThinkingId);
    },
  );

  it("still reports timelineLoading while refetching an empty timeline", async () => {
    vi.mocked(sdk.threads.timeline)
      .mockResolvedValueOnce(makeTimelineResponse())
      .mockReturnValueOnce(new Promise(() => {}));
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const view = await renderSettledController(wrapper, []);

    startTimelineRefetch(queryClient);

    await waitFor(() => {
      expect(view.latest().timelineLoading).toBe(true);
    });
  });

  it("reads only query result properties covered by the notify lists", async () => {
    vi.mocked(sdk.threads.timeline).mockResolvedValueOnce(
      makeTimelineResponse({ rows: [newestLoadedRow], maxSeq: 1 }),
    );
    const { wrapper } = createQueryClientTestHarness();
    await renderSettledController(wrapper, [newestLoadedRow.id]);

    const coveredKeys = new Set<PropertyKey>([
      ...TIMELINE_CONTROLLER_PROPS_WITHOUT_ROWS,
      "refetch",
    ]);
    expect(readTimelineQueryResultKeys.size).toBeGreaterThan(0);
    expect(
      [...readTimelineQueryResultKeys].filter((key) => !coveredKeys.has(key)),
    ).toEqual([]);
  });

  it("commits once on mount with a cached timeline and shows its rows and cursor", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(
      TIMELINE_QUERY_KEY,
      makeTimelineResponse({
        maxSeq: 1,
        rows: [newestLoadedRow],
        timelinePage: {
          hasOlderRows: true,
          olderCursor: { anchorId: newestLoadedRow.id, anchorSeq: 1 },
        },
      }),
    );

    const view = renderProfiledController(wrapper);
    await flushQueryNotifications();

    expect(sdk.threads.timeline).not.toHaveBeenCalled();
    expect(view.profilerCommitCount()).toBe(1);
    expect(rowIds(view.latest())).toEqual([newestLoadedRow.id]);
    expect(view.latest().hasOlderTimelineRows).toBe(true);
  });
});
