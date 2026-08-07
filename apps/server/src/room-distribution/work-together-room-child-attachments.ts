import type { Principal } from "@bb/domain";

import type { WorkTogetherRoomTaskSqlPool } from "./work-together-room-task-projection.js";
import { RoomDistributionUnavailableError } from "./room-distribution-port.js";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SUBJECT = /^user_[A-Za-z0-9]{1,128}$/u;
const BB_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const MAX_ROOM_CHILDREN = 64;

const ROW_KEYS = [
  "attachment_id",
  "child_thread_id",
  "parent_thread_id",
] as const;
const ATTACH_ROW_KEYS = ["attachment_id"] as const;

export type WorkTogetherRoomChildAttachmentV1 = Readonly<{
  id: string;
  childThreadId: string;
  parentThreadId: string;
}>;

export interface WorkTogetherRoomChildAttachmentPortV1 {
  attach(input: {
    bindingId: string;
    workspaceId: string;
    parentThreadId: string;
    childThreadId: string;
  }): Promise<WorkTogetherRoomChildAttachmentV1>;
  list(input: {
    bindingId: string;
    workspaceId: string;
    principal: Principal;
  }): Promise<readonly WorkTogetherRoomChildAttachmentV1[]>;
}

function unavailable(kind: "not_found" | "unavailable" = "unavailable"): never {
  throw new RoomDistributionUnavailableError(kind);
}

function projectRow(value: unknown): WorkTogetherRoomChildAttachmentV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    unavailable();
  }
  const row = value as Record<string, unknown>;
  const actual = Object.keys(row).sort();
  const expected = [...ROW_KEYS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index]) ||
    typeof row.attachment_id !== "string" ||
    !CANONICAL_UUID.test(row.attachment_id) ||
    typeof row.child_thread_id !== "string" ||
    !BB_ID.test(row.child_thread_id) ||
    typeof row.parent_thread_id !== "string" ||
    !BB_ID.test(row.parent_thread_id) ||
    row.child_thread_id === row.parent_thread_id
  ) {
    unavailable();
  }
  return Object.freeze({
    id: row.attachment_id,
    childThreadId: row.child_thread_id,
    parentThreadId: row.parent_thread_id,
  });
}

function projectAttachmentId(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    unavailable();
  }
  const row = value as Record<string, unknown>;
  const actual = Object.keys(row).sort();
  if (
    actual.length !== ATTACH_ROW_KEYS.length ||
    actual.some((key, index) => key !== ATTACH_ROW_KEYS[index]) ||
    typeof row.attachment_id !== "string" ||
    !CANONICAL_UUID.test(row.attachment_id)
  ) {
    unavailable();
  }
  return row.attachment_id;
}

function requireScope(input: {
  bindingId: string;
  workspaceId: string;
  expectedWorkspaceId: string;
}): void {
  if (
    input.workspaceId !== input.expectedWorkspaceId ||
    !CANONICAL_UUID.test(input.bindingId)
  ) {
    unavailable("not_found");
  }
}

/** Cell-login adapter for opaque, WT-authoritative Room child attachments. */
export function createWorkTogetherRoomChildAttachments(input: {
  pool: WorkTogetherRoomTaskSqlPool;
  cellId: string;
  workspaceId: string;
}): WorkTogetherRoomChildAttachmentPortV1 {
  if (
    !CANONICAL_UUID.test(input.cellId) ||
    !CANONICAL_UUID.test(input.workspaceId)
  ) {
    unavailable();
  }

  return Object.freeze({
    async attach(
      request: Parameters<WorkTogetherRoomChildAttachmentPortV1["attach"]>[0],
    ) {
      requireScope({
        bindingId: request.bindingId,
        workspaceId: request.workspaceId,
        expectedWorkspaceId: input.workspaceId,
      });
      if (
        !BB_ID.test(request.parentThreadId) ||
        !BB_ID.test(request.childThreadId) ||
        request.parentThreadId === request.childThreadId
      ) {
        unavailable("not_found");
      }
      let client;
      try {
        client = await input.pool.connect();
        const result = await client.query(
          `select work_together.attach_bb_room_child_attachment($1,$2,$3,$4)
                    as attachment_id`,
          [
            input.cellId,
            request.bindingId,
            request.parentThreadId,
            request.childThreadId,
          ],
        );
        if (result.rows.length !== 1) unavailable();
        return Object.freeze({
          id: projectAttachmentId(result.rows[0]),
          parentThreadId: request.parentThreadId,
          childThreadId: request.childThreadId,
        });
      } catch (error) {
        if (error instanceof RoomDistributionUnavailableError) throw error;
        unavailable();
      } finally {
        client?.release();
      }
    },

    async list(
      request: Parameters<WorkTogetherRoomChildAttachmentPortV1["list"]>[0],
    ) {
      requireScope({
        bindingId: request.bindingId,
        workspaceId: request.workspaceId,
        expectedWorkspaceId: input.workspaceId,
      });
      if (
        request.principal.kind !== "human" ||
        !SUBJECT.test(request.principal.id)
      ) {
        unavailable("not_found");
      }
      let client;
      try {
        client = await input.pool.connect();
        const result = await client.query(
          `select attachment_id,parent_thread_id,child_thread_id
             from work_together.list_bb_room_child_attachments($1,$2,$3)
            limit ${MAX_ROOM_CHILDREN + 1}`,
          [input.cellId, request.bindingId, request.principal.id],
        );
        if (result.rows.length > MAX_ROOM_CHILDREN) unavailable();
        const projected = result.rows.map(projectRow);
        const ids = new Set(projected.map((entry) => entry.id));
        const threadIds = new Set(
          projected.map((entry) => entry.childThreadId),
        );
        if (
          ids.size !== projected.length ||
          threadIds.size !== projected.length
        ) {
          unavailable();
        }
        return Object.freeze(projected);
      } catch (error) {
        if (error instanceof RoomDistributionUnavailableError) throw error;
        unavailable();
      } finally {
        client?.release();
      }
    },
  });
}
