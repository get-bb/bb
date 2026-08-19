import type { Principal } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";

import { RoomDistributionUnavailableError } from "../../src/room-distribution/room-distribution-port.js";
import { createWorkTogetherRoomTaskProjection } from "../../src/room-distribution/work-together-room-task-projection.js";

const CELL_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const BINDING_ID = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const DIGEST = "ab".repeat(32);
const PRINCIPAL: Principal = Object.freeze({
  id: "user_RoomReader",
  kind: "human",
  displayName: "Room Reader",
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    task_id: TASK_ID,
    context_version: "1",
    context_digest: DIGEST,
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
  });
  return { projection, query, release };
}

function request() {
  return {
    bindingId: BINDING_ID,
    cellId: CELL_ID,
    workspaceId: WORKSPACE_ID,
    taskId: TASK_ID,
    principal: PRINCIPAL,
  };
}

const INVALID_ROWS: unknown[][] = [
  [],
  [row(), row()],
  [row({ task_id: "11111111-1111-4111-8111-111111111111" })],
  [row({ title: "leaked" })],
  [row({ context_digest: "not-a-digest" })],
  [row({ context_version: 0 })],
];

describe("Work Together Room task projection", () => {
  it("returns a closed task stub from the applied context receipt", async () => {
    const test = fixture([row()]);
    await expect(test.projection.read(request())).resolves.toEqual({
      id: TASK_ID,
      status: "In progress",
      objective: null,
    });
    expect(test.query).toHaveBeenCalledWith(
      expect.stringContaining("work_together.bb_cell_room_task($1,$2,$3)"),
      [CELL_ID, BINDING_ID, PRINCIPAL.id],
    );
    expect(test.query).toHaveBeenCalledWith(
      expect.stringContaining("context_version, context_digest"),
      [CELL_ID, BINDING_ID, PRINCIPAL.id],
    );
    expect(JSON.stringify(await test.projection.read(request()))).not.toContain(
      "leaked",
    );
    expect(test.release).toHaveBeenCalled();
  });

  it.each(INVALID_ROWS)(
    "fails closed for absent, ambiguous, malformed, or Goal-leaking rows",
    async (rows) => {
      const test = fixture(rows as unknown[]);
      await expect(test.projection.read(request())).rejects.toBeInstanceOf(
        RoomDistributionUnavailableError,
      );
      expect(test.release).toHaveBeenCalledOnce();
    },
  );

  it("queries the request cell rather than a boot-pinned workspace", async () => {
    const otherCell = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const otherWorkspace = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const test = fixture([row()]);
    await expect(
      test.projection.read({
        ...request(),
        cellId: otherCell,
        workspaceId: otherWorkspace,
      }),
    ).resolves.toMatchObject({ id: TASK_ID });
    expect(test.query).toHaveBeenCalledWith(
      expect.stringContaining("work_together.bb_cell_room_task($1,$2,$3)"),
      [otherCell, BINDING_ID, PRINCIPAL.id],
    );
  });

  it("rejects an invalid cell before opening the pool", async () => {
    const connect = vi.fn();
    const projection = createWorkTogetherRoomTaskProjection({
      pool: { connect },
    });
    await expect(
      projection.read({
        ...request(),
        cellId: "not-a-cell",
      }),
    ).rejects.toMatchObject({ kind: "not_found" });
    expect(connect).not.toHaveBeenCalled();
  });
});
