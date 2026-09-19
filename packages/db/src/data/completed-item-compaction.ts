import { eq, inArray, sql } from "drizzle-orm";
import { parseStoredThreadEvent, type ThreadEventType } from "@bb/domain";
import type { DbQueryConnection } from "../connection.js";
import { events } from "../schema.js";
import {
  compactHistoryPayload,
  encodeHistory,
  isCompactedItemKind,
  parseHistoryPayload,
} from "../completed-item-history.js";

const INPUT_BYTE_BUDGET = 1024 * 1024;
const supportTypesByKind = {
  commandExecution: [
    "item/started",
    "item/completed",
    "item/commandExecution/outputDelta",
  ],
  fileChange: ["item/started", "item/completed", "item/fileChange/outputDelta"],
  agentMessage: ["item/started", "item/completed", "item/agentMessage/delta"],
  reasoning: [
    "item/started",
    "item/completed",
    "item/reasoning/textDelta",
    "item/reasoning/summaryTextDelta",
  ],
} satisfies Record<string, ThreadEventType[]>;
interface Candidate {
  id: string;
  sequence: number;
  type: ThreadEventType;
  itemId: string | null;
  itemKind: typeof events.$inferSelect.itemKind;
  parentToolCallId: string | null;
  turnId: string | null;
  providerThreadId: string | null;
  environmentId: string | null;
  dataBytes: number;
  hasHistory: number;
}
const candidateFields = sql`id, sequence, type, item_id AS itemId, item_kind AS itemKind,
  parent_tool_call_id AS parentToolCallId, turn_id AS turnId, provider_thread_id AS providerThreadId,
  environment_id AS environmentId, octet_length(data) AS dataBytes, completed_item_history IS NOT NULL AS hasHistory`;

