import { and, eq } from "drizzle-orm";
import {
  activeLifecycleOperationStates,
  type LifecycleOperationState,
} from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import { workflowRunOperations } from "../schema.js";

export type LifecycleOperationReadConnection = DbConnection | DbTransaction;
export type LifecycleOperationWriteConnection = DbConnection | DbTransaction;

type LifecycleOperationTable = typeof workflowRunOperations;

export interface LifecycleOperationRecordBase<TKind> {
  commandId: string | null;
  completedAt: number | null;
  failureReason: string | null;
  kind: TKind;
  payload: string;
  queuedAt: number | null;
  requestedAt: number;
  state: LifecycleOperationState;
}

export interface LifecycleOperationUpsertInput<TKind> {
  kind: TKind;
  payload: string;
  requestedAt?: number;
}

export interface InsertRequestedLifecycleOperationArgs<TUpsertInput> {
  input: TUpsertInput;
  now: number;
  requestedAt: number;
}

export interface UpdateLifecycleOperationRecordArgs<
  TIdentityArgs,
  TUpsertInput,
> {
  allowedCurrentStates?: readonly LifecycleOperationState[];
  commandId?: string | null;
  completedAt?: number | null;
  failureReason?: string | null;
  identity: TIdentityArgs;
  payload?: string;
  queuedAt?: number | null;
  requestedInput?: TUpsertInput;
  state: LifecycleOperationState;
}

export interface LifecycleOperationStore<
  TRow extends LifecycleOperationRecordBase<TKind>,
  TIdentityArgs,
  TKind,
  TUpsertInput extends LifecycleOperationUpsertInput<TKind> & TIdentityArgs,
> {
  get(
    db: LifecycleOperationReadConnection,
    identity: TIdentityArgs,
  ): TRow | null;
  getIdentity(input: TIdentityArgs): TIdentityArgs;
  insertRequested(
    db: LifecycleOperationWriteConnection,
    args: InsertRequestedLifecycleOperationArgs<TUpsertInput>,
  ): TRow;
  updateState(
    db: LifecycleOperationWriteConnection,
    args: UpdateLifecycleOperationRecordArgs<TIdentityArgs, TUpsertInput>,
  ): TRow | null;
}

export interface QueueLifecycleOperationArgs<TIdentityArgs> {
  commandId: string;
  identity: TIdentityArgs;
  queuedAt?: number;
}

export interface CompleteLifecycleOperationArgs<TIdentityArgs> {
  completedAt?: number;
  identity: TIdentityArgs;
}

export interface FailLifecycleOperationArgs<TIdentityArgs> {
  completedAt?: number;
  failureReason: string;
  identity: TIdentityArgs;
}

export type QueueLifecycleOperationRecordArgs<TIdentityArgs> = TIdentityArgs & {
  commandId: string;
  queuedAt?: number;
};

export type CompleteLifecycleOperationRecordArgs<TIdentityArgs> =
  TIdentityArgs & {
    completedAt?: number;
  };

export type FailLifecycleOperationRecordArgs<TIdentityArgs> = TIdentityArgs & {
  completedAt?: number;
  failureReason: string;
};

export interface LifecycleOperationRepository<
  TRow extends LifecycleOperationRecordBase<TKind>,
  TIdentityArgs,
  TKind,
  TUpsertInput extends LifecycleOperationUpsertInput<TKind> & TIdentityArgs,
> {
  cancel(
    db: LifecycleOperationWriteConnection,
    args: CompleteLifecycleOperationRecordArgs<TIdentityArgs>,
  ): TRow | null;
  markCompleted(
    db: LifecycleOperationWriteConnection,
    args: CompleteLifecycleOperationRecordArgs<TIdentityArgs>,
  ): TRow | null;
  markFailed(
    db: LifecycleOperationWriteConnection,
    args: FailLifecycleOperationRecordArgs<TIdentityArgs>,
  ): TRow | null;
  markQueued(
    db: LifecycleOperationWriteConnection,
    args: QueueLifecycleOperationRecordArgs<TIdentityArgs>,
  ): TRow | null;
  upsert(
    db: LifecycleOperationWriteConnection,
    input: TUpsertInput,
  ): TRow;
}

