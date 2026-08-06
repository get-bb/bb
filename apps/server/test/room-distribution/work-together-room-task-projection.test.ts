import type { Principal } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";

import { RoomDistributionUnavailableError } from "../../src/room-distribution/room-distribution-port.js";
import { createWorkTogetherRoomTaskProjection } from "../../src/room-distribution/work-together-room-task-projection.js";

const CELL_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const BINDING_ID = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const PRINCIPAL: Principal = Object.freeze({
  id: "user_RoomReader",
  kind: "human",
  displayName: "Room Reader",
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    task_id: TASK_ID,
    task_version: "7",
    title: "Canonical task",
    brief: "Bounded brief",
    acceptance: [{ id: "a1", text: "Pass", done: false }],
    priority: "Now",
    status: "In progress",
    work_kind: "code",
    assignee_display_name: "Room Reader",
    ...overrides,
  };
}

function fixture(rows: unknown[]) {
  const release = vi.fn();
  const query = vi.fn(async () => ({ rows }));
  const projection = createWorkTogetherRoomTaskProjection({
    pool: {
      connect: async () => ({ query, release }),
    },
    cellId: CELL_ID,
    workspaceId: WORKSPACE_ID,
  });
  return { projection, query, release };
}

function request() {
  return {
    bindingId: BINDING_ID,
    workspaceId: WORKSPACE_ID,
    taskId: TASK_ID,
    principal: PRINCIPAL,
  };
}

const INVALID_ROWS: unknown[][] = [
  [],
  [row(), row()],
  [row({ task_id: "11111111-1111-4111-8111-111111111111" })],
  [row({ subject: "user_leaked" })],
  [row({ acceptance: BigInt(1) })],
];

describe("Work Together Room task projection", () => {
  it("returns a bounded subject-free canonical task through the exact SQL function", async () => {
    const test = fixture([row()]);
    await expect(test.projection.read(request())).resolves.toEqual({
      id: TASK_ID,
      version: "7",
      title: "Canonical task",
      brief: "Bounded brief",
      acceptance: [{ id: "a1", text: "Pass", done: false }],
      priority: "Now",
      status: "In progress",
      workKind: "code",
      assignee: { displayName: "Room Reader" },
    });
    expect(test.query).toHaveBeenCalledWith(
      expect.stringContaining("work_together.bb_cell_room_task($1,$2,$3)"),
      [CELL_ID, BINDING_ID, PRINCIPAL.id],
    );
    expect(test.release).toHaveBeenCalledOnce();
  });

  it.each(INVALID_ROWS)(
    "fails closed for absent, ambiguous, malformed, or non-JSON rows",
    async (rows) => {
      const test = fixture(rows as unknown[]);
      await expect(test.projection.read(request())).rejects.toBeInstanceOf(
        RoomDistributionUnavailableError,
      );
      expect(test.release).toHaveBeenCalledOnce();
    },
  );

  it("rejects a mismatched workspace before opening the pool", async () => {
    const connect = vi.fn();
    const projection = createWorkTogetherRoomTaskProjection({
      pool: { connect },
      cellId: CELL_ID,
      workspaceId: WORKSPACE_ID,
    });
    await expect(
      projection.read({
        ...request(),
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ).rejects.toMatchObject({ kind: "not_found" });
    expect(connect).not.toHaveBeenCalled();
  });
});
