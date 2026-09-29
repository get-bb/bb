import { describe, expect, it, vi } from "vitest";
import { turnScope, type RealtimeClientCapability } from "@bb/domain";
import {
  applyTimelineDelta,
  threadTimelineResponseSchema,
  timelineDeltaMessageSchema,
  type ThreadTimelineResponse,
  type TimelineDeltaMessage,
} from "@bb/server-contract";
import { createSlowThreadTimelineBuildLogger } from "../../../src/services/threads/timeline-build-log.js";
import { createThreadTimelineCache } from "../../../src/services/threads/timeline-cache.js";
import { createTimelineLatestRowsCache } from "../../../src/services/threads/timeline-latest-rows-cache.js";
import {
  startTimelineLivePush,
  TIMELINE_LIVE_PUSH_ARM_MS,
} from "../../../src/services/threads/timeline-live-push.js";
import { THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT } from "../../../src/services/threads/timeline.js";
import { createThreadTimelineWindows } from "../../../src/services/threads/timeline-window.js";
import { readJson } from "../../helpers/json.js";
import { createMockHubSocket } from "../../helpers/mock-hub-socket.js";
import { seedEvent, seedThreadFixture } from "../../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const TIMELINE_DELTA: ReadonlySet<RealtimeClientCapability> = new Set([
  "timeline-delta",
]);

