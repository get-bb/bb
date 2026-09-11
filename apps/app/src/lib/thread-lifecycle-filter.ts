import type { ThreadLifecycle } from "@bb/domain";

export const THREAD_LIFECYCLE_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "drafts", label: "Drafts" },
  { value: "archived", label: "Archived" },
] as const satisfies ReadonlyArray<{ value: ThreadLifecycle; label: string }>;

export function toggleThreadLifecycle(
  selected: readonly ThreadLifecycle[],
  value: ThreadLifecycle,
): ThreadLifecycle[] {
  const next = new Set(selected);
  if (next.has(value)) {
    if (next.size === 1) return [...selected];
    next.delete(value);
  } else {
    next.add(value);
  }
  return THREAD_LIFECYCLE_OPTIONS.flatMap((option) =>
    next.has(option.value) ? [option.value] : [],
  );
}
