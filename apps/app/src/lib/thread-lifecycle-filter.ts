import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "@/lib/browser-storage";

export type ThreadArchiveFilter = "active" | "archived";

function isThreadArchiveFilter(value: unknown): value is ThreadArchiveFilter[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 2 &&
    new Set(value).size === value.length &&
    value.every((item) => item === "active" || item === "archived")
  );
}

export function createThreadArchiveFilterAtom(storageKey: string) {
  return atomWithStorage<ThreadArchiveFilter[]>(
    storageKey,
    ["active"],
    createJsonLocalStorage(isThreadArchiveFilter),
    { getOnInit: true },
  );
}

export function normalizeThreadLifecycleFilter(
  value: readonly ThreadArchiveFilter[],
): ThreadArchiveFilter[] {
  return [
    ...(value.includes("active") || value.length === 0
      ? ["active" as const]
      : []),
    ...(value.includes("archived") ? ["archived" as const] : []),
  ];
}
