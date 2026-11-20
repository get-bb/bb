import { performance } from "node:perf_hooks";
import { prepareCachedQuery } from "../connection.js";
import { isBeforeLatestThreadEvent } from "./event-pruning-guards.js";
import { events, threadPruningCursors } from "../schema.js";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";
import type { ThreadEventType } from "@bb/domain";

export interface ResolvedItemPruningProbe {
  probeEventId: string | null;
  probePhase: number;
  probeSequence: number;
  probeWitnessId: string | null;
}

interface ResolvedItemPruningCandidate {
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

const RESOLVED_ITEM_PRUNING_DELETE_CHUNK = 16;
const RESOLVED_ITEM_PRUNING_PAGE_SIZE = 64;
export const RESOLVED_ITEM_PRUNING_KINDS = [
  "deltas",
  "background",
  "file-change-diffs",
] as const;
export type ResolvedItemPruningKind = (typeof RESOLVED_ITEM_PRUNING_KINDS)[number];
const RESTING_CURSOR_VERSION_BY_KIND: Record<ResolvedItemPruningKind, number> = {
  deltas: 3,
  background: 2,
  "file-change-diffs": 1,
};

const deltaKinds: Partial<Record<ThreadEventType, string>> = {
  "item/agentMessage/delta": "agentMessage",
  "item/commandExecution/outputDelta": "commandExecution",
  "item/reasoning/summaryTextDelta": "reasoning",
  "item/reasoning/textDelta": "reasoning",
};

function prepareSupport(
  db: DbQueryConnection,
  index: string,
  predicate: SQL,
  hasOutput = sql<number>`1`,
) {
  return db
    .select({
      id: sql<string>`${events.id}`,
      sequence: sql<number>`${events.sequence}`,
      type: sql<string>`${events.type}`,
      itemKind: sql<string | null>`${events.itemKind}`,
      itemId: sql<string | null>`${events.itemId}`,
      parentToolCallId: sql<string | null>`${events.parentToolCallId}`,
      hasOutput,
    })
    .from(sql`events INDEXED BY ${sql.raw(index)}`)
    .where(
      sql`thread_id = ${sql.placeholder("threadId")} AND sequence > ${sql.placeholder("afterSequence")} AND ${predicate}`,
    )
    .orderBy(events.sequence)
    .limit(sql.placeholder("limit"))
    .prepare();
}

const completionPredicate = sql`turn_id = ${sql.placeholder("turnId")} AND type = 'item/completed' AND item_id = ${sql.placeholder("itemId")}`;
const prepareLifecycle = (db: DbQueryConnection) =>
  prepareSupport(
    db,
    "events_item_lifecycle_thread_item_sequence_idx",
    sql`item_id = ${sql.placeholder("itemId")} AND type IN ('item/started', 'item/completed', 'item/backgroundTask/completed')`,
  );
const prepareProgress = (db: DbQueryConnection) =>
  prepareSupport(
    db,
    "events_thread_type_sequence_idx",
    sql`type = 'item/backgroundTask/progress'`,
  );
const prepareEarlier = (db: DbQueryConnection) =>
  prepareSupport(
    db,
    "events_thread_turn_type_item_sequence_idx",
    sql`turn_id = ${sql.placeholder("turnId")} AND type = ${sql.placeholder("type")} AND item_id = ${sql.placeholder("itemId")} AND sequence < ${sql.placeholder("beforeSequence")}`,
  );
const prepareOutput = (db: DbQueryConnection) =>
  prepareSupport(
    db,
    "events_thread_turn_type_item_sequence_idx",
    completionPredicate,
    sql<number>`CASE WHEN json_valid(data) THEN json_type(data, '$.item.aggregatedOutput') IS NOT NULL ELSE 0 END`,
  );
const prepareCompletion = (db: DbQueryConnection) =>
  prepareSupport(
    db,
    "events_thread_turn_type_item_sequence_idx",
    completionPredicate,
  );

function hasStartedRowBefore(
  db: DbQueryConnection,
  threadId: string,
  candidate: ResolvedItemPruningCandidate,
): boolean {
  return (
    prepareCachedQuery(db, prepareStarted).get({
      threadId,
      turnId: candidate.turnId,
      itemId: candidate.itemId,
      parentToolCallId: candidate.parentToolCallId,
      beforeSequence: candidate.sequence,
    }) !== undefined
  );
}

const prepareStarted = (db: DbQueryConnection) =>
  db
    .select({ id: sql<string>`${events.id}` })
    .from(sql`events INDEXED BY events_thread_turn_type_item_sequence_idx`)
    .where(
      sql`thread_id = ${sql.placeholder("threadId")} AND turn_id = ${sql.placeholder("turnId")} AND type = 'item/started' AND item_id = ${sql.placeholder("itemId")} AND sequence < ${sql.placeholder("beforeSequence")} AND item_kind = 'commandExecution' AND parent_tool_call_id IS ${sql.placeholder("parentToolCallId")}`,
    )
    .limit(1)
    .prepare();

function pruneResolvedItemCandidates(
  db: DbQueryConnection,
  args: {
    threadId: string;
    candidates: readonly ResolvedItemPruningCandidate[];
    kind: "deltas" | "background";
    probe: ResolvedItemPruningProbe;
    budget: { remaining: number; started: boolean };
    deadline: number;
  },
) {
  const rows = args.candidates;
  const probe = args.probe;
  let discarded: string[] = [];
  let removed = 0;
  const deleteDiscarded = () => {
    if (discarded.length === 0) return;
    removed += db.run(
      sql`DELETE FROM events WHERE id IN (${sql.join(
        discarded.map((id) => sql`${id}`),
        sql`, `,
      )}) AND ${isBeforeLatestThreadEvent(args.threadId)}`,
    ).changes;
    discarded = [];
  };
  const budget = args.budget;
  const withinDeadline = () =>
    !budget.started || performance.now() < args.deadline;
  let sequence = 0;
  let processed = 0;
  const reset = () => Object.assign(probe, emptyResolvedItemPruningProbe());
  const readSupport = (
    candidate: ResolvedItemPruningCandidate,
    limit: number,
  ): Support[] => {
    const build =
      args.kind === "background"
        ? probe.probePhase === 0
          ? prepareLifecycle
          : prepareProgress
        : probe.probePhase === 1
          ? prepareEarlier
          : candidate.type === "item/commandExecution/outputDelta"
            ? prepareOutput
            : prepareCompletion;
    return prepareCachedQuery(db, build).all({
      threadId: args.threadId,
      turnId: candidate.turnId,
      itemId: candidate.itemId,
      type: candidate.type,
      afterSequence:
        args.kind === "background" && probe.probePhase === 1
          ? Math.max(candidate.sequence, probe.probeSequence)
          : probe.probeSequence,
      beforeSequence: candidate.sequence,
      limit,
    });
  };
  for (const candidate of rows) {
    if (budget.remaining <= 0 || !withinDeadline()) break;
    budget.remaining -= 1;
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
      budget.remaining > 0
    ) {
      const witness =
        db.get(sql`SELECT 1 FROM events WHERE id = ${probe.probeWitnessId}
        AND thread_id = ${args.threadId} AND turn_id = ${candidate.turnId} AND type = 'item/completed'
        AND item_id = ${candidate.itemId} AND item_kind = ${kind} AND parent_tool_call_id IS ${candidate.parentToolCallId}
        AND (${candidate.type} <> 'item/commandExecution/outputDelta' OR CASE WHEN json_valid(data) THEN json_type(data, '$.item.aggregatedOutput') IS NOT NULL ELSE 0 END)`);
      budget.remaining -= 1;
      if (!witness) {
        probe.probePhase = 0;
        probe.probeSequence = 0;
        probe.probeWitnessId = null;
      }
    }
    while (!finished && budget.remaining > 0 && withinDeadline()) {
      const limit = Math.min(
        budget.remaining,
        probe.probeSequence === 0 ? 1 : 64,
      );
      const support = readSupport(candidate, limit);
      budget.remaining -= Math.max(1, support.length);
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
        if (
          args.kind === "background" ||
          probe.probePhase === 1 ||
          (candidate.type === "item/commandExecution/outputDelta" &&
            hasStartedRowBefore(db, args.threadId, candidate))
        ) {
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
    budget.started = true;
    sequence = candidate.sequence;
    processed += 1;
    reset();
    if (discarded.length >= RESOLVED_ITEM_PRUNING_DELETE_CHUNK) deleteDiscarded();
  }
  deleteDiscarded();
  return { removed, sequence, processed, complete: processed === rows.length };
}

function resolvedItemResumeSequence(
  db: DbQueryConnection,
  args: { threadId: string; kind: ResolvedItemPruningKind; provenThrough: number },
): number {
  const row =
    args.kind === "file-change-diffs"
      ? db.get<{ sequence: number | null }>(sql`
          SELECT MIN(candidate.sequence) AS sequence
          FROM events witness INDEXED BY events_thread_type_item_kind_sequence_idx
          CROSS JOIN events candidate INDEXED BY events_thread_turn_type_item_sequence_idx
          WHERE witness.thread_id = ${args.threadId}
            AND witness.type = 'item/completed'
            AND witness.item_kind = 'fileChange'
            AND witness.sequence > ${args.provenThrough}
            AND candidate.thread_id = witness.thread_id
            AND candidate.turn_id = witness.turn_id
            AND candidate.type = 'item/started'
            AND candidate.item_id = witness.item_id
            AND candidate.sequence <= ${args.provenThrough}
        `)
      : args.kind === "deltas"
      ? db.get<{ sequence: number | null }>(sql`
          SELECT MIN(candidate.sequence) AS sequence
          FROM events witness INDEXED BY events_thread_type_sequence_idx
          CROSS JOIN events candidate INDEXED BY events_thread_turn_type_item_sequence_idx
          WHERE witness.thread_id = ${args.threadId}
            AND witness.type = 'item/completed'
            AND witness.sequence > ${args.provenThrough}
            AND candidate.thread_id = witness.thread_id
            AND candidate.turn_id = witness.turn_id
            AND candidate.type IN (${sql.join(
              Object.keys(deltaKinds).map((type) => sql`${type}`),
              sql`, `,
            )})
            AND candidate.item_id = witness.item_id
            AND candidate.sequence <= ${args.provenThrough}
        `)
      : db.get<{ sequence: number | null }>(sql`
          SELECT MIN(candidate.sequence) AS sequence
          FROM events candidate INDEXED BY events_thread_type_sequence_idx
          WHERE candidate.thread_id = ${args.threadId}
            AND candidate.type = 'item/backgroundTask/progress'
            AND candidate.sequence <= ${args.provenThrough}
            AND candidate.item_id IN (
              SELECT witness.item_id FROM events witness INDEXED BY events_thread_type_sequence_idx
              WHERE witness.thread_id = ${args.threadId}
                AND witness.type IN ('item/backgroundTask/progress', 'item/backgroundTask/completed')
                AND witness.sequence > ${args.provenThrough}
            )
        `);
  return row?.sequence == null ? args.provenThrough : row.sequence - 1;
}

export function rewindResolvedItemPruning(
  db: DbQueryConnection,
  args: { threadId: string; beforeSequence: number },
): void {
  const through = Math.max(0, args.beforeSequence - 1);
  db.run(sql`UPDATE thread_pruning_cursors
    SET sequence = MIN(sequence, ${through}),
      upper_sequence = MIN(upper_sequence, ${through}),
      probe_event_id = NULL, probe_phase = 0, probe_sequence = 0, probe_witness_id = NULL
    WHERE scope = ${args.threadId} AND policy IN (${sql.join(
      RESOLVED_ITEM_PRUNING_KINDS.map((kind) => sql`${kind}`),
      sql`, `,
    )})
      AND upper_sequence > ${through}`);
}

export function advanceLiveEventPruning(
  db: DbQueryConnection,
  args: {
    threadId: string;
    kind: ResolvedItemPruningKind;
    limit: number;
    deadline: number;
  },
) {
  const version = RESTING_CURSOR_VERSION_BY_KIND[args.kind];
  const key = and(
    eq(threadPruningCursors.scope, args.threadId),
    eq(threadPruningCursors.policy, args.kind),
  );
  const latest = db.get<{ sequence: number }>(
    sql`SELECT sequence FROM events WHERE thread_id = ${args.threadId} ORDER BY sequence DESC LIMIT 1`,
  );
  if (!latest) return { removed: 0, scanned: 0, complete: true };
  const passUpper = latest.sequence - 1;
  let cursor = db.select().from(threadPruningCursors).where(key).get();
  if (!cursor || cursor.version !== version) {
    if (cursor) db.delete(threadPruningCursors).where(key).run();
    cursor = db
      .insert(threadPruningCursors)
      .values({
        policy: args.kind,
        scope: args.threadId,
        threadId: args.threadId,
        version,
        updatedAt: Date.now(),
        upperSequence: passUpper,
      })
      .returning()
      .get();
  } else if (cursor.sequence >= cursor.upperSequence) {
    if (passUpper <= cursor.upperSequence)
      return { removed: 0, scanned: 0, complete: true };
    cursor.sequence = resolvedItemResumeSequence(db, {
      threadId: args.threadId,
      kind: args.kind,
      provenThrough: cursor.upperSequence,
    });
    cursor.upperSequence = passUpper;
    Object.assign(cursor, emptyResolvedItemPruningProbe());
  }
  const budget = { remaining: args.limit, started: false };
  let scanned = 0;
  let removed = 0;
  let complete = false;
  while (budget.remaining > 0) {
    const pageSize = Math.min(RESOLVED_ITEM_PRUNING_PAGE_SIZE, budget.remaining);
    const window = {
      threadId: args.threadId,
      afterSequence: cursor.sequence,
      throughSequence: cursor.upperSequence,
      limit: pageSize,
    };
    let candidates: readonly ResolvedItemPruningCandidate[];
    let result: ReturnType<typeof pruneResolvedItemCandidates>;
    if (args.kind === "deltas" || args.kind === "background") {
      candidates = listResolvedItemCandidates(db, {
        ...window,
        types:
          args.kind === "background"
            ? ["item/backgroundTask/progress"]
            : Object.keys(deltaKinds),
      });
      result = pruneResolvedItemCandidates(db, {
        threadId: args.threadId,
        kind: args.kind,
        candidates,
        probe: cursor,
        budget,
        deadline: args.deadline,
      });
    } else {
      candidates = listStartedFileChangeCandidates(db, window);
      budget.remaining -= Math.max(1, candidates.length);
      budget.started = true;
      result = {
        removed: stripCompletedFileChangeDiffs(
          db,
          candidates.map((candidate) => candidate.id),
        ),
        sequence: candidates.at(-1)?.sequence ?? 0,
        processed: candidates.length,
        complete: true,
      };
    }
    scanned += result.processed;
    removed += result.removed;
    if (result.sequence > 0) cursor.sequence = result.sequence;
    if (!result.complete) break;
    if (candidates.length < pageSize || cursor.sequence >= cursor.upperSequence) {
      complete = true;
      break;
    }
    if (performance.now() >= args.deadline) break;
  }
  if (complete) {
    cursor.sequence = cursor.upperSequence;
    Object.assign(cursor, emptyResolvedItemPruningProbe());
  }
  cursor.updatedAt = Date.now();
  db.insert(threadPruningCursors)
    .values(cursor)
    .onConflictDoUpdate({
      target: [threadPruningCursors.policy, threadPruningCursors.scope],
      set: cursor,
    })
    .run();
  return { removed, scanned, complete };
}

function listResolvedItemCandidates(
  db: DbQueryConnection,
  args: {
    threadId: string;
    types: readonly string[];
    afterSequence: number;
    throughSequence: number;
    limit: number;
  },
): ResolvedItemPruningCandidate[] {
  return db.all<ResolvedItemPruningCandidate>(sql`
    WITH candidate_ids AS MATERIALIZED (
      SELECT eventRowid, sequence FROM (${sql.join(
        args.types.map(
          (type) => sql`
        SELECT eventRowid, sequence FROM (
          SELECT rowid AS eventRowid, sequence FROM events INDEXED BY events_thread_type_sequence_idx
          WHERE thread_id = ${args.threadId} AND type = ${type}
            AND sequence > ${args.afterSequence} AND sequence <= ${args.throughSequence}
          ORDER BY sequence LIMIT ${args.limit}
        )`,
        ),
        sql` UNION ALL `,
      )})
      ORDER BY sequence LIMIT ${args.limit}
    )
    SELECT events.id, events.sequence, events.type, events.turn_id AS turnId,
      events.item_id AS itemId, events.parent_tool_call_id AS parentToolCallId
    FROM candidate_ids JOIN events ON events.rowid = candidate_ids.eventRowid
    ORDER BY events.sequence
  `);
}

function listStartedFileChangeCandidates(
  db: DbQueryConnection,
  args: {
    threadId: string;
    afterSequence: number;
    throughSequence: number;
    limit: number;
  },
): ResolvedItemPruningCandidate[] {
  return db.all<ResolvedItemPruningCandidate>(sql`
    SELECT id, sequence, type, turn_id AS turnId, item_id AS itemId,
      parent_tool_call_id AS parentToolCallId
    FROM events INDEXED BY events_thread_type_item_kind_sequence_idx
    WHERE thread_id = ${args.threadId} AND type = 'item/started' AND item_kind = 'fileChange'
      AND sequence > ${args.afterSequence} AND sequence <= ${args.throughSequence}
    ORDER BY sequence LIMIT ${args.limit}
  `);
}

function stripCompletedFileChangeDiffs(
  db: DbQueryConnection,
  ids: readonly string[],
): number {
  if (ids.length === 0) return 0;
  return db.run(sql`UPDATE events
    SET data = json_set(data, '$.item.changes', (
      SELECT json_group_array(json_remove(change.value, '$.diff'))
      FROM json_each(events.data, '$.item.changes') AS change
    ))
    WHERE id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}) AND type = 'item/started' AND item_kind = 'fileChange'
      AND turn_id IS NOT NULL AND item_id IS NOT NULL
      AND CASE WHEN json_valid(data) THEN EXISTS (
        SELECT 1 FROM json_each(events.data, '$.item.changes') AS change
        WHERE json_type(change.value, '$.diff') IS NOT NULL
      ) ELSE 0 END
      AND EXISTS (
        SELECT 1 FROM events completion INDEXED BY events_thread_turn_type_item_sequence_idx
        WHERE completion.thread_id = events.thread_id
          AND completion.turn_id = events.turn_id
          AND completion.type = 'item/completed'
          AND completion.item_id = events.item_id
          AND completion.sequence > events.sequence
          AND completion.item_kind = 'fileChange'
          AND completion.parent_tool_call_id IS events.parent_tool_call_id
      )`).changes;
}
