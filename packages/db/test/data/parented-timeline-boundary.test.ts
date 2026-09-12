import { and, eq, or, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  THREAD_CONTEXT_CLEAR_OPERATION,
  threadScope,
  turnScope,
  type ThreadEventItemType,
  type ThreadEventType,
} from "@bb/domain";
import { createConnection, type DbConnection } from "../../src/connection.js";
import {
  getFirstParentedTimelineBoundarySequence,
  insertEvents,
  type InsertEventInput,
} from "../../src/data/events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { events } from "../../src/schema.js";

interface BoundaryArgs {
  maxSeq: number;
  sequenceStart: number;
  threadId: string;
}

type Random = () => number;

const ROOT_TURN_IDS = ["turn-a", "turn-b", "turn-c"] as const;
const NESTED_TURN_IDS = ["nested-a", "nested-b"] as const;
const CALL_IDS = ["call-a", "call-b", "call-c"] as const;
const THREAD_COUNT = 200;
const RANGES_PER_THREAD = 6;
const EQUIVALENCE_TIMEOUT_MS = 60_000;

function legacySegmentAnchorConditions(threadId: string) {
  return and(
    eq(events.threadId, threadId),
    or(
      and(
        eq(events.type, "client/turn/requested"),
        sql`(
          COALESCE(json_extract(${events.data}, '$.target.kind'), 'new-turn')
            IN ('thread-start', 'new-turn')
          OR (
            json_extract(${events.data}, '$.target.kind') IN ('auto', 'steer')
            AND json_extract(${events.data}, '$.target.expectedTurnId') IS NULL
          )
        )`,
        sql`EXISTS (
          SELECT 1
          FROM json_each(${events.data}, '$.input') AS input_part
          WHERE (
            json_extract(input_part.value, '$.type') = 'text'
            AND COALESCE(json_extract(input_part.value, '$.text'), '') <> ''
          )
          OR json_extract(input_part.value, '$.type')
            IN ('image', 'localImage', 'localFile')
        )`,
      ),
      and(
        eq(events.type, "system/operation"),
        sql`json_extract(${events.data}, '$.operation') = ${THREAD_CONTEXT_CLEAR_OPERATION}`,
        sql`json_extract(${events.data}, '$.status') = 'completed'`,
      ),
    ),
  );
}

function legacyFirstParentedTimelineBoundarySequence(
  db: DbConnection,
  args: BoundaryArgs,
): number | null {
  const result = db.get<{ sequence: number | null }>(sql`
    WITH parents AS MATERIALIZED (
      SELECT item_id, turn_id, min(sequence) AS start
      FROM events INDEXED BY events_delegating_item_lookup_idx
      WHERE thread_id = ${args.threadId}
        AND item_kind IN ('toolCall', 'delegation')
        AND parent_tool_call_id IS NULL
        AND sequence >= ${args.sequenceStart} AND sequence <= ${args.maxSeq}
        AND EXISTS (
          SELECT 1 FROM events AS root_start
          WHERE root_start.thread_id = events.thread_id
            AND root_start.turn_id = events.turn_id
            AND root_start.type = 'turn/started'
            AND root_start.parent_tool_call_id IS NULL
            AND root_start.sequence <= ${args.maxSeq}
        )
      GROUP BY item_id, turn_id
    ), spans AS MATERIALIZED (
      SELECT start, (
        SELECT max(child.sequence)
        FROM events AS child INDEXED BY events_parent_tool_call_thread_parent_sequence_idx
        WHERE child.thread_id = ${args.threadId}
          AND child.parent_tool_call_id IS NOT NULL
          AND child.parent_tool_call_id = parents.item_id
          AND child.sequence <= ${args.maxSeq}
      ) AS end FROM parents
    )
    SELECT min(${events.sequence}) AS sequence
    FROM events INNER JOIN spans
      ON ${events.sequence} > spans.start AND ${events.sequence} < spans.end
    WHERE ${events.type} = 'client/turn/requested'
      AND ${legacySegmentAnchorConditions(args.threadId)}
      AND json_extract(${events.data}, '$.initiator') = 'user'
  `);
  return result?.sequence ?? null;
}

function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(random: Random, values: readonly T[]): T {
  const choiceIndex = Math.floor(random() * values.length);
  for (const [index, value] of values.entries()) {
    if (index === choiceIndex) {
      return value;
    }
  }
  throw new Error("Expected a non-empty choice list");
}

