export type WorkEntry =
  | "completed_guide"
  | "skipped_guide"
  | "other"
  | "unknown";
export type WorkSource = "first_run" | "replay" | "other" | "unknown";

export interface OnboardingWorkContext {
  entry: WorkEntry;
  source: WorkSource;
}

let pendingEntry: OnboardingWorkContext | null = null;

export function recordOnboardingWorkEntry(
  outcome: "completed" | "skipped",
  source: "first_run" | "replay" | "unknown" = "unknown",
): void {
  pendingEntry = {
    entry: outcome === "completed" ? "completed_guide" : "skipped_guide",
    source,
  };
}

export function takeOnboardingWorkEntry(): OnboardingWorkContext {
  const context: OnboardingWorkContext = pendingEntry ?? {
    entry: "other",
    source: "other",
  };
  pendingEntry = null;
  return context;
}
