import type { z } from "zod";

const QUERY_SNAPSHOT_STORAGE_PREFIX = "bb-tasks:query-snapshot:v1:";

export function querySnapshotStorageKey(name: string): string {
  return `${QUERY_SNAPSHOT_STORAGE_PREFIX}${name}`;
}

/**
 * Last-known query results, kept in the browser profile so a remount paints
 * the same truth it showed last time instead of a loading placeholder that
 * the real rows then replace. localStorage is a system boundary: anything
 * that fails to parse against the query's own schema is treated as absent.
 * Storage failures (disabled, full, private mode) degrade to "no snapshot".
 */
export function readQuerySnapshot<T>(
  name: string,
  schema: z.ZodType<T>,
): T | undefined {
  try {
    const raw = window.localStorage.getItem(querySnapshotStorageKey(name));
    if (raw === null) return undefined;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function writeQuerySnapshot(name: string, value: unknown): void {
  try {
    window.localStorage.setItem(
      querySnapshotStorageKey(name),
      JSON.stringify(value),
    );
  } catch {
    // Best-effort: the next mount simply loads without a snapshot.
  }
}
