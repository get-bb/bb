// @vitest-environment jsdom

import {
  Profiler,
  useLayoutEffect,
  type ProfilerOnRenderCallback,
  type ReactNode,
} from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { BbHttpError, sdk } from "@/lib/sdk";
import { makeThreadTimelineResponse } from "@/test/fixtures/thread-responses";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  TIMELINE_CONTROLLER_PROPS_WITHOUT_ROWS,
  TIMELINE_CONTROLLER_PROPS_WITH_ROWS,
  useThreadTimelineController,
  type UseThreadTimelineControllerResult,
} from "./useThreadTimelineController";

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
  vi.clearAllMocks();
  readTimelineQueryResultKeys.clear();
});

const THREAD_ID = "thread-1";
const TIMELINE_QUERY_KEY = threadTimelineQueryKey(THREAD_ID);

const rowA = conversationRow({
  id: "row-a",
  role: "user",
  sourceSeqStart: 1,
  text: "First request",
  threadId: THREAD_ID,
});
const rowB = conversationRow({
  id: "row-b",
  role: "assistant",
  sourceSeqStart: 2,
  text: "First answer",
  threadId: THREAD_ID,
});
const activeThinking = {
  id: "thinking-1",
  startedAt: 2,
  text: "Considering the request",
  updatedAt: 2,
};

interface ControllerCommit {
  activeThinkingId: string | null;
  hasOlderTimelineRows: boolean;
  rowIds: string[];
}

interface ProfiledController {
  commits: ControllerCommit[];
  latest: () => UseThreadTimelineControllerResult;
  profilerCommitCount: () => number;
}

