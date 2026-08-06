import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createConnection,
  getWorkTogetherRoomResourceReservation,
  migrate,
  reserveWorkTogetherRoomResources,
  WorkTogetherRoomResourceReservationConflictError,
  type DbConnection,
  type ReserveWorkTogetherRoomResourcesInput,
} from "../../src/index.js";

function setup(path = ":memory:"): DbConnection {
  const db = createConnection(path);
  migrate(db);
  return db;
}

function input(
  overrides: Partial<ReserveWorkTogetherRoomResourcesInput> = {},
): ReserveWorkTogetherRoomResourcesInput {
  return {
    bindingId: randomUUID(),
    workspaceId: randomUUID(),
    taskId: randomUUID(),
    cellId: randomUUID(),
    repositoryBindingId: randomUUID(),
    repositoryBindingVersion: 1,
    providerRepositoryId: "42",
    baseBranch: "main",
    generatedBranch: "room/example",
    candidateHostId: randomUUID(),
    environmentTemplate: "managed-worktree",
    ...overrides,
  };
}

describe("Work Together Room resource reservations", () => {
  it("preallocates exact BB identities and replays without rewriting them", () => {
    const db = setup();
    try {
      const launch = input();
      const reserved = reserveWorkTogetherRoomResources(db, launch);
      expect(reserved).toMatchObject(launch);
      expect(reserved.projectId).toMatch(/^proj_/u);
      expect(reserved.projectSourceId).toMatch(/^src_/u);
      expect(reserved.environmentId).toMatch(/^env_/u);
      expect(reserved.primaryThreadId).toMatch(/^thr_/u);

      const replay = reserveWorkTogetherRoomResources(db, launch);
      expect(replay).toEqual(reserved);
      expect(getWorkTogetherRoomResourceReservation(db, launch.bindingId)).toEqual(
        reserved,
      );
    } finally {
      db.$client.close();
    }
  });

  it("survives a process restart with the same preallocated identities", () => {
    const directory = mkdtempSync(join(tmpdir(), "bb-wt-room-reservation-"));
    const path = join(directory, "bb.db");
    const launch = input();
    let first: DbConnection | undefined;
    let second: DbConnection | undefined;
    try {
      first = setup(path);
      const reserved = reserveWorkTogetherRoomResources(first, launch);
      first.$client.close();
      first = undefined;

      second = setup(path);
      expect(reserveWorkTogetherRoomResources(second, launch)).toEqual(reserved);
    } finally {
      first?.$client.close();
      second?.$client.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rejects changed launch facts and a second binding for one task", () => {
    const db = setup();
    try {
      const launch = input();
      reserveWorkTogetherRoomResources(db, launch);
      expect(() =>
        reserveWorkTogetherRoomResources(db, {
          ...launch,
          generatedBranch: "room/changed",
        }),
      ).toThrow(WorkTogetherRoomResourceReservationConflictError);
      expect(() =>
        reserveWorkTogetherRoomResources(
          db,
          input({
            workspaceId: launch.workspaceId,
            taskId: launch.taskId,
          }),
        ),
      ).toThrow(WorkTogetherRoomResourceReservationConflictError);
    } finally {
      db.$client.close();
    }
  });

  it("rejects malformed authority facts before allocating", () => {
    const db = setup();
    try {
      expect(() =>
        reserveWorkTogetherRoomResources(db, input({ bindingId: "not-a-uuid" })),
      ).toThrow(/Invalid Work Together Room resource reservation UUID/u);
      expect(() =>
        reserveWorkTogetherRoomResources(
          db,
          input({ repositoryBindingVersion: 0 }),
        ),
      ).toThrow(/repository version/u);
      expect(() =>
        reserveWorkTogetherRoomResources(
          db,
          input({ generatedBranch: "refs/heads/main" }),
        ),
      ).toThrow(/branch/u);
      expect(getWorkTogetherRoomResourceReservation(db, randomUUID())).toBeNull();
    } finally {
      db.$client.close();
    }
  });
});
