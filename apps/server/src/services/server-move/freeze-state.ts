import type { DbConnection } from "@bb/db";
import { ApiError } from "../../errors.js";

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

export function serverMovingError(): ApiError {
  return new ApiError(
    503,
    "server_moving",
    "The server is moving to another machine. Changes are paused until the move finishes or is cancelled.",
    false,
  );
}
