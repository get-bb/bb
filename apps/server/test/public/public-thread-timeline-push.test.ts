import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { threads } from "@bb/db";
import { turnScope, type ThreadTimelineSubscriptionTarget } from "@bb/domain";
import {
  applyThreadTimelineDelta,
  isThreadTimelineDelta,
  threadTimelineReadResponseSchema,
  threadTimelineSignalSchema,
  type ThreadTimelineResponse,
  type ThreadTimelineSignal,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import {
  seedEvent,
  seedThread,
  seedThreadFixture,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function getTimeline(
  harness: TestAppHarness,
  threadId: string,
  held?: ThreadTimelineResponse,
): Promise<{ delta: boolean; timeline: ThreadTimelineResponse }> {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/timeline${
      held === undefined ? "" : `?afterTag=${held.tag}`
    }`,
  );
  expect(response.status).toBe(200);
  const body = threadTimelineReadResponseSchema.parse(await readJson(response));
  if (!isThreadTimelineDelta(body)) {
    return { delta: false, timeline: body };
  }
  const applied =
    held === undefined ? null : applyThreadTimelineDelta(held, body);
  if (applied === null) {
    throw new Error("timeline delta did not apply to the held window");
  }
  return { delta: true, timeline: applied };
}

async function freshTimeline(
  harness: TestAppHarness,
  threadId: string,
): Promise<ThreadTimelineResponse> {
  return (await getTimeline(harness, threadId)).timeline;
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
  held: ThreadTimelineResponse | null,
  signal: ThreadTimelineSignal,
): ThreadTimelineResponse | null {
  const { timeline } = signal;
  if (!isThreadTimelineDelta(timeline)) {
    return timeline;
  }
  return held === null ? null : applyThreadTimelineDelta(held, timeline);
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
      let client = await freshTimeline(harness, thread.id);

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
          afterSequence: null,
          timeline: {
            maxSeq: index + 2,
            delta: { afterTag: client.tag },
          },
        });
        client = applySignal(client, signal!)!;
        expect(client).toEqual(await freshTimeline(harness, thread.id));
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
      expect(isThreadTimelineDelta(completed!.timeline)).toBe(true);
      expect(applySignal(client, completed!)).toEqual(
        await freshTimeline(harness, thread.id),
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
      expect(applySignal(null, signals[0]!)).toEqual(
        await freshTimeline(harness, thread.id),
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
      expect(isThreadTimelineDelta(first!.timeline)).toBe(false);
      const [second] = await appendAndPush(2);
      const received = applySignal(applySignal(null, first!), second!);
      expect(received).not.toBeNull();
      harness.deps.hub.unregisterClient(socket);
      expect(await appendAndPush(3)).toEqual([]);
      socket = createMockHubSocket();
      harness.deps.hub.subscribe(socket, { ...target });
      const [resumed] = await appendAndPush(4);
      expect(resumed?.timeline).toMatchObject({
        delta: { afterTag: received!.tag },
      });
      expect(applySignal(received, resumed!)).toEqual(
        await freshTimeline(harness, thread.id),
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
      let client = await freshTimeline(harness, thread.id);
      append(2);
      await settlePushes();
      const [pushed] = timelineSignals(socket.messages.splice(0));
      client = applySignal(client, pushed!)!;

      harness.deps.hub.setClientVisible(socket, false);
      append(3);
      await settlePushes();
      expect(timelineSignals(socket.messages.splice(0))).toEqual([]);
      harness.deps.hub.setClientVisible(socket, true);
      const refetched = await getTimeline(harness, thread.id, client);
      expect(refetched.delta).toBe(true);
      client = refetched.timeline;

      append(4);
      await settlePushes();
      const [resumed] = timelineSignals(socket.messages.splice(0));
      expect(resumed?.timeline).toMatchObject({
        maxSeq: 4,
        delta: { afterTag: client.tag },
      });
      expect(applySignal(client, resumed!)).toEqual(
        await freshTimeline(harness, thread.id),
      );
    });
  });

  function seedIdleThreadWithRunningTool(harness: TestAppHarness) {
    const { environment, thread } = seedThreadFixture(harness, {
      thread: { status: "idle" },
    });
    const turn = {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId: "p1",
      scope: turnScope("turn-1"),
    } as const;
    seedTurnStarted(harness.deps, { ...turn, turnId: "turn-1" });
    seedEvent(harness.deps, {
      ...turn,
      sequence: 2,
      type: "item/started",
      data: {
        item: {
          type: "toolCall",
          id: "tool-1",
          tool: "exec_command",
          arguments: { cmd: "pnpm test" },
          status: "pending",
        },
      },
    });
    const target: ThreadTimelineSubscriptionTarget = {
      kind: "thread-timeline",
      threadId: thread.id,
      segmentLimit: null,
      deferContent: false,
    };
    return {
      target,
      thread,
      startTurn() {
        harness.db
          .update(threads)
          .set({ status: "active" })
          .where(eq(threads.id, thread.id))
          .run();
      },
      appendDelta() {
        seedEvent(harness.deps, {
          ...turn,
          sequence: 3,
          type: "item/agentMessage/delta",
          data: { itemId: "assistant-1", delta: "Working\n" },
        });
        harness.deps.hub.notifyThread(thread.id, ["events-appended"]);
      },
    };
  }

  it("pushes a delta to a client that fetched while idle once a turn starts", async () => {
    await withTestHarness(async (harness) => {
      const { appendDelta, startTurn, target, thread } =
        seedIdleThreadWithRunningTool(harness);
      const socket = createMockHubSocket();
      harness.deps.hub.subscribe(socket, target);
      const idleClient = await freshTimeline(harness, thread.id);

      startTurn();
      appendDelta();
      await settlePushes();

      const [pushed] = timelineSignals(socket.messages.splice(0));
      expect(pushed?.timeline).toMatchObject({
        delta: { afterTag: idleClient.tag },
      });
      expect(applySignal(idleClient, pushed!)).toEqual(
        await freshTimeline(harness, thread.id),
      );
    });
  });

  it("brings clients holding idle- and active-built windows of one sequence to the same rows", async () => {
    await withTestHarness(async (harness) => {
      const { appendDelta, startTurn, target, thread } =
        seedIdleThreadWithRunningTool(harness);
      const idleSocket = createMockHubSocket();
      harness.deps.hub.subscribe(idleSocket, target);
      const idleClient = await freshTimeline(harness, thread.id);
      startTurn();
      const activeClient = await freshTimeline(harness, thread.id);
      expect(activeClient.maxSeq).toBe(idleClient.maxSeq);
      expect(activeClient.tag).not.toBe(idleClient.tag);
      const activeSocket = createMockHubSocket();
      harness.deps.hub.subscribe(activeSocket, { ...target });

      appendDelta();
      await settlePushes();

      const fresh = await freshTimeline(harness, thread.id);
      const [idlePush] = timelineSignals(idleSocket.messages.splice(0));
      const [activePush] = timelineSignals(activeSocket.messages.splice(0));
      expect(activePush).toEqual(idlePush);
      expect(applySignal(activeClient, activePush!)).toEqual(fresh);
      expect(applySignal(idleClient, idlePush!)).toBeNull();
      expect(await getTimeline(harness, thread.id, idleClient)).toEqual({
        delta: true,
        timeline: fresh,
      });
    });
  });

  it("keeps pushing exact deltas after history is rewritten", async () => {
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
      let client = await freshTimeline(harness, thread.id);
      append(2);
      await settlePushes();
      client = applySignal(
        client,
        timelineSignals(socket.messages.splice(0))[0]!,
      )!;

      harness.db.$client
        .prepare(
          "UPDATE events SET data = ? WHERE thread_id = ? AND sequence = 2",
        )
        .run(JSON.stringify({ itemId: "a", delta: "rewritten\n" }), thread.id);
      harness.deps.hub.notifyThread(thread.id, ["history-rewritten"]);
      append(3);
      await settlePushes();
      const [rewritten] = timelineSignals(socket.messages.splice(0));
      expect(isThreadTimelineDelta(rewritten!.timeline)).toBe(true);
      const applied = applySignal(client, rewritten!);
      expect(applied).toEqual(await freshTimeline(harness, thread.id));
      expect(JSON.stringify(applied!.rows)).toContain("rewritten");
    });
  });
});
