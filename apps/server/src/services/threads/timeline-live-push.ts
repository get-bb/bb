import { getProject, getThread } from "@bb/db";
import type { RealtimeClientCapability } from "@bb/domain";
import { computeTimelineRowDelta } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import type { NotificationHub } from "../../ws/hub.js";
import { runEventLoopWorkSync } from "../system/event-loop-work.js";
import { THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT } from "./timeline.js";
import type {
  ThreadTimelineWindowRequest,
  ThreadTimelineWindows,
} from "./timeline-window.js";

const TIMELINE_DELTA_CAPABILITY =
  "timeline-delta" satisfies RealtimeClientCapability;

const LIVE_PUSH_TIMELINE_REQUEST = {
  includeNestedRows: false,
  page: { kind: "latest", segmentLimit: THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT },
  summaryOnly: false,
} as const;

export const TIMELINE_LIVE_PUSH_ARM_MS = 10 * 60_000;
const TIMELINE_LIVE_PUSH_ARM_PURGE_SIZE = 256;

interface TimelineLivePushArm {
  expiresAt: number;
  paramsKey: string;
}

interface TimelineReadArgs {
  paramsKey: string;
  request: ThreadTimelineWindowRequest;
  threadId: string;
}

export interface TimelineLivePush {
  noteTimelineRead: (args: TimelineReadArgs) => void;
  stop: () => void;
}

function isLivePushRequest({
  includeNestedRows,
  page,
  summaryOnly,
}: ThreadTimelineWindowRequest): boolean {
  return (
    !includeNestedRows &&
    !summaryOnly &&
    page.kind === "latest" &&
    page.segmentLimit === LIVE_PUSH_TIMELINE_REQUEST.page.segmentLimit
  );
}

interface StartTimelineLivePushArgs {
  db: AppDeps["db"];
  hub: Pick<
    NotificationHub,
    | "hasThreadDetailSubscriberWithCapability"
    | "onChangedMessage"
    | "sendTimelineDelta"
  >;
  logger: Pick<AppDeps["logger"], "warn">;
  now?: () => number;
  timelineWindows: ThreadTimelineWindows;
}

export function startTimelineLivePush({
  db,
  hub,
  logger,
  now = Date.now,
  timelineWindows,
}: StartTimelineLivePushArgs): TimelineLivePush {
  const scheduledThreadIds = new Set<string>();
  const armsByThreadId = new Map<string, TimelineLivePushArm>();

  const activeArm = (threadId: string): TimelineLivePushArm | null => {
    const arm = armsByThreadId.get(threadId);
    if (arm === undefined) {
      return null;
    }
    if (arm.expiresAt <= now()) {
      armsByThreadId.delete(threadId);
      return null;
    }
    return arm;
  };

  const purgeExpiredArms = (): void => {
    const currentTime = now();
    for (const [threadId, arm] of armsByThreadId) {
      if (arm.expiresAt <= currentTime) {
        armsByThreadId.delete(threadId);
      }
    }
  };

  const pushLatestTimeline = (threadId: string): void => {
    const arm = activeArm(threadId);
    if (
      arm === null ||
      !hub.hasThreadDetailSubscriberWithCapability(
        threadId,
        TIMELINE_DELTA_CAPABILITY,
      )
    ) {
      return;
    }
    const previous = timelineWindows.timelineLatestRowsCache.getLatest(
      threadId,
      arm.paramsKey,
    );
    if (previous === undefined) {
      return;
    }
    const thread = getThread(db, threadId);
    if (
      thread === null ||
      thread.deletedAt !== null ||
      getProject(db, thread.projectId)?.deletedAt !== null
    ) {
      return;
    }
    const push = runEventLoopWorkSync("timeline-live-push:build", () => {
      const window = timelineWindows.build(thread, LIVE_PUSH_TIMELINE_REQUEST);
      if (
        window.paramsKey !== arm.paramsKey ||
        previous.maxSeq > window.maxSeq
      ) {
        return null;
      }
      timelineWindows.timelineLatestRowsCache.set(threadId, window.paramsKey, {
        maxSeq: window.maxSeq,
        rows: window.full.rows,
      });
      return {
        fromMaxSeq: previous.maxSeq,
        body: {
          ...window.full,
          rows: [],
          delta: computeTimelineRowDelta(previous.rows, window.full.rows),
        },
      };
    });
    if (push === null) {
      return;
    }
    hub.sendTimelineDelta({
      type: "timeline-delta",
      threadId,
      segmentLimit: null,
      ...push,
    });
  };

  const stop = hub.onChangedMessage((message) => {
    if (
      message.entity !== "thread" ||
      !message.changes.includes("events-appended") ||
      scheduledThreadIds.has(message.id) ||
      activeArm(message.id) === null ||
      !hub.hasThreadDetailSubscriberWithCapability(
        message.id,
        TIMELINE_DELTA_CAPABILITY,
      )
    ) {
      return;
    }
    const threadId = message.id;
    scheduledThreadIds.add(threadId);
    setImmediate(() => {
      scheduledThreadIds.delete(threadId);
      try {
        pushLatestTimeline(threadId);
      } catch (error) {
        logger.warn({ err: error, threadId }, "Timeline live push failed");
      }
    });
  });

  return {
    noteTimelineRead: ({ paramsKey, request, threadId }) => {
      if (!isLivePushRequest(request)) {
        return;
      }
      if (armsByThreadId.size >= TIMELINE_LIVE_PUSH_ARM_PURGE_SIZE) {
        purgeExpiredArms();
      }
      armsByThreadId.set(threadId, {
        expiresAt: now() + TIMELINE_LIVE_PUSH_ARM_MS,
        paramsKey,
      });
    },
    stop,
  };
}
