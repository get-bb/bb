import type { Principal } from "@bb/domain";

import { RoomDistributionUnavailableError } from "./room-distribution-port.js";

export type WorkTogetherRoomCommandAuthorityV1 = Readonly<{
  isTaskAssignee: boolean;
  role: "member" | "owner";
}>;

export interface WorkTogetherRoomCommandAuthorityPortV1 {
  read(input: {
    bindingId: string;
    workspaceId: string;
    taskId: string;
    principal: Principal;
  }): Promise<WorkTogetherRoomCommandAuthorityV1>;
}

export interface WorkTogetherRoomCommandAuthoritySqlPool {
  connect(): Promise<{
    query(queryText: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
    release(): void;
  }>;
}

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SUBJECT = /^user_[A-Za-z0-9]{1,128}$/u;
const ROW_KEYS = ["is_task_assignee", "membership_role"] as const;

function unavailable(kind: "not_found" | "unavailable" = "unavailable"): never {
  throw new RoomDistributionUnavailableError(kind);
}

function project(rowValue: unknown): WorkTogetherRoomCommandAuthorityV1 {
  if (
    rowValue === null ||
    typeof rowValue !== "object" ||
    Array.isArray(rowValue)
  ) {
    unavailable();
  }
  const row = rowValue as Record<string, unknown>;
  const actual = Object.keys(row).sort();
  const expected = [...ROW_KEYS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index]) ||
    (row.membership_role !== "member" && row.membership_role !== "owner") ||
    typeof row.is_task_assignee !== "boolean"
  ) {
    unavailable();
  }
  return Object.freeze({
    role: row.membership_role,
    isTaskAssignee: row.is_task_assignee,
  });
}

/** Read current Room command policy facts through the cell login only. */
export function createWorkTogetherRoomCommandAuthority(input: {
  pool: WorkTogetherRoomCommandAuthoritySqlPool;
  cellId: string;
  workspaceId: string;
}): WorkTogetherRoomCommandAuthorityPortV1 {
  if (
    !CANONICAL_UUID.test(input.cellId) ||
    !CANONICAL_UUID.test(input.workspaceId)
  ) {
    unavailable();
  }
  return Object.freeze({
    async read(
      request: Parameters<WorkTogetherRoomCommandAuthorityPortV1["read"]>[0],
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
          `select membership_role,is_task_assignee
             from work_together.bb_cell_room_command_authority($1,$2,$3,$4)`,
          [
            input.cellId,
            request.bindingId,
            request.taskId,
            request.principal.id,
          ],
        );
        if (result.rows.length === 0) unavailable("not_found");
        if (result.rows.length !== 1) unavailable();
        return project(result.rows[0]);
      } catch (error) {
        if (error instanceof RoomDistributionUnavailableError) throw error;
        unavailable();
      } finally {
        client?.release();
      }
    },
  });
}
