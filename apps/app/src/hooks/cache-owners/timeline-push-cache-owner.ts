import { notifyManager, type QueryClient } from "@tanstack/react-query";
import type {
  ThreadTimelineResponse,
  TimelineDeltaMessage,
} from "@bb/server-contract";
import { mergePushedThreadTimelineDelta } from "../queries/thread-queries";
import { threadTimelineQueryKey } from "../queries/query-keys";

interface ThreadTimelineReceipts {
  appliedPushReceipt: number;
  changeReceipt: number;
}

interface TimelineReceipts {
  lastReceipt: number;
  threads: Map<string, ThreadTimelineReceipts>;
}

interface PendingTimelineDelta {
  message: TimelineDeltaMessage;
  receipt: number;
}

type ScheduleFrame = (callback: () => void) => () => void;

interface TimelinePushCacheOwnerOptions {
  queryClient: QueryClient;
  scheduleFrame?: ScheduleFrame;
}

interface TimelinePushCacheOwner {
  dispose: () => void;
  handleTimelineDelta: (message: TimelineDeltaMessage) => void;
}

const timelineReceiptsByClient = new WeakMap<QueryClient, TimelineReceipts>();

function timelineReceiptsFor(queryClient: QueryClient): TimelineReceipts {
  let receipts = timelineReceiptsByClient.get(queryClient);
  if (!receipts) {
    receipts = { lastReceipt: 0, threads: new Map() };
    timelineReceiptsByClient.set(queryClient, receipts);
  }
  return receipts;
}

function threadReceiptsFor(
  receipts: TimelineReceipts,
  threadId: string,
): ThreadTimelineReceipts {
  let thread = receipts.threads.get(threadId);
  if (!thread) {
    thread = { appliedPushReceipt: 0, changeReceipt: 0 };
    receipts.threads.set(threadId, thread);
  }
  return thread;
}

function nextReceipt(receipts: TimelineReceipts): number {
  receipts.lastReceipt += 1;
  return receipts.lastReceipt;
}

function scheduleAnimationFrame(callback: () => void): () => void {
  const frame = window.requestAnimationFrame(callback);
  return () => window.cancelAnimationFrame(frame);
}

export function recordThreadTimelineChange(
  queryClient: QueryClient,
  threadId: string,
): void {
  const receipts = timelineReceiptsFor(queryClient);
  if (
    queryClient.getQueryState(threadTimelineQueryKey(threadId)) === undefined
  ) {
    receipts.threads.delete(threadId);
    return;
  }
  threadReceiptsFor(receipts, threadId).changeReceipt = nextReceipt(receipts);
}

export function forgetThreadTimelineReceipts(
  queryClient: QueryClient,
  threadId: string,
): void {
  timelineReceiptsByClient.get(queryClient)?.threads.delete(threadId);
}

export function trackedTimelineReceiptThreadIdsForTest(
  queryClient: QueryClient,
): string[] {
  return [...(timelineReceiptsByClient.get(queryClient)?.threads.keys() ?? [])];
}

export function isThreadTimelineCaughtUpByPush(
  queryClient: QueryClient,
  threadId: string,
): boolean {
  const thread = timelineReceiptsByClient
    .get(queryClient)
    ?.threads.get(threadId);
  return (
    thread !== undefined && thread.appliedPushReceipt > thread.changeReceipt
  );
}

function applyPushedTimelineDelta(
  queryClient: QueryClient,
  message: TimelineDeltaMessage,
): boolean {
  const queryKey = threadTimelineQueryKey(message.threadId);
  const previous = queryClient.getQueryData<ThreadTimelineResponse>(queryKey);
  const merged = mergePushedThreadTimelineDelta(previous, message);
  if (merged === null) {
    return false;
  }
  if (merged !== previous) {
    queryClient.setQueryData(queryKey, merged);
  }
  return true;
}

export function createTimelinePushCacheOwner({
  queryClient,
  scheduleFrame = scheduleAnimationFrame,
}: TimelinePushCacheOwnerOptions): TimelinePushCacheOwner {
  let pending: PendingTimelineDelta[] = [];
  let cancelScheduledFrame: (() => void) | null = null;

  const applyPending = (): void => {
    cancelScheduledFrame = null;
    const batch = pending;
    pending = [];
    const receipts = timelineReceiptsFor(queryClient);
    notifyManager.batch(() => {
      for (const { message, receipt } of batch) {
        if (applyPushedTimelineDelta(queryClient, message)) {
          threadReceiptsFor(receipts, message.threadId).appliedPushReceipt =
            receipt;
        }
      }
    });
  };

  return {
    dispose: () => {
      cancelScheduledFrame?.();
      cancelScheduledFrame = null;
      pending = [];
    },
    handleTimelineDelta: (message) => {
      pending.push({
        message,
        receipt: nextReceipt(timelineReceiptsFor(queryClient)),
      });
      cancelScheduledFrame ??= scheduleFrame(applyPending);
    },
  };
}
