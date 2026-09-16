import { isBeforeLatestThreadEvent } from "./event-pruning-guards.js";
import { threadPruningCursors } from "../schema.js";
import { and, eq, sql } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";
import type { ThreadEventType } from "@bb/domain";

export interface ResolvedItemPruningProbe {
  probeEventId: string | null;
  probePhase: number;
  probeSequence: number;
  probeWitnessId: string | null;
}

export interface ResolvedItemPruningCandidate {
  id: string;
  sequence: number;
  type: ThreadEventType;
  turnId: string | null;
  itemId: string | null;
  parentToolCallId: string | null;
}
interface Support {
  id: string;
  sequence: number;
  type: string;
  itemKind: string | null;
  itemId: string | null;
  parentToolCallId: string | null;
  hasOutput: number;
}

export function emptyResolvedItemPruningProbe(): ResolvedItemPruningProbe {
  return {
    probeEventId: null,
    probePhase: 0,
    probeSequence: 0,
    probeWitnessId: null,
  };
}

const deltaKinds: Partial<Record<ThreadEventType, string>> = {
  "item/agentMessage/delta": "agentMessage",
  "item/commandExecution/outputDelta": "commandExecution",
  "item/reasoning/summaryTextDelta": "reasoning",
  "item/reasoning/textDelta": "reasoning",
};

export function pruneResolvedItemCandidates(
  db: DbQueryConnection,
  args: {
    threadId: string;
    candidates: readonly ResolvedItemPruningCandidate[];
    kind: "deltas" | "background";
    probe: ResolvedItemPruningProbe;
  },
) {
  const rows = args.candidates;
  const probe = args.probe;
  const discarded: string[] = [];
  let remaining = 500;
  let sequence = 0;
  let processed = 0;
  const reset = () => Object.assign(probe, emptyResolvedItemPruningProbe());
  const readSupport = (
    candidate: ResolvedItemPruningCandidate,
    limit: number,
  ): Support[] => {
    if (args.kind === "background" && probe.probePhase === 0) {
      return db.all<Support>(sql`SELECT id, sequence, type, item_kind AS itemKind, item_id AS itemId, parent_tool_call_id AS parentToolCallId, 1 AS hasOutput
        FROM events INDEXED BY events_item_lifecycle_thread_item_sequence_idx
        WHERE thread_id = ${args.threadId} AND item_id = ${candidate.itemId}
          AND type IN ('item/started', 'item/completed', 'item/backgroundTask/completed')
          AND sequence > ${probe.probeSequence} ORDER BY sequence LIMIT ${limit}`);
    }
    if (args.kind === "background") {
      return db.all<Support>(sql`SELECT id, sequence, type, item_kind AS itemKind, item_id AS itemId, parent_tool_call_id AS parentToolCallId, 1 AS hasOutput
        FROM events INDEXED BY events_thread_type_sequence_idx WHERE thread_id = ${args.threadId} AND type = 'item/backgroundTask/progress'
          AND sequence > ${Math.max(candidate.sequence, probe.probeSequence)} ORDER BY sequence LIMIT ${limit}`);
    }
    if (probe.probePhase === 0) {
      return db.all<Support>(sql`SELECT id, sequence, type, item_kind AS itemKind, item_id AS itemId, parent_tool_call_id AS parentToolCallId,
          CASE WHEN json_valid(data) THEN json_type(data, '$.item.aggregatedOutput') IS NOT NULL ELSE 0 END AS hasOutput
        FROM events INDEXED BY events_thread_turn_type_item_sequence_idx WHERE thread_id = ${args.threadId} AND turn_id = ${candidate.turnId}
          AND type = 'item/completed' AND item_id = ${candidate.itemId}
          AND sequence > ${probe.probeSequence} ORDER BY sequence LIMIT ${limit}`);
    }
    return db.all<Support>(sql`SELECT id, sequence, type, item_kind AS itemKind, item_id AS itemId, parent_tool_call_id AS parentToolCallId, 1 AS hasOutput
      FROM events INDEXED BY events_thread_turn_type_item_sequence_idx WHERE thread_id = ${args.threadId} AND turn_id = ${candidate.turnId}
        AND type = ${candidate.type} AND item_id = ${candidate.itemId}
        AND sequence > ${probe.probeSequence} AND sequence < ${candidate.sequence}
      ORDER BY sequence LIMIT ${limit}`);
  };
  for (const candidate of rows) {
    if (remaining <= 0) break;
    remaining -= 1;
    if (probe.probeEventId !== candidate.id) {
      reset();
      probe.probeEventId = candidate.id;
    }
    const kind = deltaKinds[candidate.type];
    const relevant =
      args.kind === "background"
        ? candidate.type === "item/backgroundTask/progress"
        : kind !== undefined && candidate.turnId !== null;
    let finished = !relevant || candidate.itemId === null;
    if (
      !finished &&
      args.kind === "deltas" &&
      probe.probePhase === 1 &&
      remaining > 0
    ) {
      const witness =
        db.get(sql`SELECT 1 FROM events WHERE id = ${probe.probeWitnessId}
        AND thread_id = ${args.threadId} AND turn_id = ${candidate.turnId} AND type = 'item/completed'
        AND item_id = ${candidate.itemId} AND item_kind = ${kind} AND parent_tool_call_id IS ${candidate.parentToolCallId}
        AND (${candidate.type} <> 'item/commandExecution/outputDelta' OR CASE WHEN json_valid(data) THEN json_type(data, '$.item.aggregatedOutput') IS NOT NULL ELSE 0 END)`);
      remaining -= 1;
      if (!witness) {
        probe.probePhase = 0;
        probe.probeSequence = 0;
        probe.probeWitnessId = null;
      }
    }
    while (!finished && remaining > 0) {
      const limit = Math.min(remaining, probe.probeSequence === 0 ? 1 : 64);
      const support = readSupport(candidate, limit);
      remaining -= Math.max(1, support.length);
      const match = support.find((row) =>
        args.kind === "background"
          ? probe.probePhase === 0
            ? row.type === "item/backgroundTask/completed"
            : row.itemId === candidate.itemId
          : row.parentToolCallId === candidate.parentToolCallId &&
            (probe.probePhase === 1 ||
              (row.itemKind === kind &&
                (candidate.type !== "item/commandExecution/outputDelta" ||
                  row.hasOutput !== 0))),
      );
      if (match) {
        if (args.kind === "background" || probe.probePhase === 1) {
          discarded.push(candidate.id);
          finished = true;
        } else {
          probe.probePhase = 1;
          probe.probeSequence = 0;
          probe.probeWitnessId = match.id;
        }
      } else if (support.length < limit) {
        if (args.kind === "background" && probe.probePhase === 0) {
          probe.probePhase = 1;
          probe.probeSequence = 0;
        } else finished = true;
      } else {
        const last = support.at(-1);
        if (!last) throw new Error("Missing resolved-item support cursor");
        probe.probeSequence = last.sequence;
      }
    }
    if (!finished) break;
    sequence = candidate.sequence;
    processed += 1;
    reset();
  }
  const removed =
    discarded.length === 0
      ? 0
      : db.run(
          sql`DELETE FROM events WHERE id IN (${sql.join(
            discarded.map((id) => sql`${id}`),
            sql`, `,
          )}) AND ${isBeforeLatestThreadEvent(args.threadId)}`,
        ).changes;
  return { removed, sequence, complete: processed === rows.length };
}

