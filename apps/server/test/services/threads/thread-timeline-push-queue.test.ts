import { describe, expect, it } from "vitest";
import { threadScope, type ThreadTimelineSubscriptionTarget } from "@bb/domain";
import {
  applyThreadTimelineDelta,
  isThreadTimelineDelta,
  threadTimelineSignalSchema,
  type ThreadTimelineResponse,
  type ThreadTimelineSignal,
} from "@bb/server-contract";
import type { DbConnection } from "@bb/db";
import {
  createInProcessThreadReadPool,
  type ThreadReadPool,
} from "../../../src/services/threads/read-pool/thread-read-pool.js";
import {
  createThreadTimelineWindows,
  type ThreadTimelineWindowRequest,
} from "../../../src/services/threads/thread-timeline-windows.js";
import { NotificationHub } from "../../../src/ws/hub.js";
import { createMockHubSocket } from "../../helpers/mock-hub-socket.js";
import { seedEvent, seedThreadFixture } from "../../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const request: ThreadTimelineWindowRequest = {
  deferContent: false,
  includeNestedRows: false,
  page: { kind: "latest", segmentLimit: 20 },
};

function heldReads(db: DbConnection) {
  const inner = createInProcessThreadReadPool(db);
  const held: Array<() => void> = [];
  const stats = { inFlight: 0, maxInFlight: 0, started: 0 };
  const pool: ThreadReadPool = {
    async run(read) {
      stats.started += 1;
      stats.inFlight += 1;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      const result = await inner.run(read);
      await new Promise<void>((resolve) => held.push(resolve));
      stats.inFlight -= 1;
      return result;
    },
    close: async () => {},
  };
  return {
    pool,
    stats,
    async releaseNext(): Promise<void> {
      await expect.poll(() => held.length, { timeout: 5_000 }).toBe(1);
      held.shift()!();
    },
    pending: () => held.length,
  };
}

function seedMessage(
  harness: TestAppHarness,
  args: { environmentId: string; sequence: number; threadId: string },
): void {
  seedEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    sequence: args.sequence,
    type: "system/manager/user_message",
    scope: threadScope(),
    data: { text: `message ${args.sequence}` },
  });
}

function timelineSignals(messages: readonly string[]): ThreadTimelineSignal[] {
  return messages
    .map((message) => JSON.parse(message))
    .filter((message) => message.type === "thread-timeline")
    .map((message) => threadTimelineSignalSchema.parse(message));
}

describe("queued thread timeline pushes", () => {
  it("keeps one build in flight per thread and coalesces appends into one ordered follow-up push", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const seed = (sequence: number) =>
        seedMessage(harness, {
          environmentId: environment.id,
          sequence,
          threadId: thread.id,
        });
      seed(1);
      const reads = heldReads(harness.deps.db);
      const hub = new NotificationHub();
      const windows = createThreadTimelineWindows({
        ...harness.deps,
        hub,
        threadReads: reads.pool,
      });
      const initialRead = windows.read(thread.id, request, undefined);
      await reads.releaseNext();
      const initial = await initialRead;
      if (isThreadTimelineDelta(initial)) throw new Error("expected a window");
      const target: ThreadTimelineSubscriptionTarget = {
        kind: "thread-timeline",
        threadId: thread.id,
        segmentLimit: null,
        deferContent: false,
      };
      const socket = createMockHubSocket();
      hub.subscribe(socket, target, initial.tag);
      await reads.releaseNext();
      await expect.poll(() => reads.stats.inFlight).toBe(0);

      seed(2);
      hub.notifyThread(thread.id, ["events-appended"]);
      await expect.poll(() => reads.pending()).toBe(1);
      seed(3);
      hub.notifyThread(thread.id, ["events-appended"]);
      seed(4);
      hub.notifyThread(thread.id, ["events-appended"]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(reads.stats.inFlight).toBe(1);
      expect(reads.pending()).toBe(1);

      await reads.releaseNext();
      await reads.releaseNext();
      await expect.poll(() => timelineSignals(socket.messages).length).toBe(2);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const signals = timelineSignals(socket.messages);
      expect(signals.map((signal) => signal.timeline.maxSeq)).toEqual([2, 4]);
      expect(reads.stats.maxInFlight).toBe(1);
      expect(reads.pending()).toBe(0);
      let client: ThreadTimelineResponse | null = initial;
      for (const signal of signals) {
        if (!isThreadTimelineDelta(signal.timeline)) {
          throw new Error("expected delta pushes");
        }
        client = applyThreadTimelineDelta(client!, signal.timeline);
        expect(client).not.toBeNull();
      }
      const fresh = await createThreadTimelineWindows({
        ...harness.deps,
        hub: new NotificationHub(),
        threadReads: createInProcessThreadReadPool(harness.deps.db),
      }).read(thread.id, request, undefined);
      expect(client!.tag).toBe(fresh.tag);
      expect(JSON.stringify(client!.rows)).toContain("message 4");
    });
  });
});
