import type { z } from "zod";
import { createJsonLocalStorage } from "@/lib/browser-storage";

interface LastKnownCache<T> {
  key(...scope: ReadonlyArray<string | null>): string;
  read(key: string): T | null;
  write(key: string, value: T): void;
  clear(): void;
}

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
    } catch {}
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
        return null;
      }
    },
    write: (key, value) => {
      pruneOtherVersions();
      try {
        storage.setItem(key, value);
      } catch {}
    },
    clear: () => {
      try {
        const owned: string[] = [];
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const stored = window.localStorage.key(index);
          if (
            stored !== null &&
            (stored === zeroScopeKey || stored.startsWith(versionPrefix))
          ) {
            owned.push(stored);
          }
        }
        for (const key of owned) window.localStorage.removeItem(key);
      } catch {}
    },
  };
}
