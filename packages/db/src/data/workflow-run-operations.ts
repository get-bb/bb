import { and, eq, inArray } from "drizzle-orm";
import type {
  LifecycleOperationState,
  WorkflowRunOperationKind,
} from "@bb/domain";
import { createWorkflowRunOperationId } from "../ids.js";
import { workflowRunOperations } from "../schema.js";
import {
  buildLifecycleOperationUpdateValues,
  buildRequestedLifecycleOperationValues,
  createLifecycleOperationRepository,
  getLifecycleOperationByCommandId,
  listLifecycleOperationRows,
  type LifecycleOperationReadConnection,
  type LifecycleOperationStore,
  type LifecycleOperationWriteConnection,
} from "./lifecycle-operation-helpers.js";

type WorkflowRunOperationWriteConnection = LifecycleOperationWriteConnection;
type WorkflowRunOperationReadConnection = LifecycleOperationReadConnection;

export type WorkflowRunOperationRow =
  typeof workflowRunOperations.$inferSelect;

export interface GetWorkflowRunOperationArgs {
  kind: WorkflowRunOperationKind;
  runId: string;
}

export interface UpsertWorkflowRunOperationInput {
  kind: WorkflowRunOperationKind;
  payload: string;
  requestedAt?: number;
  runId: string;
}

export interface UpdateWorkflowRunOperationStateArgs {
  allowedCurrentStates?: readonly LifecycleOperationState[];
  commandId?: string | null;
  completedAt?: number | null;
  failureReason?: string | null;
  kind: WorkflowRunOperationKind;
  payload?: string;
  queuedAt?: number | null;
  runId: string;
  state: LifecycleOperationState;
}

export interface ListWorkflowRunOperationsArgs {
  kinds?: WorkflowRunOperationKind[];
  runIds?: string[];
  states?: LifecycleOperationState[];
}

function getWorkflowRunOperationRecord(
  db: WorkflowRunOperationReadConnection,
  args: GetWorkflowRunOperationArgs,
): WorkflowRunOperationRow | null {
  return (
    db
      .select()
      .from(workflowRunOperations)
      .where(
        and(
          eq(workflowRunOperations.runId, args.runId),
          eq(workflowRunOperations.kind, args.kind),
        ),
      )
      .get() ?? null
  );
}

function updateWorkflowRunOperationStateRecord(
  db: WorkflowRunOperationWriteConnection,
  args: UpdateWorkflowRunOperationStateArgs,
): WorkflowRunOperationRow | null {
  return (
    db
      .update(workflowRunOperations)
      .set(
        buildLifecycleOperationUpdateValues({
          state: args.state,
          payload: args.payload,
          extraValues: {},
          commandId: args.commandId,
          queuedAt: args.queuedAt,
          completedAt: args.completedAt,
          failureReason: args.failureReason,
        }),
      )
      .where(
        and(
          eq(workflowRunOperations.runId, args.runId),
          eq(workflowRunOperations.kind, args.kind),
          args.allowedCurrentStates
            ? inArray(workflowRunOperations.state, [
                ...args.allowedCurrentStates,
              ])
            : undefined,
        ),
      )
      .returning()
      .get() ?? null
  );
}

const workflowRunOperationStore: LifecycleOperationStore<
  WorkflowRunOperationRow,
  GetWorkflowRunOperationArgs,
  WorkflowRunOperationKind,
  UpsertWorkflowRunOperationInput
> = {
  get: getWorkflowRunOperationRecord,
  getIdentity: (input) => ({
    runId: input.runId,
    kind: input.kind,
  }),
  insertRequested: (db, args) =>
    db
      .insert(workflowRunOperations)
      .values(
        buildRequestedLifecycleOperationValues({
          createId: createWorkflowRunOperationId,
          identity: {
            runId: args.input.runId,
          },
          input: args.input,
          extraValues: {},
          now: args.now,
          requestedAt: args.requestedAt,
        }),
      )
      .returning()
      .get(),
  updateState: (db, args) =>
    updateWorkflowRunOperationStateRecord(db, {
      runId: args.identity.runId,
      kind: args.identity.kind,
      allowedCurrentStates: args.allowedCurrentStates,
      payload: args.payload,
      state: args.state,
      commandId: args.commandId,
      queuedAt: args.queuedAt,
      completedAt: args.completedAt,
      failureReason: args.failureReason,
    }),
};
const workflowRunOperationRepository = createLifecycleOperationRepository(
  workflowRunOperationStore,
);

export function getWorkflowRunOperation(
  db: WorkflowRunOperationReadConnection,
  args: GetWorkflowRunOperationArgs,
): WorkflowRunOperationRow | null {
  return getWorkflowRunOperationRecord(db, args);
}

export function listWorkflowRunOperations(
  db: WorkflowRunOperationReadConnection,
  args: ListWorkflowRunOperationsArgs = {},
): WorkflowRunOperationRow[] {
  const filters = [
    args.kinds && args.kinds.length > 0
      ? inArray(workflowRunOperations.kind, args.kinds)
      : undefined,
    args.runIds && args.runIds.length > 0
      ? inArray(workflowRunOperations.runId, args.runIds)
      : undefined,
    args.states && args.states.length > 0
      ? inArray(workflowRunOperations.state, args.states)
      : undefined,
  ].filter((value) => value !== undefined);

  return listLifecycleOperationRows(
    db,
    workflowRunOperations,
    filters.length > 0 ? and(...filters) : undefined,
  );
}

export function getWorkflowRunOperationByCommandId(
  db: WorkflowRunOperationReadConnection,
  commandId: string,
): WorkflowRunOperationRow | null {
  return getLifecycleOperationByCommandId(
    db,
    workflowRunOperations,
    commandId,
  );
}

export const upsertWorkflowRunOperationRecord =
  workflowRunOperationRepository.upsert;
export const markWorkflowRunOperationRecordQueued =
  workflowRunOperationRepository.markQueued;
export const markWorkflowRunOperationRecordCompleted =
  workflowRunOperationRepository.markCompleted;
export const markWorkflowRunOperationRecordFailed =
  workflowRunOperationRepository.markFailed;
export const cancelWorkflowRunOperationRecord =
  workflowRunOperationRepository.cancel;