export function createLifecycleOperationRepository<
  TRow extends LifecycleOperationRecordBase<TKind>,
  TIdentityArgs,
  TKind,
  TUpsertInput extends LifecycleOperationUpsertInput<TKind> & TIdentityArgs,
>(
  store: LifecycleOperationStore<TRow, TIdentityArgs, TKind, TUpsertInput>,
): LifecycleOperationRepository<TRow, TIdentityArgs, TKind, TUpsertInput> {
  return {
    cancel: (db, args) =>
      cancelLifecycleOperationRecord(db, store, {
        identity: store.getIdentity(args),
        completedAt: args.completedAt,
      }),
    markCompleted: (db, args) =>
      markLifecycleOperationCompleted(db, store, {
        identity: store.getIdentity(args),
        completedAt: args.completedAt,
      }),
    markFailed: (db, args) =>
      markLifecycleOperationFailed(db, store, {
        identity: store.getIdentity(args),
        completedAt: args.completedAt,
        failureReason: args.failureReason,
      }),
    markQueued: (db, args) =>
      markLifecycleOperationQueued(db, store, {
        identity: store.getIdentity(args),
        commandId: args.commandId,
        queuedAt: args.queuedAt,
      }),
    upsert: (db, input) => upsertLifecycleOperationRecord(db, store, input),
  };
}

export interface BuildRequestedLifecycleOperationValuesArgs<
  TKind,
  TIdentity extends object,
  TExtra extends object,
> {
  createId(): string;
  extraValues: TExtra;
  identity: TIdentity;
  input: LifecycleOperationUpsertInput<TKind>;
  now: number;
  requestedAt: number;
}

export function buildRequestedLifecycleOperationValues<
  TKind,
  TIdentity extends object,
  TExtra extends object = Record<string, never>,
>(
  args: BuildRequestedLifecycleOperationValuesArgs<TKind, TIdentity, TExtra>,
) {
  return {
    id: args.createId(),
    ...args.identity,
    kind: args.input.kind,
    state: "requested" as const,
    payload: args.input.payload,
    ...args.extraValues,
    commandId: null,
    requestedAt: args.requestedAt,
    queuedAt: null,
    completedAt: null,
    failureReason: null,
    createdAt: args.now,
    updatedAt: args.now,
  };
}

export interface BuildLifecycleOperationUpdateValuesArgs<TExtra extends object> {
  commandId?: string | null;
  completedAt?: number | null;
  extraValues: TExtra;
  failureReason?: string | null;
  payload?: string;
  queuedAt?: number | null;
  state: LifecycleOperationState;
}

export function buildLifecycleOperationUpdateValues<
  TExtra extends object = Record<string, never>,
>(args: BuildLifecycleOperationUpdateValuesArgs<TExtra>) {
  return {
    state: args.state,
    payload: args.payload,
    ...args.extraValues,
    commandId: args.commandId,
    queuedAt: args.queuedAt,
    completedAt: args.completedAt,
    failureReason: args.failureReason,
    updatedAt: Date.now(),
  };
}

export function getLifecycleOperationByCommandId<
  TTable extends LifecycleOperationTable,
>(
  db: LifecycleOperationReadConnection,
  table: TTable,
  commandId: string,
) {
  return (
    db
      .select()
      .from(table)
      .where(eq(table.commandId, commandId))
      .get() ?? null
  );
}

export function listLifecycleOperationRows<TTable extends LifecycleOperationTable>(
  db: LifecycleOperationReadConnection,
  table: TTable,
  filter: ReturnType<typeof and> | undefined,
) {
  return db.select().from(table).where(filter).all();
}

export function upsertLifecycleOperationRecord<
  TRow extends LifecycleOperationRecordBase<TKind>,
  TIdentityArgs,
  TKind,
  TUpsertInput extends LifecycleOperationUpsertInput<TKind> & TIdentityArgs,