function renderProfiledController(
  wrapper: (props: { children: ReactNode }) => ReactNode,
): ProfiledController {
  const commits: ControllerCommit[] = [];
  const latestResult: { current: UseThreadTimelineControllerResult | null } = {
    current: null,
  };
  let profilerCommits = 0;
  const onRender: ProfilerOnRenderCallback = () => {
    profilerCommits += 1;
  };

  function ControllerHost() {
    const controller = useThreadTimelineController({ threadId: THREAD_ID });
    useLayoutEffect(() => {
      latestResult.current = controller;
      commits.push({
        activeThinkingId: controller.activeThinking?.id ?? null,
        hasOlderTimelineRows: controller.hasOlderTimelineRows,
        rowIds: controller.timelineRows.map((row) => row.id),
      });
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
    commits,
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
    expect(view.latest().timelineRows.map((row) => row.id)).toEqual(
      expectedRowIds,
    );
  });
  await flushQueryNotifications();
  return view;
}

async function startTimelineRefetch(queryClient: QueryClient): Promise<void> {
  act(() => {
    void queryClient.refetchQueries({ queryKey: TIMELINE_QUERY_KEY });
  });
  await waitFor(() => {
    expect(sdk.threads.timeline).toHaveBeenCalledTimes(2);
  });
  await flushQueryNotifications();
}

describe("useThreadTimelineController commits", () => {
  it("does not commit when a refetch starts for a timeline with rows", async () => {
    vi.mocked(sdk.threads.timeline)
      .mockResolvedValueOnce(
        makeThreadTimelineResponse({ rows: [rowA], maxSeq: 1 }),
      )
      .mockImplementationOnce(
        () => new Promise<ThreadTimelineResponse>(() => {}),
      );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const view = await renderSettledController(wrapper, [rowA.id]);
    const settledCommitCount = view.profilerCommitCount();

    await startTimelineRefetch(queryClient);

    expect(queryClient.isFetching({ queryKey: TIMELINE_QUERY_KEY })).toBe(1);
    expect(view.profilerCommitCount()).toBe(settledCommitCount);
  });

  it("does not commit for a refetch that returns structurally equal data", async () => {
    let resolveRefetch: (value: ThreadTimelineResponse) => void = () => {};
    vi.mocked(sdk.threads.timeline)
      .mockResolvedValueOnce(
        makeThreadTimelineResponse({ rows: [rowA], maxSeq: 1 }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ThreadTimelineResponse>((resolve) => {
            resolveRefetch = resolve;
          }),
      );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const view = await renderSettledController(wrapper, [rowA.id]);
    const settledCommitCount = view.profilerCommitCount();
    const dataBeforeRefetch = queryClient.getQueryData(TIMELINE_QUERY_KEY);

    await startTimelineRefetch(queryClient);
    await act(async () => {
      resolveRefetch(
        makeThreadTimelineResponse({ rows: [{ ...rowA }], maxSeq: 1 }),
      );
    });
    await flushQueryNotifications();

    expect(queryClient.isFetching({ queryKey: TIMELINE_QUERY_KEY })).toBe(0);
    expect(queryClient.getQueryData(TIMELINE_QUERY_KEY)).toBe(
      dataBeforeRefetch,
    );
    expect(view.profilerCommitCount()).toBe(settledCommitCount);
  });

  it("still reports timelineLoading while refetching an empty timeline", async () => {
    vi.mocked(sdk.threads.timeline)
      .mockResolvedValueOnce(makeThreadTimelineResponse())
      .mockImplementationOnce(
        () => new Promise<ThreadTimelineResponse>(() => {}),
      );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const view = await renderSettledController(wrapper, []);

    act(() => {
      void queryClient.refetchQueries({ queryKey: TIMELINE_QUERY_KEY });
    });

    await waitFor(() => {
      expect(view.latest().timelineLoading).toBe(true);
    });
  });

  it("commits when a refetch errors for a timeline with rows", async () => {
    let rejectRefetch: (error: Error) => void = () => {};
    vi.mocked(sdk.threads.timeline)
      .mockResolvedValueOnce(
        makeThreadTimelineResponse({ rows: [rowA], maxSeq: 1 }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ThreadTimelineResponse>((_resolve, reject) => {
            rejectRefetch = reject;
          }),
      );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const view = await renderSettledController(wrapper, [rowA.id]);
    await startTimelineRefetch(queryClient);
    const commitCountBeforeError = view.profilerCommitCount();

    await act(async () => {
      rejectRefetch(
        new BbHttpError({
          body: null,
          code: null,
          message: "Server error",
          status: 500,
        }),
      );
    });
    await flushQueryNotifications();

    expect(queryClient.getQueryState(TIMELINE_QUERY_KEY)?.status).toBe("error");
    expect(view.profilerCommitCount()).toBe(commitCountBeforeError + 1);
    expect(view.latest().timelineRows.map((row) => row.id)).toEqual([rowA.id]);
  });

  it("reads only query result properties covered by the notify lists", async () => {
    vi.mocked(sdk.threads.timeline).mockResolvedValueOnce(
      makeThreadTimelineResponse({ rows: [rowA], maxSeq: 1 }),
    );
    const { wrapper } = createQueryClientTestHarness();
    await renderSettledController(wrapper, [rowA.id]);

    expect(TIMELINE_CONTROLLER_PROPS_WITH_ROWS).toEqual([
      "data",
      "error",
      "isLoading",
      "isLoadingError",
    ]);
    expect(TIMELINE_CONTROLLER_PROPS_WITHOUT_ROWS).toEqual([
      ...TIMELINE_CONTROLLER_PROPS_WITH_ROWS,
      "isFetching",
    ]);
    const coveredKeys = new Set<PropertyKey>([
      ...TIMELINE_CONTROLLER_PROPS_WITHOUT_ROWS,
      "refetch",
    ]);
    expect(readTimelineQueryResultKeys.size).toBeGreaterThan(0);
    expect(
      [...readTimelineQueryResultKeys].filter((key) => !coveredKeys.has(key)),
    ).toEqual([]);
  });

  it("commits once when a refetch brings new rows and top-level fields", async () => {
    let resolveRefetch: (value: ThreadTimelineResponse) => void = () => {};
    vi.mocked(sdk.threads.timeline)
      .mockResolvedValueOnce(
        makeThreadTimelineResponse({ rows: [rowA], maxSeq: 1 }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ThreadTimelineResponse>((resolve) => {
            resolveRefetch = resolve;
          }),
      );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const view = await renderSettledController(wrapper, [rowA.id]);
    await startTimelineRefetch(queryClient);
    const commitCountBeforeResponse = view.profilerCommitCount();

    await act(async () => {
      resolveRefetch(
        makeThreadTimelineResponse({
          activeThinking,
          maxSeq: 2,
          rows: [rowA, rowB],
        }),
      );
    });
    await flushQueryNotifications();

    expect(view.latest().timelineRows.map((row) => row.id)).toEqual([
      rowA.id,
      rowB.id,
    ]);
    expect(view.latest().activeThinking?.id).toBe(activeThinking.id);
    expect(view.profilerCommitCount() - commitCountBeforeResponse).toBe(1);
  });

  it("never commits new top-level fields beside stale rows", async () => {
    vi.mocked(sdk.threads.timeline).mockResolvedValueOnce(
      makeThreadTimelineResponse({ rows: [rowA], maxSeq: 1 }),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const view = await renderSettledController(wrapper, [rowA.id]);

    act(() => {
      queryClient.setQueryData(
        TIMELINE_QUERY_KEY,
        makeThreadTimelineResponse({
          activeThinking,
          maxSeq: 2,
          rows: [rowA, rowB],
        }),
      );
    });
    await flushQueryNotifications();

    expect(
      view.commits
        .filter((commit) => commit.activeThinkingId === activeThinking.id)
        .map((commit) => commit.rowIds),
    ).toEqual([[rowA.id, rowB.id]]);
  });

  it("commits once on mount with a cached timeline and shows its rows and cursor", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(
      TIMELINE_QUERY_KEY,
      makeThreadTimelineResponse({
        maxSeq: 1,
        rows: [rowA],
        timelinePage: {
          hasOlderRows: true,
          olderCursor: { anchorId: rowA.id, anchorSeq: 1 },
        },
      }),
    );

    const view = renderProfiledController(wrapper);
    await flushQueryNotifications();

    expect(sdk.threads.timeline).not.toHaveBeenCalled();
    expect(view.profilerCommitCount()).toBe(1);
    expect(view.commits).toEqual([
      {
        activeThinkingId: null,
        hasOlderTimelineRows: true,
        rowIds: [rowA.id],
      },
    ]);
  });
});
