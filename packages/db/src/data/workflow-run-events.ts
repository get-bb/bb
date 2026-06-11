import { and, asc, eq, gt, gte, inArray, max, sql } from "drizzle-orm";
import {
  WORKFLOW_RUN_JOURNAL_EVENT_TYPES,
  type HostDaemonProducerEventId,
  type WorkflowRunEventType,
} from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import { createWorkflowRunEventId } from "../ids.js";
import { workflowRunEvents } from "../schema.js";

export interface ProducerEventPayloadMismatchDetails {
  existingHash: string | null;
  producerEventId: HostDaemonProducerEventId;
  receivedHash: string;
}

export class ProducerEventPayloadMismatchError extends Error {
  readonly details: ProducerEventPayloadMismatchDetails;

  constructor(details: ProducerEventPayloadMismatchDetails) {
    super("Producer event id was reused with a different payload");
    this.name = "ProducerEventPayloadMismatchError";
    this.details = details;
  }
}

type WorkflowRunEventReadConnection = DbConnection | DbTransaction;

export type WorkflowRunEventRow = typeof workflowRunEvents.$inferSelect;

export interface AppendWorkflowRunEventInput {
  /** The journal-stable display agent index for agent-scoped events, else null. */
  agentIndex: number | null;
  /** Serialized WorkflowRunEvent JSON. */
  payload: string;
  producerEventId: HostDaemonProducerEventId;
  /** sha256 over canonicalizeWorkflowRunEventPayload({event, runId}). */
  producerEventPayloadHash: string;
  runId: string;
  type: WorkflowRunEventType;
}

export interface AcceptedWorkflowRunEvent {
  producerEventId: HostDaemonProducerEventId;
  runId: string;
  sequence: number;
}

export interface AppendWorkflowRunEventsResult {
  acceptedEvents: AcceptedWorkflowRunEvent[];
  /**
   * Indexes into the input batch that were actually inserted. Side effects
   * (snapshot folds, status advances, notifications) must key off these —
   * re-acked duplicates never re-fire them.
   */
  insertedInputIndexes: number[];
}

interface StoredWorkflowRunProducerEventRow {
  producerEventId: string;
  producerEventPayloadHash: string;
  runId: string;
  sequence: number;
}

function listStoredWorkflowRunProducerEventRows(
  db: DbTransaction,
  producerEventIds: readonly HostDaemonProducerEventId[],
): StoredWorkflowRunProducerEventRow[] {
  if (producerEventIds.length === 0) {
    return [];
  }

  return db
    .select({
      producerEventId: workflowRunEvents.producerEventId,
      producerEventPayloadHash: workflowRunEvents.producerEventPayloadHash,
      runId: workflowRunEvents.runId,
      sequence: workflowRunEvents.sequence,
    })
    .from(workflowRunEvents)
    .where(inArray(workflowRunEvents.producerEventId, [...producerEventIds]))
    .all();
}

function getWorkflowRunSequenceHighWaterMarks(
  db: DbTransaction,
  runIds: readonly string[],
): Map<string, number> {
  const highWaterMarks = new Map<string, number>();
  if (runIds.length === 0) {
    return highWaterMarks;
  }

  const rows = db
    .select({
      runId: workflowRunEvents.runId,
      maxSequence: max(workflowRunEvents.sequence),
    })
    .from(workflowRunEvents)
    .where(inArray(workflowRunEvents.runId, [...runIds]))
    .groupBy(workflowRunEvents.runId)
    .all();
  for (const row of rows) {
    if (row.maxSequence != null) {
      highWaterMarks.set(row.runId, row.maxSequence);
    }
  }
  return highWaterMarks;
}

/**
 * Producer-idempotent append with per-run monotonic sequences (the
 * appendDaemonEventsInTransaction discipline): a redelivered producerEventId
 * re-acks with its original sequence; the same producer id with a different
 * payload hash throws ProducerEventPayloadMismatchError. There is no
 * turn-started analog — run events have no turn scoping.
 */
