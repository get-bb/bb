import type { ThreadLifecycle } from "@bb/domain";

export function normalizeThreadLifecycleFilter(
  value: readonly ThreadLifecycle[],
): ThreadLifecycle[] {
  return [
    ...(value.includes("active") || value.includes("draft") || value.length === 0
      ? ["active" as const]
      : []),
    ...(value.includes("archived") ? ["archived" as const] : []),
  ];
}
