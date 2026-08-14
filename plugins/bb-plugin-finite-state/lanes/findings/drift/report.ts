export type DriftState =
  | "reattached_noop"
  | "reapply"
  | "stale"
  | "orphaned"
  | "conflict"
  | "needs_completion";

export const FINDINGS_DRIFT_CHANGED_CHANNEL = "fs-findings-drift-changed";

export interface DriftItem {
  stableKey: string;
  state: DriftState;
  tier?: 1 | 2 | 3;
  reason: string;
  previousVersion?: string;
  currentVersion?: string;
}

export interface DriftReport {
  pvId: string;
  runId: string;
  createdAt: string;
  unclassifiedCount: number;
  totals: Record<DriftState, number>;
  items: DriftItem[];
  nextCursor: string | null;
}

export const DRIFT_REPORT_DEFAULT_LIMIT = 100;
export const DRIFT_REPORT_MAX_LIMIT = 200;

export function driftTotals(): Record<DriftState, number> {
  return {
    reattached_noop: 0,
    reapply: 0,
    stale: 0,
    orphaned: 0,
    conflict: 0,
    needs_completion: 0,
  };
}

export function boundedDriftLimit(limit: number | undefined): number {
  if (limit === undefined) return DRIFT_REPORT_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1)
    throw new TypeError("Drift report limit must be a positive integer");
  return Math.min(limit, DRIFT_REPORT_MAX_LIMIT);
}