function randomInteger(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function randomRequestData(random: Random, index: number): string {
  const input = pick(random, [
    [{ type: "text", text: "hello" }],
    [{ type: "text", text: "hello" }],
    [
      { type: "text", text: "" },
      { type: "localImage", path: "/tmp/a.png" },
    ],
    [{ type: "text", text: "" }],
    [{ type: "image", url: "https://example.com/a.png" }],
    [{ type: "localFile", path: "/tmp/a.txt" }],
    [],
    undefined,
  ]);
  const target = pick(random, [
    { kind: "new-turn" },
    { kind: "new-turn" },
    { kind: "thread-start" },
    { kind: "auto" },
    { kind: "steer" },
    { kind: "steer", expectedTurnId: "turn-a" },
    { kind: "queue" },
    undefined,
  ]);
  const initiator = pick(random, ["user", "user", "user", "agent", undefined]);
  return JSON.stringify({
    requestId: `request-${index}`,
    initiator,
    input,
    target,
  });
}

function generateThreadEvents(
  random: Random,
  threadId: string,
): InsertEventInput[] {
  const eventCount = randomInteger(random, 4, 36);
  const rows: InsertEventInput[] = [];
  let sequence = 0;
  for (let index = 0; index < eventCount; index += 1) {
    sequence += random() < 0.15 ? 2 : 1;
    const base = { threadId, sequence };
    const choice = random();
    if (choice < 0.14) {
      rows.push({
        ...base,
        data: "{}",
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        scope: turnScope(pick(random, ROOT_TURN_IDS)),
        type: "turn/started",
      });
    } else if (choice < 0.22) {
      rows.push({
        ...base,
        data: "{}",
        itemId: null,
        itemKind: null,
        parentToolCallId: pick(random, CALL_IDS),
        scope: turnScope(pick(random, [...NESTED_TURN_IDS, ...ROOT_TURN_IDS])),
        type: "turn/started",
      });
    } else if (choice < 0.46) {
      const itemKind: ThreadEventItemType = pick(random, [
        "toolCall",
        "toolCall",
        "delegation",
        "commandExecution",
      ]);
      const type: ThreadEventType = pick(random, [
        "item/started",
        "item/completed",
      ]);
      rows.push({
        ...base,
        data: "{}",
        itemId: pick(random, CALL_IDS),
        itemKind,
        parentToolCallId: random() < 0.2 ? pick(random, CALL_IDS) : null,
        scope:
          random() < 0.15
            ? threadScope()
            : turnScope(pick(random, [...ROOT_TURN_IDS, ...NESTED_TURN_IDS])),
        type,
      });
    } else if (choice < 0.64) {
      const type: ThreadEventType = pick(random, [
        "item/agentMessage/delta",
        "item/started",
        "item/completed",
      ]);
      rows.push({
        ...base,
        data: "{}",
        itemId: `child-${index}`,
        itemKind: type === "item/agentMessage/delta" ? null : "agentMessage",
        parentToolCallId: pick(random, CALL_IDS),
        scope: turnScope(pick(random, NESTED_TURN_IDS)),
        type,
      });
    } else if (choice < 0.84) {
      rows.push({
        ...base,
        data: randomRequestData(random, index),
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        scope:
          random() < 0.9
            ? threadScope()
            : turnScope(pick(random, ROOT_TURN_IDS)),
        type: "client/turn/requested",
      });
    } else if (choice < 0.92) {
      rows.push({
        ...base,
        data: '{"status":"completed"}',
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        scope: turnScope(pick(random, ROOT_TURN_IDS)),
        type: "turn/completed",
      });
    } else {
      rows.push({
        ...base,
        data: JSON.stringify({
          initiator: "user",
          operation: THREAD_CONTEXT_CLEAR_OPERATION,
          status: pick(random, ["completed", "running"]),
        }),
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        scope: threadScope(),
        type: "system/operation",
      });
    }
  }
  return rows;
}

describe("getFirstParentedTimelineBoundarySequence", () => {
  it(
    "matches the unhinted root_start query over randomized threads and bounds",
    () => {
      const db = createConnection(":memory:");
      try {
        migrate(db);
        const host = upsertHost(db, noopNotifier, {
          name: "parented-boundary-host",
        });
        const { project } = createProject(db, noopNotifier, {
          name: "parented-boundary-project",
          source: {
            type: "local_path",
            hostId: host.id,
            path: "/tmp/parented-boundary",
          },
        });
        let comparisons = 0;
        let matchedBoundaries = 0;
        for (let seed = 1; seed <= THREAD_COUNT; seed += 1) {
          const random = createRandom(seed);
          const thread = createThread(db, noopNotifier, {
            projectId: project.id,
            providerId: "codex",
          });
          const rows = generateThreadEvents(random, thread.id);
          insertEvents(db, noopNotifier, rows);
          const lastSequence = rows.at(-1)?.sequence ?? 0;
          const ranges: Array<Pick<BoundaryArgs, "maxSeq" | "sequenceStart">> =
            [
              { sequenceStart: 0, maxSeq: lastSequence },
              { sequenceStart: 0, maxSeq: lastSequence + 1 },
            ];
          for (let index = 0; index < RANGES_PER_THREAD; index += 1) {
            ranges.push({
              sequenceStart: randomInteger(random, 0, lastSequence + 1),
              maxSeq: randomInteger(random, 0, lastSequence + 1),
            });
          }
          for (const range of ranges) {
            const args = { ...range, threadId: thread.id };
            const expected = legacyFirstParentedTimelineBoundarySequence(
              db,
              args,
            );
            expect(
              getFirstParentedTimelineBoundarySequence(db, args),
              JSON.stringify({ seed, args }),
            ).toBe(expected);
            comparisons += 1;
            if (expected !== null) {
              matchedBoundaries += 1;
            }
          }
        }
        expect(comparisons).toBe(THREAD_COUNT * (RANGES_PER_THREAD + 2));
        expect(matchedBoundaries).toBeGreaterThan(THREAD_COUNT / 10);
      } finally {
        db.$client.close();
      }
    },
    EQUIVALENCE_TIMEOUT_MS,
  );
});
