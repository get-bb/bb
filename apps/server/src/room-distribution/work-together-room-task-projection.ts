import type { WorkTogetherRoomTaskProjectionPortV1 } from "./binding-backed-room-distribution.js";
import {
  RoomDistributionUnavailableError,
  type RoomJsonObject,
  type RoomJsonValue,
} from "./room-distribution-port.js";

export interface WorkTogetherRoomTaskSqlPool {
  connect(): Promise<{
    query(queryText: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
    release(): void;
  }>;
}

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SUBJECT = /^user_[A-Za-z0-9]{1,128}$/u;
const BIGINT = /^[1-9][0-9]{0,18}$/u;
const PRIORITIES = new Set(["Now", "Next", "Later"]);
const STATUSES = new Set([
  "Not started",
  "Ready",
  "In progress",
  "Waiting",
  "In review",
  "Done",
  "Killed",
]);
const WORK_KINDS = new Set([
  "conversation",
  "research",
  "plan",
  "writing",
  "code",
  "other",
]);
const ROW_KEYS = [
  "acceptance",
  "assignee_display_name",
  "brief",
  "priority",
  "status",
  "task_id",
  "task_version",
  "title",
  "work_kind",
] as const;

function unavailable(kind: "not_found" | "unavailable" = "unavailable"): never {
  throw new RoomDistributionUnavailableError(kind);
}

function boundedText(value: unknown, maxCodePoints: number): string {
  if (
    typeof value !== "string" ||
    value.normalize("NFC") !== value ||
    [...value].length > maxCodePoints ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    unavailable();
  }
  return value;
}

function exactRow(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    unavailable();
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...ROW_KEYS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    unavailable();
  }
  return record;
}

function jsonValue(value: unknown): RoomJsonValue {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    unavailable();
  }
  if (Buffer.byteLength(serialized, "utf8") > 32_768) unavailable();
  try {
    return JSON.parse(serialized) as RoomJsonValue;
  } catch {
    unavailable();
  }
}

function project(rowValue: unknown, taskId: string): RoomJsonObject {
  const row = exactRow(rowValue);
  const taskVersion = String(row.task_version);
  const title = boundedText(row.title, 240);
  const brief = boundedText(row.brief, 20_000);
  const assigneeDisplayName =
    row.assignee_display_name === null
      ? null
      : boundedText(row.assignee_display_name, 100);
  if (
    row.task_id !== taskId ||
    !BIGINT.test(taskVersion) ||
    typeof row.priority !== "string" ||
    !PRIORITIES.has(row.priority) ||
    typeof row.status !== "string" ||
    !STATUSES.has(row.status) ||
    typeof row.work_kind !== "string" ||
    !WORK_KINDS.has(row.work_kind)
  ) {
    unavailable();
  }
  return Object.freeze({
    id: taskId,
    version: taskVersion,
    title,
    brief,
    acceptance: jsonValue(row.acceptance),
    priority: row.priority,
    status: row.status,
    workKind: row.work_kind,
    assignee:
      assigneeDisplayName === null
        ? null
        : { displayName: assigneeDisplayName },
  });
}

/** Read canonical task display state through the cell login's single SQL function. */
export function createWorkTogetherRoomTaskProjection(input: {
  pool: WorkTogetherRoomTaskSqlPool;
  cellId: string;
  workspaceId: string;
}): WorkTogetherRoomTaskProjectionPortV1 {
  if (
    !CANONICAL_UUID.test(input.cellId) ||
    !CANONICAL_UUID.test(input.workspaceId)
  ) {
    unavailable();
  }
  return Object.freeze({
    async read(
      request: Parameters<WorkTogetherRoomTaskProjectionPortV1["read"]>[0],
    ) {
      if (
        request.workspaceId !== input.workspaceId ||
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
          `select task_id,task_version,title,brief,acceptance,priority,status,
                  work_kind,assignee_display_name
             from work_together.bb_cell_room_task($1,$2,$3)`,
          [input.cellId, request.bindingId, request.principal.id],
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
