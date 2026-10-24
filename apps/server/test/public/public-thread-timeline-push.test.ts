import { describe, expect, it } from "vitest";
import { turnScope, type ThreadTimelineSubscriptionTarget } from "@bb/domain";
import {
  applyTimelineDelta,
  threadTimelineResponseSchema,
  threadTimelineSignalSchema,
  type ThreadTimelineResponse,
  type ThreadTimelineSignal,
  type TimelineRow,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import { seedEvent, seedThread, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function getTimeline(
  harness: TestAppHarness,
  threadId: string,
  afterSequence?: number,
): Promise<ThreadTimelineResponse> {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/timeline${
      afterSequence === undefined ? "" : `?afterSequence=${afterSequence}`
    }`,
  );
  expect(response.status).toBe(200);
  return threadTimelineResponseSchema.parse(await readJson(response));
}

function settlePushes(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

function timelineSignals(messages: readonly string[]): ThreadTimelineSignal[] {
  return messages
    .map((message) => JSON.parse(message))
    .filter((message) => message.type === "thread-timeline")
    .map((message) => threadTimelineSignalSchema.parse(message));
}

function applySignal(
  rows: readonly TimelineRow[],
  signal: ThreadTimelineSignal,
): TimelineRow[] | null {
  return signal.timeline.delta === undefined
    ? signal.timeline.rows
    : applyTimelineDelta(rows, signal.timeline.delta);
}

describe("thread-timeline realtime push", () => {
  it("pushes deltas from the fetched window that keep a subscriber equal to a fresh GET", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
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
      const target: ThreadTimelineSubscriptionTarget = {
        kind: "thread-timeline",
        threadId: thread.id,
        segmentLimit: null,
        deferContent: false,
      };
      const socket = createMockHubSocket();
      harness.deps.hub.subscribe(socket, target);
      let client = await getTimeline(harness, thread.id);

      const lines = ["First line\n", "second line\n", "third line\n"];
      for (const [index, delta] of lines.entries()) {
        seedEvent(harness.deps, {
          ...turn,
          sequence: index + 2,
          type: "item/agentMessage/delta",
          data: { itemId: "assistant-1", delta },
        });
        harness.deps.hub.notifyThread(thread.id, ["events-appended"]);
        await settlePushes();
        const [signal] = timelineSignals(socket.messages.splice(0));
        expect(signal).toMatchObject({
          target,
          afterSequence: client.maxSeq,
          timeline: { maxSeq: index + 2 },
        });
        expect(signal!.timeline.delta).toBeDefined();
        const rows = applySignal(client.rows, signal!);
        expect(rows).not.toBeNull();
        client = { ...signal!.timeline, rows: rows!, delta: undefined };
        expect(client).toEqual(await getTimeline(harness, thread.id));
      }

      seedEvent(harness.deps, {
        ...turn,
        sequence: 5,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "assistant-1",
            text: lines.join(""),
          },
        },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 6,
        type: "turn/completed",
        data: { status: "completed" },
      });
      harness.deps.hub.notifyThread(thread.id, ["events-appended"]);
      await settlePushes();
      const [completed] = timelineSignals(socket.messages.splice(0));
      expect(completed?.afterSequence).toBe(4);
      const completedRows = applySignal(client.rows, completed!);
      expect(completedRows).toEqual(
        (await getTimeline(harness, thread.id)).rows,
      );
    });
  });

  it("coalesces notifications in one tick and skips threads without subscribers", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const other = seedThread(harness.deps, {
        projectId: thread.projectId,
        environmentId: environment.id,
      });
      const socket = createMockHubSocket();
      harness.deps.hub.subscribe(socket, {
        kind: "thread-timeline",
        threadId: thread.id,
        segmentLimit: null,
        deferContent: false,
      });
      for (const sequence of [1, 2]) {
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: "p1",
          scope: turnScope("turn-1"),
          sequence,
          type: sequence === 1 ? "turn/started" : "item/agentMessage/delta",
          data: sequence === 1 ? {} : { itemId: "a", delta: "hi\n" },
        });
        harness.deps.hub.notifyThread(thread.id, ["events-appended"]);
        harness.deps.hub.notifyThread(other.id, ["events-appended"]);
      }
      await settlePushes();

      const signals = timelineSignals(socket.messages);
      expect(signals).toHaveLength(1);
      expect(signals[0]).toMatchObject({
        afterSequence: null,
        timeline: { maxSeq: 2 },
      });
      expect(signals[0]!.timeline.rows).toEqual(
        (await getTimeline(harness, thread.id)).rows,
      );
    });
  });

  it("resumes a dropped socket with a delta from the window it last received", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const target: ThreadTimelineSubscriptionTarget = {
        kind: "thread-timeline",
        threadId: thread.id,
        segmentLimit: null,
        deferContent: false,
      };
      let socket = createMockHubSocket();
      const appendAndPush = async (sequence: number) => {
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: "p1",
          scope: turnScope("turn-1"),
          sequence,
          type: sequence === 1 ? "turn/started" : "item/agentMessage/delta",
          data: sequence === 1 ? {} : { itemId: "a", delta: `${sequence}\n` },
        });
        harness.deps.hub.notifyThread(thread.id, ["events-appended"]);
        await settlePushes();
        return timelineSignals(socket.messages.splice(0));
      };

      harness.deps.hub.subscribe(socket, target);
      const [first] = await appendAndPush(1);
      expect(first?.afterSequence).toBeNull();
      const [second] = await appendAndPush(2);
      expect(second?.afterSequence).toBe(1);
      const received = applySignal(first!.timeline.rows, second!);
      harness.deps.hub.unregisterClient(socket);
      expect(await appendAndPush(3)).toEqual([]);
      socket = createMockHubSocket();
      harness.deps.hub.subscribe(socket, { ...target });
      const [resumed] = await appendAndPush(4);
      expect(resumed?.afterSequence).toBe(2);
      expect(applySignal(received!, resumed!)).toEqual(
        (await getTimeline(harness, thread.id)).rows,
      );
    });
  });

  it("resumes a hidden client with deltas over HTTP and the socket", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const target: ThreadTimelineSubscriptionTarget = {
        kind: "thread-timeline",
        threadId: thread.id,
        segmentLimit: null,
        deferContent: false,
      };
      const socket = createMockHubSocket();
      const append = (sequence: number) => {
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: "p1",
          scope: turnScope("turn-1"),
          sequence,
          type: sequence === 1 ? "turn/started" : "item/agentMessage/delta",
          data: sequence === 1 ? {} : { itemId: "a", delta: `${sequence}\n` },
        });
        harness.deps.hub.notifyThread(thread.id, ["events-appended"]);
      };

      append(1);
      harness.deps.hub.subscribe(socket, target);
      let client = await getTimeline(harness, thread.id);
      append(2);
      await settlePushes();
      const [pushed] = timelineSignals(socket.messages.splice(0));
      expect(pushed?.afterSequence).toBe(1);
      client = {
        ...pushed!.timeline,
        rows: applySignal(client.rows, pushed!)!,
        delta: undefined,
      };

      harness.deps.hub.setClientVisible(socket, false);
      append(3);
      await settlePushes();
      expect(timelineSignals(socket.messages.splice(0))).toEqual([]);
      harness.deps.hub.setClientVisible(socket, true);
      const refetched = await getTimeline(harness, thread.id, client.maxSeq);
      expect(refetched.delta).toBeDefined();
      client = {
        ...refetched,
        rows: applyTimelineDelta(client.rows, refetched.delta!)!,
        delta: undefined,
      };

      append(4);
      await settlePushes();
      const [resumed] = timelineSignals(socket.messages.splice(0));
      expect(resumed).toMatchObject({
        afterSequence: 3,
        timeline: { maxSeq: 4 },
      });
      expect(resumed!.timeline.delta).toBeDefined();
      expect(applySignal(client.rows, resumed!)).toEqual(
        (await getTimeline(harness, thread.id)).rows,
      );
    });
  });

  it("pushes a full window after history is rewritten", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const target: ThreadTimelineSubscriptionTarget = {
        kind: "thread-timeline",
        threadId: thread.id,
        segmentLimit: null,
        deferContent: false,
      };
      const socket = createMockHubSocket();
      const append = (sequence: number) => {
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: "p1",
          scope: turnScope("turn-1"),
          sequence,
          type: sequence === 1 ? "turn/started" : "item/agentMessage/delta",
          data: sequence === 1 ? {} : { itemId: "a", delta: `${sequence}\n` },
        });
        harness.deps.hub.notifyThread(thread.id, ["events-appended"]);
      };

      append(1);
      harness.deps.hub.subscribe(socket, target);
      await getTimeline(harness, thread.id);
      append(2);
      await settlePushes();
      expect(timelineSignals(socket.messages.splice(0))[0]?.afterSequence).toBe(
        1,
      );

      harness.deps.hub.notifyThread(thread.id, ["history-rewritten"]);
      await getTimeline(harness, thread.id);
      append(3);
      await settlePushes();
      const [rewritten] = timelineSignals(socket.messages.splice(0));
      expect(rewritten?.afterSequence).toBeNull();
      expect(rewritten?.timeline.rows).toEqual(
        (await getTimeline(harness, thread.id)).rows,
      );
    });
  });
});
