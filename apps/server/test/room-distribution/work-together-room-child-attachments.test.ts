import type { Principal } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";

import { RoomDistributionUnavailableError } from "../../src/room-distribution/room-distribution-port.js";
import { createWorkTogetherRoomChildAttachments } from "../../src/room-distribution/work-together-room-child-attachments.js";

const CELL_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const BINDING_ID = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const ATTACHMENT_ID = "55555555-5555-4555-8555-555555555555";
const PRINCIPAL: Principal = Object.freeze({
  id: "user_RoomChildren",
  kind: "human",
  displayName: "Room Reader",
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    attachment_id: ATTACHMENT_ID,
    parent_thread_id: "thr_parent",
    child_thread_id: "thr_child",
    ...overrides,
  };
}

function fixture(results: unknown[][]) {
  const release = vi.fn();
  const query = vi.fn(async (_queryText: string, _values?: unknown[]) => ({
    rows: results.shift() ?? [],
  }));
  const connect = vi.fn(async () => ({ query, release }));
  const authority = createWorkTogetherRoomChildAttachments({
    pool: { connect },
    cellId: CELL_ID,
    workspaceId: WORKSPACE_ID,
  });
  return { authority, connect, query, release };
}

describe("Work Together Room child attachment SQL adapter", () => {
  it("attaches and lists only exact opaque rows through the cell functions", async () => {
    const test = fixture([[{ attachment_id: ATTACHMENT_ID }], [row()]]);
    await expect(
      test.authority.attach({
        bindingId: BINDING_ID,
        workspaceId: WORKSPACE_ID,
        parentThreadId: "thr_parent",
        childThreadId: "thr_child",
      }),
    ).resolves.toEqual({
      id: ATTACHMENT_ID,
      parentThreadId: "thr_parent",
      childThreadId: "thr_child",
    });
    await expect(
      test.authority.list({
        bindingId: BINDING_ID,
        workspaceId: WORKSPACE_ID,
        principal: PRINCIPAL,
      }),
    ).resolves.toEqual([
      {
        id: ATTACHMENT_ID,
        parentThreadId: "thr_parent",
        childThreadId: "thr_child",
      },
    ]);
    expect(test.query.mock.calls[0]![0]).toContain(
      "work_together.attach_bb_room_child_attachment",
    );
    expect(test.query.mock.calls[0]![1]).toEqual([
      CELL_ID,
      BINDING_ID,
      "thr_parent",
      "thr_child",
    ]);
    expect(test.query.mock.calls[1]![0]).toContain(
      "work_together.list_bb_room_child_attachments",
    );
    expect(test.query.mock.calls[1]![1]).toEqual([
      CELL_ID,
      BINDING_ID,
      PRINCIPAL.id,
    ]);
    expect(test.release).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid scope before SQL and malformed or duplicate authority rows", async () => {
    const invalid = fixture([]);
    await expect(
      invalid.authority.attach({
        bindingId: BINDING_ID,
        workspaceId: randomUuid(),
        parentThreadId: "thr_parent",
        childThreadId: "thr_child",
      }),
    ).rejects.toMatchObject({ kind: "not_found" });
    expect(invalid.connect).not.toHaveBeenCalled();

    const malformed = fixture([[row({ raw_thread_id: "leak" })]]);
    await expect(
      malformed.authority.list({
        bindingId: BINDING_ID,
        workspaceId: WORKSPACE_ID,
        principal: PRINCIPAL,
      }),
    ).rejects.toBeInstanceOf(RoomDistributionUnavailableError);

    const duplicate = fixture([[row(), row()]]);
    await expect(
      duplicate.authority.list({
        bindingId: BINDING_ID,
        workspaceId: WORKSPACE_ID,
        principal: PRINCIPAL,
      }),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("fails closed for a non-human principal and database errors", async () => {
    const wrongPrincipal = fixture([]);
    await expect(
      wrongPrincipal.authority.list({
        bindingId: BINDING_ID,
        workspaceId: WORKSPACE_ID,
        principal: { id: "system:test", kind: "system", displayName: "System" },
      }),
    ).rejects.toMatchObject({ kind: "not_found" });
    expect(wrongPrincipal.connect).not.toHaveBeenCalled();

    const release = vi.fn();
    const authority = createWorkTogetherRoomChildAttachments({
      pool: {
        connect: async () => ({
          query: async () => {
            throw new Error("database secret");
          },
          release,
        }),
      },
      cellId: CELL_ID,
      workspaceId: WORKSPACE_ID,
    });
    await expect(
      authority.list({
        bindingId: BINDING_ID,
        workspaceId: WORKSPACE_ID,
        principal: PRINCIPAL,
      }),
    ).rejects.toMatchObject({
      name: RoomDistributionUnavailableError.name,
      kind: "unavailable",
      message: "Room distribution unavailable",
    });
    expect(release).toHaveBeenCalledOnce();
  });
});

function randomUuid(): string {
  return "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
}