async function getTimeline(
  harness: TestAppHarness,
  threadId: string,
  afterSequence?: number,
): Promise<ThreadTimelineResponse> {
  const query =
    afterSequence === undefined ? "" : `?afterSequence=${afterSequence}`;
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/timeline${query}`,
  );
  expect(response.status).toBe(200);
  return threadTimelineResponseSchema.parse(await readJson(response));
}

function waitForPushes(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function pushedDeltas(socket: { messages: string[] }): TimelineDeltaMessage[] {
  return socket.messages.flatMap((message) => {
    const parsed = timelineDeltaMessageSchema.safeParse(JSON.parse(message));
    return parsed.success ? [parsed.data] : [];
  });
}

function seedViewedThread(harness: TestAppHarness) {
  const { environment, thread } = seedThreadFixture(harness, {
    thread: { status: "active" },
  });
  const turn = {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId: "p1",
    scope: turnScope("turn-1"),
  } as const;
  seedEvent(harness.deps, {
    ...turn,
    sequence: 1,
    type: "turn/started",
    data: {},
  });
  let sequence = 1;
  const appendMessage = (text: string): void => {
    sequence += 1;
    seedEvent(harness.deps, {
      ...turn,
      sequence,
      type: "item/completed",
      data: {
        item: { type: "agentMessage", id: `assistant-${sequence}`, text },
      },
    });
  };
  return { appendMessage, thread };
}

describe("timeline live push", () => {
  it("chains pushed deltas for a capable detail subscriber and shares the delta ring with HTTP", async () => {
    await withTestHarness(async (harness) => {
      const { appendMessage, thread } = seedViewedThread(harness);
      const socket = createMockHubSocket();
      harness.deps.hub.registerClient(socket, { capabilities: TIMELINE_DELTA });
      harness.deps.hub.subscribe(socket, {
        kind: "thread-detail",
        threadId: thread.id,
      });
      const initial = await getTimeline(harness, thread.id);

      appendMessage("first");
      await waitForPushes();
      appendMessage("second");
      await waitForPushes();

      const [first, second] = pushedDeltas(socket);
      expect(pushedDeltas(socket)).toHaveLength(2);
      expect(first?.fromMaxSeq).toBe(initial.maxSeq);
      expect(first?.segmentLimit).toBeNull();
      expect(second?.fromMaxSeq).toBe(first?.body.maxSeq);
      expect(second?.body.rows).toEqual([]);
      const firstRows = applyTimelineDelta(initial.rows, first!.body.delta);
      const pushedRows = applyTimelineDelta(firstRows!, second!.body.delta);
      expect(pushedRows).toEqual((await getTimeline(harness, thread.id)).rows);

      const httpAfterPush = await getTimeline(
        harness,
        thread.id,
        second!.body.maxSeq,
      );
      expect(httpAfterPush.delta).toEqual({ upsertRows: [] });
    });
  });

  it("builds once for several notifications in the same tick", async () => {
    await withTestHarness(async (harness) => {
      const { appendMessage, thread } = seedViewedThread(harness);
      const socket = createMockHubSocket();
      harness.deps.hub.registerClient(socket, { capabilities: TIMELINE_DELTA });
      harness.deps.hub.subscribe(socket, {
        kind: "thread-detail",
        threadId: thread.id,
      });
      const initial = await getTimeline(harness, thread.id);

      appendMessage("one");
      appendMessage("two");
      appendMessage("three");
      await waitForPushes();
      await waitForPushes();

      const pushes = pushedDeltas(socket);
      expect(pushes).toHaveLength(1);
      expect(pushes[0]?.fromMaxSeq).toBe(initial.maxSeq);
      expect(pushes[0]?.body.maxSeq).toBe(initial.maxSeq + 3);
    });
  });

  it("pushes nothing to sockets that did not announce the capability or for a thread whose timeline was never read", async () => {
    await withTestHarness(async (harness) => {
      const { appendMessage, thread } = seedViewedThread(harness);
      const plainSocket = createMockHubSocket();
      harness.deps.hub.registerClient(plainSocket, {
        capabilities: new Set(),
      });
      harness.deps.hub.subscribe(plainSocket, {
        kind: "thread-detail",
        threadId: thread.id,
      });
      await getTimeline(harness, thread.id);
      appendMessage("unseen");
      await waitForPushes();
      expect(pushedDeltas(plainSocket)).toEqual([]);

      const { appendMessage: appendParent, thread: parentThread } =
        seedViewedThread(harness);
      const childViewerSocket = createMockHubSocket();
      harness.deps.hub.registerClient(childViewerSocket, {
        capabilities: TIMELINE_DELTA,
      });
      harness.deps.hub.subscribe(childViewerSocket, {
        kind: "thread-detail",
        threadId: parentThread.id,
      });
      appendParent("first parent batch");
      await waitForPushes();
      appendParent("second parent batch");
      await waitForPushes();
      expect(pushedDeltas(childViewerSocket)).toEqual([]);

      await getTimeline(harness, parentThread.id);
      appendParent("after the viewer read the timeline");
      await waitForPushes();
      expect(pushedDeltas(childViewerSocket)).toHaveLength(1);
    });
  });

  it("builds only for a thread armed by a recent default timeline read", async () => {
    await withTestHarness(async (harness) => {
      const { appendMessage, thread } = seedViewedThread(harness);
      const socket = createMockHubSocket();
      harness.deps.hub.registerClient(socket, { capabilities: TIMELINE_DELTA });
      harness.deps.hub.subscribe(socket, {
        kind: "thread-detail",
        threadId: thread.id,
      });
      let now = 1_000_000;
      const timelineWindows = createThreadTimelineWindows({
        deps: harness.deps,
        slowTimelineBuildLogger: createSlowThreadTimelineBuildLogger({
          logger: harness.deps.logger,
        }),
        timelineCache: createThreadTimelineCache(),
        timelineLatestRowsCache: createTimelineLatestRowsCache(),
      });
      const build = vi.spyOn(timelineWindows, "build");
      const livePush = startTimelineLivePush({
        db: harness.deps.db,
        hub: harness.deps.hub,
        logger: harness.deps.logger,
        now: () => now,
        timelineWindows,
      });
      try {
        appendMessage("parent-only subscription");
        await waitForPushes();
        expect(build).not.toHaveBeenCalled();

        const request = {
          includeNestedRows: false,
          page: {
            kind: "latest",
            segmentLimit: THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT,
          },
          summaryOnly: false,
        } as const;
        const read = timelineWindows.build(thread, request);
        timelineWindows.timelineLatestRowsCache.set(thread.id, read.paramsKey, {
          maxSeq: read.maxSeq,
          rows: read.full.rows,
        });
        livePush.noteTimelineRead({
          paramsKey: read.paramsKey,
          request,
          threadId: thread.id,
        });
        build.mockClear();

        appendMessage("viewed");
        await waitForPushes();
        expect(build).toHaveBeenCalledTimes(1);
        const pushesWhileArmed = pushedDeltas(socket).length;
        expect(pushesWhileArmed).toBeGreaterThan(0);

        now += TIMELINE_LIVE_PUSH_ARM_MS;
        build.mockClear();
        appendMessage("after the arm expired");
        await waitForPushes();
        expect(build).not.toHaveBeenCalled();
        expect(pushedDeltas(socket)).toHaveLength(pushesWhileArmed);
      } finally {
        livePush.stop();
      }
    });
  });
});
