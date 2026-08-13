import type Database from "better-sqlite3";

export function getSerialSession(_db: Database.Database, _input: object): never {
  throw new Error("NOT_IMPLEMENTED: WP-87 owns serial sessions");
}
