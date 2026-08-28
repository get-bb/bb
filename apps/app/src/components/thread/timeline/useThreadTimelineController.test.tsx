// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  ThreadTimelineResponse,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import { mergeLatestTimelineRows } from "@bb/client-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BbHttpError, sdk } from "@/lib/sdk";
import { OPTIMISTIC_TIMELINE_ROW_ID_PREFIX } from "@bb/client-core";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useThreadTimelineController } from "./useThreadTimelineController";

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
  vi.clearAllMocks();
});

function makeTimelineResponse(): ThreadTimelineResponse {
  return {
    rows: [],
    activePromptMode: null,
    activeThinking: null,
    activeWorkflows: [],
    activeBackgroundCommands: [],
    pendingTodos: null,
    goal: null,
    modelFallback: null,
    maxSeq: 0,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: 0,
      hasOlderRows: false,
      olderCursor: null,
    },
  };
}

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
});
