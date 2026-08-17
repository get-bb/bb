import type { z } from "zod";
import { createJsonLocalStorage } from "@/lib/browser-storage";

export interface LastKnownCache<T> {
  /**
   * Storage key for one scope of this cache. `null` parts (an unset routing
   * dimension) serialize as "-" so the key shape stays fixed.
   */
  key(...scope: ReadonlyArray<string | null>): string;
  /** The remembered value, or null when absent, malformed, or unreadable. */
  read(key: string): T | null;
  /** Best-effort: storage failures (quota, privacy modes) are swallowed. */
  write(key: string, value: T): void;
}

/**
 * A localStorage cache for "last-known truth": the last verified answer a
 * surface received, replayed on the next mount so first paint shows real data
 * instead of a neutral default that the live answer then replaces.
 *
 * Contract for consumers:
 * - Treat replayed values as provisional (TanStack `placeholderData`,
 *   snapshot-seeded state) and keep every irreversible action gated on the
 *   live result.
 * - Write only verified results, never a fallback or an error-state stand-in.
 * - Bump `version` when the stored shape changes; entries from other versions
 *   are pruned on first use, and every read is validated against `schema` so a
 *   stale or hand-edited entry can never leak into the app as trusted data.
 *
 * Neither reads nor writes throw: a full store or a restricted browser (a
 * SecurityError on `localStorage` itself) degrades to "no cache", which is
 * what a cache is for. In particular a write inside a query function must
 * never turn a successful fetch into a query error, and a read during render
 * must never take the surface down.
 */
export function createLastKnownCache<T>({
  prefix,
  version,
  schema,
}: {
  prefix: string;
  version: string;
  schema: z.ZodType<T>;
}): LastKnownCache<T> {
  const storage = createJsonLocalStorage<unknown>();
  // A cache with no routing dimensions stores under the bare version key, so
  // the prune must spare it as well as the dotted scope namespace: pruning
  // "everything under my prefix that is not my version" would otherwise eat
  // the cache's own entry on the next page load.
  const zeroScopeKey = `${prefix}.${version}`;
  const versionPrefix = `${zeroScopeKey}.`;
  let pruned = false;
  const pruneOtherVersions = () => {
    if (pruned) return;
    pruned = true;
    try {
      const stale: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const stored = window.localStorage.key(index);
        if (
          stored !== null &&
          stored.startsWith(`${prefix}.`) &&
          stored !== zeroScopeKey &&
          !stored.startsWith(versionPrefix)
        ) {
          stale.push(stored);
        }
      }
      for (const key of stale) window.localStorage.removeItem(key);
    } catch {
      // No storage, or none we may enumerate: nothing to prune.
    }
  };
  return {
    key: (...scope) =>
      [prefix, version, ...scope.map((part) => part ?? "-")].join("."),
    read: (key) => {
      try {
        pruneOtherVersions();
        const stored = storage.getItem(key, null);
        if (stored === null) return null;
        const parsed = schema.safeParse(stored);
        return parsed.success ? parsed.data : null;
      } catch {
        // Unreadable storage (a SecurityError on the accessor, a blocked
        // getItem) is "no cache", by contract; a read must never turn into a
        // render or query failure.
        return null;
      }
    },
    write: (key, value) => {
      pruneOtherVersions();
      try {
        storage.setItem(key, value);
      } catch {
        // Best-effort by contract; see above.
      }
    },
  };
}