>(
  db: LifecycleOperationWriteConnection,
  store: LifecycleOperationStore<TRow, TIdentityArgs, TKind, TUpsertInput>,
  input: TUpsertInput,
): TRow {
  const now = Date.now();
  const requestedAt = input.requestedAt ?? now;
  const identity = store.getIdentity(input);
  const existing = store.get(db, identity);

  if (existing) {
    return (
      store.updateState(db, {
        identity,
        payload: input.payload,
        requestedInput: input,
        state: "requested",
        commandId: null,
        queuedAt: null,
        completedAt: null,
        failureReason: null,
      }) ?? existing
    );
  }

  return store.insertRequested(db, {
    input,
    now,
    requestedAt,
  });
}

export function markLifecycleOperationQueued<
  TRow extends LifecycleOperationRecordBase<TKind>,
  TIdentityArgs,
  TKind,
  TUpsertInput extends LifecycleOperationUpsertInput<TKind> & TIdentityArgs,
>(
  db: LifecycleOperationWriteConnection,
  store: LifecycleOperationStore<TRow, TIdentityArgs, TKind, TUpsertInput>,
  args: QueueLifecycleOperationArgs<TIdentityArgs>,
): TRow | null {
  return store.updateState(db, {
    identity: args.identity,
    state: "queued",
    commandId: args.commandId,
    queuedAt: args.queuedAt ?? Date.now(),
    completedAt: null,
    failureReason: null,
    allowedCurrentStates: ["requested"],
  });
}

export function markLifecycleOperationCompleted<
  TRow extends LifecycleOperationRecordBase<TKind>,
  TIdentityArgs,
  TKind,
  TUpsertInput extends LifecycleOperationUpsertInput<TKind> & TIdentityArgs,
>(
  db: LifecycleOperationWriteConnection,
  store: LifecycleOperationStore<TRow, TIdentityArgs, TKind, TUpsertInput>,
  args: CompleteLifecycleOperationArgs<TIdentityArgs>,
): TRow | null {
  const existing = store.get(db, args.identity);
  if (!existing) {
    return null;
  }

  return store.updateState(db, {
    identity: args.identity,
    payload: existing.payload,
    state: "completed",
    commandId: existing.commandId,
    queuedAt: existing.queuedAt,
    completedAt: args.completedAt ?? Date.now(),
    failureReason: null,
    allowedCurrentStates: activeLifecycleOperationStates,
  });
}

export function markLifecycleOperationFailed<
  TRow extends LifecycleOperationRecordBase<TKind>,
  TIdentityArgs,
  TKind,
  TUpsertInput extends LifecycleOperationUpsertInput<TKind> & TIdentityArgs,
>(
  db: LifecycleOperationWriteConnection,
  store: LifecycleOperationStore<TRow, TIdentityArgs, TKind, TUpsertInput>,
  args: FailLifecycleOperationArgs<TIdentityArgs>,
): TRow | null {
  const existing = store.get(db, args.identity);
  if (!existing) {
    return null;
  }

  return store.updateState(db, {
    identity: args.identity,
    payload: existing.payload,
    state: "failed",
    commandId: existing.commandId,
    queuedAt: existing.queuedAt,
    completedAt: args.completedAt ?? Date.now(),
    failureReason: args.failureReason,
    allowedCurrentStates: activeLifecycleOperationStates,
  });
}

export function cancelLifecycleOperationRecord<
  TRow extends LifecycleOperationRecordBase<TKind>,
  TIdentityArgs,
  TKind,
  TUpsertInput extends LifecycleOperationUpsertInput<TKind> & TIdentityArgs,
>(
  db: LifecycleOperationWriteConnection,
  store: LifecycleOperationStore<TRow, TIdentityArgs, TKind, TUpsertInput>,
  args: CompleteLifecycleOperationArgs<TIdentityArgs>,
): TRow | null {
  const existing = store.get(db, args.identity);
  if (!existing) {
    return null;
  }

  return store.updateState(db, {
    identity: args.identity,
    payload: existing.payload,
    state: "cancelled",
    commandId: existing.commandId,
    queuedAt: existing.queuedAt,
    completedAt: args.completedAt ?? Date.now(),
    failureReason: null,
    allowedCurrentStates: activeLifecycleOperationStates,
  });
}
