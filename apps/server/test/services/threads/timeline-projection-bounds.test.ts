import { describe, expect, it } from "vitest";
import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import {
  clearTimelineProjections,
  listTimelineProjections,
  MAX_TIMELINE_PROJECTION_DATA_BYTES,
} from "../../../src/services/threads/timeline-projection.js";
import { createTestProviderRegistry } from "../../helpers/provider-registry.js";
import {
  appendRows as append,
  withTestThread,
  type RowSpec,
  type TestThread,
} from "../../helpers/timeline-cache-fixture.js";
import { buildRouteTimelinePage } from "../../provider-corpus/corpus-harness.js";

const registry = await createTestProviderRegistry();

function turnRows(index: number, close: boolean): RowSpec[] {
  const turnId = `turn-${index}`;
  const requestId = encodeClientTurnRequestIdNumber({ value: index });
  return [
    {
      data: {
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId,
        senderThreadId: null,
        input: [{ type: "text", text: `User ${index}`, mentions: [] }],
        target: index === 1 ? { kind: "thread-start" } : { kind: "new-turn" },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
      },
      type: "client/turn/requested",
    },
    { data: {}, turnId, type: "turn/started" },
    {
      data: { clientRequestId: requestId },
      turnId,
      type: "turn/input/accepted",
    },
    {
      data: {
        item: { id: `message-${index}`, text: "", type: "agentMessage" },
      },
      itemId: `message-${index}`,
      itemKind: "agentMessage",
      turnId,
      type: "item/started",
    },
    ...(close
      ? [
          {
            data: { status: "completed" },
            turnId,
            type: "turn/completed",
          } as const,
        ]
      : []),
  ];
}

function bigDelta(index: number): RowSpec {
  return {
    data: { itemId: "message-3", delta: `${index}`.padEnd(100_000, "x") },
    itemId: "message-3",
    turnId: "turn-3",
    type: "item/agentMessage/delta",
  };
}

function read(testThread: TestThread, segmentLimit: number) {
  return buildRouteTimelinePage({
    db: testThread.db,
    eventBudget: 1_000_000,
    includeDiagnosticOperations: false,
    page: { kind: "latest", segmentLimit },
    registry,
    thread: testThread.thread,
    variant: "default",
  });
}

function mediumDelta(index: number): RowSpec {
  return {
    data: { itemId: "message-3", delta: `${index}`.padEnd(30_000, "y") },
    itemId: "message-3",
    turnId: "turn-3",
    type: "item/agentMessage/delta",
  };
}

function historyDelta(index: number): RowSpec {
  return {
    data: { itemId: "message-1", delta: `${index}`.padEnd(100_000, "h") },
    itemId: "message-1",
    turnId: "turn-1",
    type: "item/agentMessage/delta",
  };
}

function projectionServing(testThread: TestThread, segmentLimit: number) {
  return listTimelineProjections(testThread.db).find((projection) =>
    projection.servedSegmentLimits.has(segmentLimit),
  );
}

describe("timeline projection bounds", () => {
  it("keeps every retained projection within the data budget while a window grows past it", () => {
    withTestThread((testThread) => {
      append(testThread, [
        ...turnRows(1, true),
        ...turnRows(2, true),
        ...turnRows(3, false),
      ]);
      read(testThread, 1);
      read(testThread, 3);
      expect(listTimelineProjections(testThread.db)).toHaveLength(2);
      let delta = 0;
      for (let batch = 0; batch < 30; batch += 1) {
        append(
          testThread,
          Array.from({ length: 10 }, () => bigDelta((delta += 1))),
        );
        read(testThread, 3);
        const retained = listTimelineProjections(testThread.db).reduce(
          (total, projection) => total + projection.dataBytes,
          0,
        );
        expect(retained).toBeLessThanOrEqual(
          MAX_TIMELINE_PROJECTION_DATA_BYTES,
        );
      }
    });
  }, 120_000);

  it("keeps a sibling window within the budget after the served window outgrows it", () => {
    withTestThread((testThread) => {
      append(testThread, turnRows(1, false));
      append(
        testThread,
        Array.from({ length: 100 }, (_, index) => historyDelta(index)),
      );
      append(testThread, [
        {
          data: { status: "completed" },
          turnId: "turn-1",
          type: "turn/completed",
        },
        ...turnRows(2, true),
        ...turnRows(3, false),
      ]);
      read(testThread, 1);
      read(testThread, 3);
      let delta = 0;
      for (const count of [5, 5, 5, 5, 5, 40, ...Array<number>(20).fill(10)]) {
        append(
          testThread,
          Array.from({ length: count }, () => bigDelta((delta += 1))),
        );
        read(testThread, 3);
        for (const projection of listTimelineProjections(testThread.db)) {
          expect(projection.dataBytes).toBeLessThanOrEqual(
            MAX_TIMELINE_PROJECTION_DATA_BYTES,
          );
        }
      }
    });
  }, 120_000);

  it("catches up only the windows a read uses", () => {
    withTestThread((testThread) => {
      append(testThread, [
        ...turnRows(1, true),
        ...turnRows(2, true),
        ...turnRows(3, false),
      ]);
      read(testThread, 1);
      read(testThread, 3);
      const unread = projectionServing(testThread, 1)!;
      const unreadMaxSeq = unread.maxSeq;
      for (let index = 0; index < 5; index += 1) {
        append(testThread, [mediumDelta(index)]);
        read(testThread, 3);
      }
      expect(projectionServing(testThread, 3)!.maxSeq).toBeGreaterThan(
        unreadMaxSeq,
      );
      expect(projectionServing(testThread, 1)).toBe(unread);
      expect(unread.maxSeq).toBe(unreadMaxSeq);

      const caughtUp = read(testThread, 1).response;
      clearTimelineProjections(testThread.db);
      expect(caughtUp).toEqual(read(testThread, 1).response);
    });
  });
});