export function advanceCompletedItemCompaction(
  db: DbQueryConnection,
  args: {
    threadId: string;
    afterSequence: number;
    throughSequence: number;
    limit: number;
  },
) {
  const pageSize = Math.min(8, Math.max(1, Math.floor(args.limit / 64)));
  const candidates = db.all<Candidate>(sql`SELECT ${candidateFields}
    FROM events INDEXED BY events_thread_type_sequence_idx
    WHERE thread_id = ${args.threadId} AND type = 'item/completed'
      AND sequence > ${args.afterSequence} AND sequence <= ${args.throughSequence}
    ORDER BY sequence LIMIT ${pageSize}`);
  let scanned = candidates.length;
  let removed = 0;
  let removedBytes = 0;
  let processedBytes = 0;
  let nextSequence = args.afterSequence;
  const skipped: Record<string, number> = {};
  const skip = (kind: string, reason: string) => {
    const key = `${kind}:${reason}`;
    skipped[key] = (skipped[key] ?? 0) + 1;
  };
  for (const candidate of candidates) {
    if (processedBytes >= INPUT_BYTE_BUDGET) break;
    nextSequence = candidate.sequence;
    const kind = candidate.itemKind;
    if (!isCompactedItemKind(kind)) {
      skip(kind ?? "unknown", "unsupported-kind");
      continue;
    }
    if (candidate.turnId === null || candidate.itemId === null) {
      skip(kind, "missing-scope");
      continue;
    }
    if (candidate.hasHistory) continue;
    const support: Candidate[] = [];
    let exhausted = true;
    for (const type of [
      ...supportTypesByKind[kind],
      "turn/started",
      "turn/completed",
    ] as const) {
      const limit = Math.min(8, args.limit - scanned - 2);
      if (limit <= 0) {
        exhausted = false;
        break;
      }
      const rows = db.all<Candidate>(sql`SELECT ${candidateFields}
        FROM events INDEXED BY events_thread_turn_type_item_sequence_idx
        WHERE thread_id = ${args.threadId} AND turn_id = ${candidate.turnId}
          AND type = ${type} AND item_id IS ${type.startsWith("turn/") ? null : candidate.itemId}
        ORDER BY sequence LIMIT ${limit}`);
      scanned += Math.max(1, rows.length);
      support.push(...rows);
      if (rows.length === limit) {
        exhausted = false;
        break;
      }
    }
    if (!exhausted) {
      skip(kind, "support-budget");
      continue;
    }
    if (
      support.some(
        (row) =>
          !row.type.startsWith("turn/") &&
          (row.parentToolCallId !== candidate.parentToolCallId ||
            ((row.type === "item/started" || row.type === "item/completed") &&
              row.itemKind !== kind)),
      )
    ) {
      skip(kind, "incompatible-lifecycle");
      continue;
    }
    const peers = support.filter(
      (row) =>
        !row.type.startsWith("turn/") &&
        row.parentToolCallId === candidate.parentToolCallId &&
        (row.itemKind === kind ||
          (row.type !== "item/started" && row.type !== "item/completed")),
    );
    const starts = peers.filter((row) => row.type === "item/started");
    const completions = peers.filter((row) => row.type === "item/completed");
    const deltas = peers.filter(
      (row) => row.type !== "item/started" && row.type !== "item/completed",
    );
    if (completions.length !== 1 || completions[0]?.id !== candidate.id) {
      skip(kind, "ambiguous-completion");
      continue;
    }
    if (starts.length > 1) {
      skip(kind, "ambiguous-start");
      continue;
    }
    if (peers.some((row) => row.sequence > candidate.sequence)) {
      skip(kind, "late-item-event");
      continue;
    }
    if (
      peers.some(
        (row) =>
          row.environmentId !== candidate.environmentId ||
          row.providerThreadId !== candidate.providerThreadId,
      )
    ) {
      skip(kind, "incompatible-envelope");
      continue;
    }
    const turnRows = support.filter(
      (row) =>
        row.type.startsWith("turn/") &&
        (row.parentToolCallId === null ||
          row.parentToolCallId === candidate.parentToolCallId) &&
        row.providerThreadId === candidate.providerThreadId,
    );
    const settled = turnRows.find(
      (row) =>
        row.type === "turn/completed" && row.sequence > candidate.sequence,
    );
    if (
      settled === undefined ||
      turnRows.some(
        (row) =>
          row.type === "turn/started" && row.sequence > candidate.sequence,
      )
    ) {
      skip(kind, "unsettled");
      continue;
    }
    if (
      deltas.some((row) => row.type === "item/fileChange/outputDelta") ||
      new Set(deltas.map((row) => row.type)).size !== deltas.length ||
      deltas.length > 2
    ) {
      skip(kind, "unpruned-or-unsupported-deltas");
      continue;
    }
    const source = [...starts, ...deltas].sort(
      (a, b) => a.sequence - b.sequence,
    );
    if (source.length === 0) continue;
    const firstSequence = source[0]!.sequence;
    const boundaryRows: { id: string; dataBytes: number }[] = [];
    let boundaryBudgetExhausted = false;
    let crossesOutputBoundary = false;
    const boundaryTypes = ["client/turn/requested", "system/operation"];
    if (kind === "agentMessage")
      boundaryTypes.push("item/completed", "system/manager/user_message");
    for (const type of boundaryTypes) {
      const limit = Math.min(8, args.limit - scanned);
      if (limit <= 0) {
        boundaryBudgetExhausted = true;
        break;
      }
      const found = db.all<{
        id: string;
        dataBytes: number;
        itemKind: string | null;
      }>(sql`
        SELECT id, octet_length(data) AS dataBytes, item_kind AS itemKind
        FROM events INDEXED BY events_thread_type_sequence_idx
        WHERE thread_id = ${args.threadId} AND type = ${type}
          AND sequence > ${firstSequence} AND sequence < ${candidate.sequence}
        ORDER BY sequence LIMIT ${limit}
      `);
      scanned += Math.max(1, found.length);
      if (type === "item/completed") {
        crossesOutputBoundary ||= found.some(
          (row) => row.itemKind === "agentMessage",
        );
      } else if (type === "system/manager/user_message") {
        crossesOutputBoundary ||= found.length > 0;
      } else {
        boundaryRows.push(...found);
      }
      if (found.length === limit) {
        boundaryBudgetExhausted = true;
        break;
      }
    }
    if (boundaryBudgetExhausted) {
      skip(kind, "boundary-budget");
      continue;
    }
    if (crossesOutputBoundary) {
      skip(kind, "output-order-boundary");
      continue;
    }
    const boundaryBytes = boundaryRows.reduce(
      (total, row) => total + row.dataBytes,
      0,
    );
    if (boundaryBytes > INPUT_BYTE_BUDGET - processedBytes) {
      skip(kind, "boundary-payload-budget");
      continue;
    }
    processedBytes += boundaryBytes;
    let crossesBoundary = false;
    for (const boundary of boundaryRows) {
      const row = db
        .select({ data: events.data })
        .from(events)
        .where(eq(events.id, boundary.id))
        .get();
      try {
        if (!row) throw new Error("Missing boundary");
        const payload = parseHistoryPayload(row.data);
        if (
          payload.initiator === "user" ||
          (payload.operation === "context_clear" &&
            payload.status === "completed")
        )
          crossesBoundary = true;
      } catch {
        crossesBoundary = true;
      }
    }
    if (crossesBoundary) {
      skip(kind, "edit-or-context-boundary");
      continue;
    }
    const bytes = peers.reduce(
      (total, row) => total + row.dataBytes,
      settled.dataBytes,
    );
    if (bytes > INPUT_BYTE_BUDGET - processedBytes) {
      skip(kind, "payload-budget");
      continue;
    }
    const rows = db
      .select()
      .from(events)
      .where(inArray(events.id, [...peers.map((row) => row.id), settled.id]))
      .all();
    processedBytes += bytes;
    const owner = rows.find((row) => row.id === candidate.id);
    if (owner === undefined)
      throw new Error("Missing completed item compaction owner");
    let payloads: Map<string, ReturnType<typeof parseHistoryPayload>>;
    try {
      payloads = new Map(
        rows.map((row) => {
          const payload = parseHistoryPayload(row.data);
          const event = parseStoredThreadEvent({
            threadId: args.threadId,
            providerThreadId: row.providerThreadId,
            type: row.type,
            scope: { kind: "turn", turnId: candidate.turnId! },
            data: payload,
          });
          if (
            (event.type === "item/started" ||
              event.type === "item/completed") &&
            (event.item.id !== candidate.itemId || event.item.type !== kind)
          )
            throw new Error("Mismatched item identity");
          return [row.id, payload];
        }),
      );
    } catch {
      skip(kind, "malformed-payload");
      continue;
    }
    const ownerPayload = payloads.get(candidate.id);
    if (ownerPayload === undefined)
      throw new Error("Missing completed item payload");
    const item = ownerPayload.item;
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      skip(kind, "malformed-completion");
      continue;
    }
    if (
      (kind === "commandExecution" || kind === "fileChange") &&
      item.status !== "completed" &&
      item.status !== "failed" &&
      item.status !== "interrupted"
    ) {
      skip(kind, "completion-status");
      continue;
    }
    const compacted = source.filter((row) => {
      if (row.type !== "item/commandExecution/outputDelta") return true;
      const payload = payloads.get(row.id);
      if (payload === undefined || typeof payload.delta !== "string") {
        skip(kind, "malformed-delta");
        return false;
      }
      if (
        item.status !== "completed" &&
        item.status !== "failed" &&
        item.status !== "interrupted"
      ) {
        skip(kind, "command-status");
        return false;
      }
      if (
        typeof item.aggregatedOutput !== "string" ||
        item.aggregatedOutput.length === 0
      ) {
        skip(kind, "empty-output");
        return false;
      }
      if (
        starts.length === 0 &&
        !item.aggregatedOutput.includes(payload.delta)
      ) {
        skip(kind, "missing-start-uncontained-text");
        return false;
      }
      payload.delta = "";
      return true;
    });
    if (compacted.length !== source.length) continue;
    const records = compacted.map((row) => {
      const payload = payloads.get(row.id);
      const stored = rows.find((entry) => entry.id === row.id);
      if (payload === undefined || stored === undefined)
        throw new Error("Missing completed item source");
      if (stored.itemKind !== null && !isCompactedItemKind(stored.itemKind))
        throw new Error("Unsupported compacted item kind");
      return {
        id: row.id,
        sequence: row.sequence,
        createdAt: stored.createdAt,
        type: row.type,
        itemKind: stored.itemKind,
        ...compactHistoryPayload(payload, ownerPayload),
      };
    });
    const data = JSON.stringify([
      1,
      candidate.sequence,
      owner.createdAt,
      JSON.parse(encodeHistory(records)),
    ]);
    const result = db
      .delete(events)
      .where(
        inArray(
          events.id,
          records.map((row) => row.id),
        ),
      )
      .run();
    if (result.changes !== records.length)
      throw new Error("Completed item compaction lost a source row");
    db.update(events)
      .set({ sequence: firstSequence, completedItemHistory: data })
      .where(eq(events.id, candidate.id))
      .run();
    removed += result.changes;
    removedBytes +=
      compacted.reduce((total, row) => total + row.dataBytes, 0) -
      Buffer.byteLength(data);
  }
  return {
    scanned,
    removed,
    removedBytes,
    processedBytes,
    skipped,
    nextSequence,
    complete:
      candidates.length < pageSize &&
      nextSequence === (candidates.at(-1)?.sequence ?? args.afterSequence),
  };
}
