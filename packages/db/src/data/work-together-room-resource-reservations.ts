import { and, eq } from "drizzle-orm";
import { gitBranchNameSchema } from "@bb/domain";

import type { DbConnection, DbQueryConnection } from "../connection.js";
import {
  createEnvironmentId,
  createProjectId,
  createProjectSourceId,
  createThreadId,
} from "../ids.js";
import { workTogetherRoomResourceReservations } from "../schema.js";

export const WORK_TOGETHER_ROOM_WORK_KINDS = [
  "conversation",
  "research",
  "plan",
  "writing",
  "code",
  "other",
] as const;

export type WorkTogetherRoomWorkKind =
  (typeof WORK_TOGETHER_ROOM_WORK_KINDS)[number];

interface ReserveWorkTogetherRoomResourcesCommonInput {
  bindingId: string;
  workspaceId: string;
  taskId: string;
  cellId: string;
  candidateHostId: string;
  workKind: WorkTogetherRoomWorkKind;
  bbHostId?: string;
  projectName?: string;
  providerId?: string;
  sourcePath?: string;
}

export type ReserveWorkTogetherRoomResourcesInput =
  | (ReserveWorkTogetherRoomResourcesCommonInput & {
      environmentTemplate: "isolated-scratch";
    })
  | (ReserveWorkTogetherRoomResourcesCommonInput & {
      environmentTemplate: "detached-read-only";
      workKind: Exclude<WorkTogetherRoomWorkKind, "code">;
      repositorySnapshotId: string;
      repositoryBindingId: string;
      repositoryBindingVersion: number;
      providerRepositoryId: string;
      objectFormat: "sha1" | "sha256";
      baseRevision: string;
    })
  | (ReserveWorkTogetherRoomResourcesCommonInput & {
      environmentTemplate: "managed-worktree";
      workKind: "code";
      repositorySnapshotId: string;
      repositoryBindingId: string;
      repositoryBindingVersion: number;
      providerRepositoryId: string;
      objectFormat: "sha1" | "sha256";
      baseRevision: string;
      baseBranch: string;
      generatedBranch: string;
    });

export type WorkTogetherRoomResourceReservation =
  typeof workTogetherRoomResourceReservations.$inferSelect;

export class WorkTogetherRoomResourceReservationConflictError extends Error {
  constructor() {
    super("Work Together Room resource reservation conflicts with existing state");
    this.name = "WorkTogetherRoomResourceReservationConflictError";
  }
}

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROVIDER_REPOSITORY_ID = /^[1-9][0-9]*$/u;
const SHA1_OBJECT_ID = /^[0-9a-f]{40}$/u;
const SHA256_OBJECT_ID = /^[0-9a-f]{64}$/u;
const MAX_BRANCH_BYTES = 255;
const MAX_PROVIDER_REPOSITORY_ID_BYTES = 128;

function requireUuid(value: string): void {
  if (!CANONICAL_UUID.test(value)) {
    throw new TypeError("Invalid Work Together Room resource reservation UUID");
  }
}

function requireBranch(value: string): void {
  if (
    !gitBranchNameSchema.safeParse(value).success ||
    Buffer.byteLength(value, "utf8") > MAX_BRANCH_BYTES ||
    value.startsWith("refs/")
  ) {
    throw new TypeError("Invalid Work Together Room resource reservation branch");
  }
}

function validateInput(input: ReserveWorkTogetherRoomResourcesInput): void {
  requireUuid(input.bindingId);
  requireUuid(input.workspaceId);
  requireUuid(input.taskId);
  requireUuid(input.cellId);
  requireUuid(input.candidateHostId);
  if (!WORK_TOGETHER_ROOM_WORK_KINDS.includes(input.workKind)) {
    throw new TypeError("Invalid Work Together Room resource reservation work kind");
  }
  if (
    (input.bbHostId !== undefined && input.bbHostId.length === 0) ||
    (input.projectName !== undefined && input.projectName.length === 0) ||
    (input.providerId !== undefined && input.providerId.length === 0) ||
    (input.sourcePath !== undefined && input.sourcePath.length === 0)
  ) {
    throw new TypeError("Invalid Work Together Room resource reservation target");
  }
  if (input.environmentTemplate === "isolated-scratch") return;

  requireUuid(input.repositorySnapshotId);
  requireUuid(input.repositoryBindingId);
  if (
    !Number.isSafeInteger(input.repositoryBindingVersion) ||
    input.repositoryBindingVersion < 1
  ) {
    throw new TypeError(
      "Invalid Work Together Room resource reservation repository version",
    );
  }
  if (
    !PROVIDER_REPOSITORY_ID.test(input.providerRepositoryId) ||
    Buffer.byteLength(input.providerRepositoryId, "utf8") >
      MAX_PROVIDER_REPOSITORY_ID_BYTES
  ) {
    throw new TypeError(
      "Invalid Work Together Room resource reservation repository id",
    );
  }
  const revisionPattern =
    input.objectFormat === "sha1"
      ? SHA1_OBJECT_ID
      : input.objectFormat === "sha256"
        ? SHA256_OBJECT_ID
        : null;
  if (revisionPattern === null || !revisionPattern.test(input.baseRevision)) {
    throw new TypeError(
      "Invalid Work Together Room resource reservation revision",
    );
  }
  if (input.environmentTemplate === "detached-read-only") {
    return;
  }
  if (input.environmentTemplate !== "managed-worktree" || input.workKind !== "code") {
    throw new TypeError(
      "Invalid Work Together Room resource reservation environment template",
    );
  }
  requireBranch(input.baseBranch);
  requireBranch(input.generatedBranch);
}

