import type { CheckModel } from "./tier-map.js";
import { mapCheckToTier } from "./tier-map.js";
import {
  WORST_STATE_ORDER,
  type VerificationCell,
  type VerificationResultState,
  type VerificationTier,
} from "./status.js";

export interface VerificationResult {
  resultId: string;
  requirementId: string;
  checkId: string | null;
  tier: VerificationTier;
  status: VerificationResultState;
  runId: string | null;
  executedAt: string | null;
  isLatest: boolean;
  mappingState: "mapped" | "unmapped";
  firmwareVersionId: string | null;
}

function latestTimestamp(results: readonly VerificationResult[]): string | null {
  let latest: string | null = null;
  for (const result of results) {
    if (result.executedAt && (latest === null || result.executedAt > latest)) {
      latest = result.executedAt;
    }
  }
  return latest;
}

function worstState(results: readonly VerificationResult[]): VerificationResultState {
  for (const state of WORST_STATE_ORDER) {
    if (results.some((result) => result.status === state)) return state;
  }
  return "skipped";
}

export function aggregateCell(
  checks: readonly CheckModel[],
  latest: readonly VerificationResult[],
): VerificationCell {
  const requirementId = latest[0]?.requirementId ?? "";
  const tier = latest[0]?.tier ?? (checks[0] ? mapCheckToTier(checks[0]) : "static");
  return aggregateCellForTier(requirementId, tier, checks, latest);
}

export function aggregateCellForTier(
  requirementId: string,
  tier: VerificationTier,
  checks: readonly CheckModel[],
  results: readonly VerificationResult[],
): VerificationCell {
  const latest = results.filter((result) => result.isLatest);
  const runIds = Array.from(new Set(latest.flatMap((result) =>
    result.runId ? [result.runId] : [],
  ))).sort();
  return {
    requirementId,
    tier,
    state: latest.length > 0
      ? worstState(latest)
      : checks.length > 0
        ? "mapped_not_run"
        : "unmapped",
    checkCount: checks.length,
    requiredCount: checks.filter((check) => check.required).length,
    latestAt: latestTimestamp(latest),
    runIds,
  };
}