export function appendWorkflowRunEventsInTransaction(
  db: DbTransaction,
  eventInputs: readonly AppendWorkflowRunEventInput[],
): AppendWorkflowRunEventsResult {
  if (eventInputs.length === 0) {
    return {
      acceptedEvents: [],
      insertedInputIndexes: [],
    };
  }

  const uniqueProducerEventIds = [
    ...new Set(eventInputs.map((input) => input.producerEventId)),
  ];
  const acceptedByProducerEventId = new Map<
    string,
    AcceptedWorkflowRunEvent & { producerEventPayloadHash: string }
  >();
  for (const row of listStoredWorkflowRunProducerEventRows(
    db,
    uniqueProducerEventIds,
  )) {
    acceptedByProducerEventId.set(row.producerEventId, {
      producerEventId: row.producerEventId,
      producerEventPayloadHash: row.producerEventPayloadHash,
      runId: row.runId,
      sequence: row.sequence,
    });
  }

  const runIds = [...new Set(eventInputs.map((input) => input.runId))];
  const highWaterMarks = getWorkflowRunSequenceHighWaterMarks(db, runIds);
  const nextSequencesByRunId = new Map(
    runIds.map((runId) => [runId, (highWaterMarks.get(runId) ?? 0) + 1]),
  );

  const acceptedEvents: AcceptedWorkflowRunEvent[] = [];
  const insertedInputIndexes: number[] = [];
  const now = Date.now();

  for (const [index, input] of eventInputs.entries()) {
    const accepted = acceptedByProducerEventId.get(input.producerEventId);
    if (accepted !== undefined) {
      if (
        accepted.producerEventPayloadHash !== input.producerEventPayloadHash
      ) {
        throw new ProducerEventPayloadMismatchError({
          existingHash: accepted.producerEventPayloadHash,
          producerEventId: input.producerEventId,
          receivedHash: input.producerEventPayloadHash,
        });
      }
      acceptedEvents.push({
        producerEventId: input.producerEventId,
        runId: accepted.runId,
        sequence: accepted.sequence,
      });
      continue;
    }

    const sequence = nextSequencesByRunId.get(input.runId);
    if (sequence === undefined) {
      throw new Error(`Missing event sequence for workflow run: ${input.runId}`);
    }
    db.insert(workflowRunEvents)
      .values({
        id: createWorkflowRunEventId(),
        runId: input.runId,
        sequence,
        type: input.type,
        agentIndex: input.agentIndex,
        producerEventId: input.producerEventId,
        producerEventPayloadHash: input.producerEventPayloadHash,
        payload: input.payload,
        createdAt: now,
      })
      .run();

    const acceptedEvent: AcceptedWorkflowRunEvent = {
      producerEventId: input.producerEventId,
      runId: input.runId,
      sequence,
    };
    acceptedEvents.push(acceptedEvent);
    insertedInputIndexes.push(index);
    acceptedByProducerEventId.set(input.producerEventId, {
      ...acceptedEvent,
      producerEventPayloadHash: input.producerEventPayloadHash,
    });
    nextSequencesByRunId.set(input.runId, sequence + 1);
  }

  return {
    acceptedEvents,
    insertedInputIndexes,
  };
}

export interface ListWorkflowRunEventsArgs {
  /** Return only events with sequence strictly greater (the events route cursor). */
  afterSequence?: number;
  runId: string;
  /** Restrict to these event types (the journal route reads WORKFLOW_RUN_JOURNAL_EVENT_TYPES). */
  types?: readonly WorkflowRunEventType[];
}

export function listWorkflowRunEvents(
  db: WorkflowRunEventReadConnection,
  args: ListWorkflowRunEventsArgs,
): WorkflowRunEventRow[] {
  return db
    .select()
    .from(workflowRunEvents)
    .where(
      and(
        eq(workflowRunEvents.runId, args.runId),
        args.afterSequence !== undefined
          ? gt(workflowRunEvents.sequence, args.afterSequence)
          : undefined,
        args.types !== undefined
          ? inArray(workflowRunEvents.type, [...args.types])
          : undefined,
      ),
    )
    .orderBy(asc(workflowRunEvents.sequence))
    .all();
}

export interface HasWorkflowRunEventsSinceArgs {
  runId: string;
  /** Inclusive: an event created in the same millisecond counts. */
  since: number;
}

/**
 * Retention prune for an archived run's resume journal: empties the unbounded
 * journal-entry fields (`entry.resultText`, `entry.structured`) of every
 * `agent/completed`/`agent/failed` payload while keeping rows schema-valid for
 * display. Destroys resumability by design — callers must have flipped the
 * run's retention to `archived` (the resume gate and journal route refuse
 * archived runs) in the same transaction. Returns the number of pruned rows.
 */
export function pruneWorkflowRunJournalEventPayloadsInTransaction(
  db: DbTransaction,
  args: { runId: string },
): number {
  const [completedType, failedType] = WORKFLOW_RUN_JOURNAL_EVENT_TYPES;
  const result = db.run(
    sql`UPDATE workflow_run_events
        SET payload = json_remove(
          json_set(payload, '$.entry.resultText', ''),
          '$.entry.structured'
        )
        WHERE ${workflowRunEvents.runId} = ${args.runId}
          AND ${workflowRunEvents.type} IN (${completedType}, ${failedType})`,
  );
  return result.changes;
}

/**
 * The command-expiry inspection: whether any run events landed at or after the
 * operation's queuedAt — any row means the run demonstrably started and
 * reconciliation owns it; zero means the start never happened. Inclusive
 * (`>=`) on purpose: an event created in the same millisecond the command was
 * queued cannot predate the operation (the run had no other active
 * operation), and a strict `>` would mis-settle same-millisecond
 * queue→spawn→flush sequences as "never started".
 */
export function hasWorkflowRunEventsSince(
  db: WorkflowRunEventReadConnection,
  args: HasWorkflowRunEventsSinceArgs,
): boolean {
  const row = db
    .select({ id: workflowRunEvents.id })
    .from(workflowRunEvents)
    .where(
      and(
        eq(workflowRunEvents.runId, args.runId),
        gte(workflowRunEvents.createdAt, args.since),
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}