export function advanceLiveEventPruning(
  db: DbQueryConnection,
  args: { threadId: string; kind: "deltas" | "background" },
) {
  const key = and(
    eq(threadPruningCursors.scope, args.threadId),
    eq(threadPruningCursors.policy, args.kind),
  );
  let cursor = db.select().from(threadPruningCursors).where(key).get();
  if (!cursor) {
    const latest = db.get<{ sequence: number }>(
      sql`SELECT sequence FROM events WHERE thread_id = ${args.threadId} ORDER BY sequence DESC LIMIT 1`,
    );
    if (!latest) return { removed: 0, scanned: 0, complete: true };
    cursor = db
      .insert(threadPruningCursors)
      .values({
        policy: args.kind,
        scope: args.threadId,
        threadId: args.threadId,
        version: 1,
        updatedAt: Date.now(),
        upperSequence: latest.sequence,
      })
      .returning()
      .get();
  }
  const candidates = db.all<ResolvedItemPruningCandidate>(sql`
    SELECT id, sequence, type, turn_id AS turnId, item_id AS itemId, parent_tool_call_id AS parentToolCallId
    FROM events INDEXED BY events_thread_sequence_idx
    WHERE thread_id = ${args.threadId} AND sequence > ${cursor.sequence} AND sequence <= ${cursor.upperSequence}
    ORDER BY sequence LIMIT 500
  `);
  const result = pruneResolvedItemCandidates(db, {
    ...args,
    candidates,
    probe: cursor,
  });
  if (result.sequence > 0) cursor.sequence = result.sequence;
  const complete =
    result.complete &&
    (candidates.length < 500 || cursor.sequence >= cursor.upperSequence);
  cursor.updatedAt = Date.now();
  if (complete) {
    db.delete(threadPruningCursors).where(key).run();
  } else {
    db.insert(threadPruningCursors)
      .values(cursor)
      .onConflictDoUpdate({
        target: [threadPruningCursors.policy, threadPruningCursors.scope],
        set: cursor,
      })
      .run();
  }
  return { removed: result.removed, scanned: candidates.length, complete };
}
