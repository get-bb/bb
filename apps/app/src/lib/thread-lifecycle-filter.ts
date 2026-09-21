import type { ThreadArchiveFilter } from "@bb/domain";

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
