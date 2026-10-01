import { isWindowsHostPath } from "@bb/domain";
import { eq, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

export function hostPathEquals(column: SQLiteColumn, path: string): SQL {
  return isWindowsHostPath(path)
    ? sql`${column} = ${path} COLLATE NOCASE`
    : eq(column, path);
}

export function hostPathContains(column: SQLiteColumn, path: string): SQL {
  const descendant = isWindowsHostPath(path)
    ? sql`${path} LIKE ${column} || '\\%'`
    : sql`${path} LIKE ${column} || '/%'`;
  return or(hostPathEquals(column, path), descendant) ?? descendant;
}
