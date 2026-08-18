import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createConnection,
  getWorkTogetherRoomResourceReservation,
  getWorkTogetherRoomResourceReservationByEnvironment,
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

type ManagedInput = Extract<
  ReserveWorkTogetherRoomResourcesInput,
  { environmentTemplate: "managed-worktree" }
>;

function input(overrides: Partial<ManagedInput> = {}): ManagedInput {
  return {
    bindingId: randomUUID(),
    workspaceId: randomUUID(),
    taskId: randomUUID(),
    cellId: randomUUID(),
    workKind: "code",
    repositorySnapshotId: randomUUID(),
    repositoryBindingId: randomUUID(),
    repositoryBindingVersion: 1,
    providerRepositoryId: "42",
    objectFormat: "sha1",
    baseRevision: "a".repeat(40),
    baseBranch: "main",
    generatedBranch: "room/example",
    candidateHostId: randomUUID(),
    bbHostId: "host_23456789ab",
    projectName: "Example",
    providerId: "codex",
    sourcePath: "/tmp/example",
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
      expect(
        getWorkTogetherRoomResourceReservationByEnvironment(db, {
          environmentId: reserved.environmentId,
          projectId: reserved.projectId,
        }),
      ).toEqual(reserved);
      expect(
        getWorkTogetherRoomResourceReservationByEnvironment(db, {
          environmentId: reserved.environmentId,
          projectId: "proj_wrongroom",
        }),
      ).toBeNull();
    } finally {
      db.$client.close();
    }
  });

  it("persists scratch without fabricated repository facts", () => {
    const db = setup();
    try {
      const launch = {
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        cellId: randomUUID(),
        candidateHostId: randomUUID(),
        workKind: "code" as const,
        environmentTemplate: "isolated-scratch" as const,
      };
      const reserved = reserveWorkTogetherRoomResources(db, launch);
      expect(reserved).toMatchObject({
        ...launch,
        repositorySnapshotId: null,
        repositoryBindingId: null,
        repositoryBindingVersion: null,
        providerRepositoryId: null,
        objectFormat: null,
        baseRevision: null,
        baseBranch: null,
        generatedBranch: null,
      });
      expect(reserveWorkTogetherRoomResources(db, launch)).toEqual(reserved);
    } finally {
      db.$client.close();
    }
  });

  it("persists exact detached read-only facts without branches", () => {
    const db = setup();
    try {
      const launch: ReserveWorkTogetherRoomResourcesInput = {
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        cellId: randomUUID(),
        candidateHostId: randomUUID(),
        workKind: "research",
        environmentTemplate: "detached-read-only",
        repositorySnapshotId: randomUUID(),
        repositoryBindingId: randomUUID(),
        repositoryBindingVersion: 3,
        providerRepositoryId: "42",
        objectFormat: "sha256",
        baseRevision: "b".repeat(64),
      };
      expect(reserveWorkTogetherRoomResources(db, launch)).toMatchObject({
        ...launch,
        baseBranch: null,
        generatedBranch: null,
      });
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
          baseRevision: "b".repeat(40),
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
