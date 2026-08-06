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

export interface ReserveWorkTogetherRoomResourcesInput {
  bindingId: string;
  workspaceId: string;
  taskId: string;
  cellId: string;
  repositoryBindingId: string;
  repositoryBindingVersion: number;
  providerRepositoryId: string;
  baseBranch: string;
  generatedBranch: string;
  candidateHostId: string;
  environmentTemplate: "managed-worktree";
}

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
  requireUuid(input.repositoryBindingId);
  requireUuid(input.candidateHostId);
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
  requireBranch(input.baseBranch);
  requireBranch(input.generatedBranch);
  if (input.environmentTemplate !== "managed-worktree") {
    throw new TypeError(
      "Invalid Work Together Room resource reservation environment template",
    );
  }
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
    row.repositoryBindingId === input.repositoryBindingId &&
    row.repositoryBindingVersion === input.repositoryBindingVersion &&
    row.providerRepositoryId === input.providerRepositoryId &&
    row.baseBranch === input.baseBranch &&
    row.generatedBranch === input.generatedBranch &&
    row.candidateHostId === input.candidateHostId &&
    row.environmentTemplate === input.environmentTemplate
  );
}

export function getWorkTogetherRoomResourceReservation(
  db: DbQueryConnection,
  bindingId: string,
): WorkTogetherRoomResourceReservation | null {
  requireUuid(bindingId);
  return getByBindingId(db, bindingId);
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
