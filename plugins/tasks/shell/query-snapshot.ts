import type { z } from "zod";

const QUERY_SNAPSHOT_STORAGE_ROOT = "bb-tasks:query-snapshot:";
const QUERY_SNAPSHOT_STORAGE_VERSION = "v1";
const QUERY_SNAPSHOT_STORAGE_PREFIX = `${QUERY_SNAPSHOT_STORAGE_ROOT}${QUERY_SNAPSHOT_STORAGE_VERSION}:`;

export function querySnapshotStorageKey(name: string): string {
  return `${QUERY_SNAPSHOT_STORAGE_PREFIX}${name}`;
}

let prunedOtherVersions = false;

/** Test-only: forget that this page load already pruned. */
export function resetQuerySnapshotStateForTest(): void {
  prunedOtherVersions = false;
}

/**
 * A version bump changes the key prefix, so older entries are simply never
 * read again — but they would sit in the profile forever. Drop them once per
 * page load, on the first snapshot access.
 */
function pruneOtherSnapshotVersions(): void {
  if (prunedOtherVersions) return;
  prunedOtherVersions = true;
  try {
    const stale: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (
        key !== null &&
        key.startsWith(QUERY_SNAPSHOT_STORAGE_ROOT) &&
        !key.startsWith(QUERY_SNAPSHOT_STORAGE_PREFIX)
      ) {
        stale.push(key);
      }
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    // No storage, or none we may enumerate: nothing to prune.
  }
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
  pruneOtherSnapshotVersions();
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
  pruneOtherSnapshotVersions();
  try {
    window.localStorage.setItem(
      querySnapshotStorageKey(name),
      JSON.stringify(value),
    );
  } catch {
    // Best-effort: the next mount simply loads without a snapshot.
  }
}