function getByBindingId(
  db: DbQueryConnection,
  bindingId: string,
): WorkTogetherRoomResourceReservation | null {
  return (
    db
      .select()
      .from(workTogetherRoomResourceReservations)
      .where(eq(workTogetherRoomResourceReservations.bindingId, bindingId))
      .get() ?? null
  );
}

function sameLaunchFacts(
  row: WorkTogetherRoomResourceReservation,
  input: ReserveWorkTogetherRoomResourcesInput,
): boolean {
  return (
    row.bindingId === input.bindingId &&
    row.workspaceId === input.workspaceId &&
    row.taskId === input.taskId &&
    row.cellId === input.cellId &&
    row.candidateHostId === input.candidateHostId &&
    row.environmentTemplate === input.environmentTemplate &&
    row.workKind === input.workKind &&
    (input.bbHostId === undefined || row.bbHostId === input.bbHostId) &&
    (input.projectName === undefined || row.projectName === input.projectName) &&
    (input.providerId === undefined || row.providerId === input.providerId) &&
    (input.sourcePath === undefined || row.sourcePath === input.sourcePath) &&
    (input.environmentTemplate === "isolated-scratch" ||
      (row.repositorySnapshotId === input.repositorySnapshotId &&
        row.repositoryBindingId === input.repositoryBindingId &&
        row.repositoryBindingVersion === input.repositoryBindingVersion &&
        row.providerRepositoryId === input.providerRepositoryId &&
        row.objectFormat === input.objectFormat &&
        row.baseRevision === input.baseRevision &&
        (input.environmentTemplate === "detached-read-only" ||
          (row.baseBranch === input.baseBranch &&
            row.generatedBranch === input.generatedBranch))))
  );
}

export function getWorkTogetherRoomResourceReservation(
  db: DbQueryConnection,
  bindingId: string,
): WorkTogetherRoomResourceReservation | null {
  requireUuid(bindingId);
  return getByBindingId(db, bindingId);
}

export function getWorkTogetherRoomResourceReservationByEnvironmentId(
  db: DbQueryConnection,
  environmentId: string,
): WorkTogetherRoomResourceReservation | null {
  return (
    db
      .select()
      .from(workTogetherRoomResourceReservations)
      .where(
        eq(workTogetherRoomResourceReservations.environmentId, environmentId),
      )
      .get() ?? null
  );
}

export function getWorkTogetherRoomResourceReservationByEnvironment(
  db: DbQueryConnection,
  input: { environmentId: string; projectId: string },
): WorkTogetherRoomResourceReservation | null {
  return (
    db
      .select()
      .from(workTogetherRoomResourceReservations)
      .where(
        and(
          eq(
            workTogetherRoomResourceReservations.environmentId,
            input.environmentId,
          ),
          eq(workTogetherRoomResourceReservations.projectId, input.projectId),
        ),
      )
      .get() ?? null
  );
}

/**
 * Atomically reserves every BB identity before any corresponding resource row
 * is created. An exact retry returns the original allocation; a changed launch
 * fact or a second binding for the same workspace task fails closed.
 */
export function reserveWorkTogetherRoomResources(
  db: DbConnection,
  input: ReserveWorkTogetherRoomResourcesInput,
): WorkTogetherRoomResourceReservation {
  validateInput(input);
  return db.transaction(
    (tx) => {
      const existing = getByBindingId(tx, input.bindingId);
      if (existing !== null) {
        if (!sameLaunchFacts(existing, input)) {
          throw new WorkTogetherRoomResourceReservationConflictError();
        }
        return existing;
      }

      const taskReservation = tx
        .select({ bindingId: workTogetherRoomResourceReservations.bindingId })
        .from(workTogetherRoomResourceReservations)
        .where(
          and(
            eq(
              workTogetherRoomResourceReservations.workspaceId,
              input.workspaceId,
            ),
            eq(workTogetherRoomResourceReservations.taskId, input.taskId),
          ),
        )
        .get();
      if (taskReservation !== undefined) {
        throw new WorkTogetherRoomResourceReservationConflictError();
      }

      const now = Date.now();
      return tx
        .insert(workTogetherRoomResourceReservations)
        .values({
          ...input,
          projectId: createProjectId(),
          projectSourceId: createProjectSourceId(),
          environmentId: createEnvironmentId(),
          primaryThreadId: createThreadId(),
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    },
    { behavior: "immediate" },
  );
}
