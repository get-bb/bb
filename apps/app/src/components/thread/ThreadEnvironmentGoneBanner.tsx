import { EmptyState } from "@/components/ui/empty-state.js";

/**
 * Read-only footer banner shown in place of the composer when a thread's
 * environment is gone (status `destroying` or `destroyed`). Decoupling means
 * un-archive never resurrects an environment (Decision B*,
 * plans/lifecycle-target-state.md), so the thread can no longer run a turn —
 * there is intentionally no "Provision environment" action here (future work).
 */
export function ThreadEnvironmentGoneBanner() {
  return (
    <div
      className="mb-2 rounded-lg border border-border bg-surface-recessed px-4 py-3"
      role="status"
    >
      <EmptyState
        icon="CircleX"
        message="This environment is no longer available. This thread can't run any more work."
      />
    </div>
  );
}
