import {
  getHostPathComparisonKey,
  isHostPathWithin,
  isWindowsHostPath,
  isWindowsUncHostPath,
} from "@bb/domain";
import type Database from "better-sqlite3";
import { eq, inArray, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

function hostPathComparisonKeyForSql(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return getHostPathComparisonKey(value) ?? value;
}

function hostPathContainsForSql(
  rootPath: unknown,
  candidatePath: unknown,
): number {
  if (typeof rootPath !== "string" || typeof candidatePath !== "string") {
    return 0;
  }
  if (isWindowsHostPath(candidatePath)) {
    return isHostPathWithin({ rootPath, candidatePath }) ? 1 : 0;
  }
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`)
    ? 1
    : 0;
}

export function registerHostPathSqlFunctions(sqlite: Database.Database): void {
  sqlite.function(
    "bb_host_path_key",
    { deterministic: true },
    hostPathComparisonKeyForSql,
  );
  sqlite.function(
    "bb_host_path_contains",
    { deterministic: true },
    hostPathContainsForSql,
  );
}

export function hostPathEquals(column: SQLiteColumn, path: string): SQL {
  return isWindowsHostPath(path)
    ? sql`bb_host_path_key(${column}) = ${getHostPathComparisonKey(path) ?? path}`
    : eq(column, path);
}

function posixPathAndAncestors(path: string): string[] {
  const paths = [path];
  for (
    let separator = path.indexOf("/");
    separator >= 0;
    separator = path.indexOf("/", separator + 1)
  ) {
    paths.push(path.slice(0, separator));
  }
  return paths;
}

function windowsRootPrefixes(path: string): string[] {
  if (isWindowsUncHostPath(path)) {
    return ["\\", "/"];
  }
  const drive = path.slice(0, 1);
  return [`${drive.toUpperCase()}:`, `${drive.toLowerCase()}:`];
}

function startsWith(column: SQLiteColumn, prefix: string): SQL {
  const end = `${prefix.slice(0, -1)}${String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)}`;
  return sql`(${column} >= ${prefix} and ${column} < ${end})`;
}

export function hostPathContains(column: SQLiteColumn, path: string): SQL {
  if (!isWindowsHostPath(path)) {
    return inArray(column, posixPathAndAncestors(path));
  }
  const roots = windowsRootPrefixes(path).map((prefix) =>
    startsWith(column, prefix),
  );
  return sql`(${sql.join(roots, sql` or `)}) and bb_host_path_contains(${column}, ${path}) = 1`;
}
