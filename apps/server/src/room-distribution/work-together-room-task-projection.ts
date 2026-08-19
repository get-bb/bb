import type { WorkTogetherRoomTaskProjectionPortV1 } from "./binding-backed-room-distribution.js";
import { RoomDistributionUnavailableError, type RoomJsonObject } from "./room-distribution-port.js";

export interface WorkTogetherRoomTaskSqlPool {
  connect(): Promise<{
    query(queryText: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
    release(): void;
  }>;
}

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SUBJECT = /^user_[A-Za-z0-9]{1,128}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const ROW_KEYS = ["context_digest", "context_version", "task_id"] as const;

function unavailable(kind: "not_found" | "unavailable" = "unavailable"): never {
  throw new RoomDistributionUnavailableError(kind);
}

function exactRow(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    unavailable();
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...ROW_KEYS];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    unavailable();
  }
  return record;
}

function contextVersion(value: unknown): number {
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(n) || n < 1) unavailable();
  return n;
}

/**
 * Cell read of the applied Room-context receipt. Does not select live Goal or
 * Workstream drafts. Bootstrap still needs a closed `task` object; WT chrome
 * carries digest/version on `roomContext`.
 */
function project(rowValue: unknown, taskId: string): RoomJsonObject {
  const row = exactRow(rowValue);
  const digest = row.context_digest;
  contextVersion(row.context_version);
  if (row.task_id !== taskId || typeof digest !== "string" || !DIGEST.test(digest)) {
    unavailable();
  }
  return Object.freeze({
    id: taskId,
    status: "In progress",
    objective: null,
  });
}

/** Read applied Room-context identity through the cell login's single SQL function. */
export function createWorkTogetherRoomTaskProjection(input: {
  pool: WorkTogetherRoomTaskSqlPool;
}): WorkTogetherRoomTaskProjectionPortV1 {
  return Object.freeze({
    async read(
      request: Parameters<WorkTogetherRoomTaskProjectionPortV1["read"]>[0],
    ) {
      if (
        !CANONICAL_UUID.test(request.cellId) ||
        !CANONICAL_UUID.test(request.workspaceId) ||
        !CANONICAL_UUID.test(request.bindingId) ||
        !CANONICAL_UUID.test(request.taskId) ||
        request.principal.kind !== "human" ||
        !SUBJECT.test(request.principal.id)
      ) {
        unavailable("not_found");
      }
      let client;
      try {
        client = await input.pool.connect();
        const result = await client.query(
          `select task_id, context_version, context_digest
             from work_together.bb_cell_room_task($1,$2,$3)`,
          [request.cellId, request.bindingId, request.principal.id],
        );
        if (result.rows.length === 0) unavailable("not_found");
        if (result.rows.length !== 1) unavailable();
        return project(result.rows[0], request.taskId);
      } catch (error) {
        if (error instanceof RoomDistributionUnavailableError) throw error;
        unavailable();
      } finally {
        client?.release();
      }
    },
  });
}
