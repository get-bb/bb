import type { DbConnection } from "@bb/db";
import { ApiError } from "../../errors.js";

export const SERVER_MOVE_FROZEN_RETRY_MS = 10_000;

const frozenDatabases = new WeakSet<DbConnection>();

export function setServerMoveFrozen(db: DbConnection, frozen: boolean): void {
  if (frozen) {
    frozenDatabases.add(db);
    return;
  }
  frozenDatabases.delete(db);
}

export function isServerMoveFrozen(db: DbConnection): boolean {
  return frozenDatabases.has(db);
}

const snapshotFencedDatabases = new WeakSet<DbConnection>();
const snapshotFenceListeners = new WeakMap<
  DbConnection,
  Set<(fenced: boolean) => void>
>();

export function onServerMoveSnapshotFence(
  db: DbConnection,
  listener: (fenced: boolean) => void,
): () => void {
  let listeners = snapshotFenceListeners.get(db);
  if (!listeners) {
    listeners = new Set();
    snapshotFenceListeners.set(db, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setServerMoveSnapshotFence(
  db: DbConnection,
  fenced: boolean,
): void {
  if (fenced) snapshotFencedDatabases.add(db);
  else snapshotFencedDatabases.delete(db);
  for (const listener of snapshotFenceListeners.get(db) ?? []) listener(fenced);
}

export function isServerMoveSnapshotFenced(db: DbConnection): boolean {
  return snapshotFencedDatabases.has(db);
}

export function serverMovingError(): ApiError {
  return new ApiError(
    503,
    "server_moving",
    "The server is moving to another machine. Changes are paused until the move finishes or is cancelled.",
    false,
  );
}
