import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { RoomDistributionUnavailableError } from "../../src/room-distribution/room-distribution-port.js";
import { createWorkTogetherRoomCommandAuthority } from "../../src/room-distribution/work-together-room-command-authority.js";

const PRINCIPAL = Object.freeze({
  id: "user_alice",
  kind: "human" as const,
  displayName: "Alice",
});

describe("Work Together Room command authority", () => {
  it("reads only exact policy facts through the pinned cell function", async () => {
    const cellId = randomUUID();
    const workspaceId = randomUUID();
    const bindingId = randomUUID();
    const taskId = randomUUID();
    const release = vi.fn();
    const query = vi.fn(async () => ({
      rows: [{ membership_role: "owner", is_task_assignee: true }],
    }));
    const authority = createWorkTogetherRoomCommandAuthority({
      cellId,
      workspaceId,
      pool: {
        connect: async () => ({ query, release }),
      },
    });

    await expect(
      authority.read({ bindingId, workspaceId, taskId, principal: PRINCIPAL }),
    ).resolves.toEqual({ role: "owner", isTaskAssignee: true });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        "work_together.bb_cell_room_command_authority($1,$2,$3,$4)",
      ),
      [cellId, bindingId, taskId, PRINCIPAL.id],
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([
    { rows: [] },
    {
      rows: [
        { membership_role: "member", is_task_assignee: false },
        { membership_role: "member", is_task_assignee: false },
      ],
    },
    { rows: [{ membership_role: "admin", is_task_assignee: false }] },
    { rows: [{ membership_role: "member", is_task_assignee: "false" }] },
    {
      rows: [
        {
          membership_role: "member",
          is_task_assignee: false,
          principal_subject: "user_alice",
        },
      ],
    },
  ] satisfies { rows: unknown[] }[])(
    "fails closed for absent or malformed authority rows",
    async ({ rows }) => {
      const workspaceId = randomUUID();
      const authority = createWorkTogetherRoomCommandAuthority({
        cellId: randomUUID(),
        workspaceId,
        pool: {
          connect: async () => ({
            query: async () => ({ rows }),
            release: vi.fn(),
          }),
        },
      });

      await expect(
        authority.read({
          bindingId: randomUUID(),
          workspaceId,
          taskId: randomUUID(),
          principal: PRINCIPAL,
        }),
      ).rejects.toBeInstanceOf(RoomDistributionUnavailableError);
    },
  );

  it("rejects cross-workspace and non-human requests before opening SQL", async () => {
    const connect = vi.fn();
    const workspaceId = randomUUID();
    const authority = createWorkTogetherRoomCommandAuthority({
      cellId: randomUUID(),
      workspaceId,
      pool: { connect },
    });

    await expect(
      authority.read({
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        principal: PRINCIPAL,
      }),
    ).rejects.toMatchObject({ kind: "not_found" });
    await expect(
      authority.read({
        bindingId: randomUUID(),
        workspaceId,
        taskId: randomUUID(),
        principal: { ...PRINCIPAL, kind: "agent" },
      }),
    ).rejects.toMatchObject({ kind: "not_found" });
    expect(connect).not.toHaveBeenCalled();
  });
});
