import type { EntityKind } from "../../lib/sync/registry.js";

export interface PullOutcomeReason {
  code: string;
  count: number;
}

export interface PullOutcomeCounts {
  fetched: number;
  baseRows: number;
  quarantined: number;
}

export type PublishedPullOutcome = PullOutcomeCounts & {
  status: "published";
  generationId: string;
  acceptedAt: string;
  reasons: PullOutcomeReason[];
};

export type FailedPullOutcome = PullOutcomeCounts & {
  status: "failed";
  generationId: string | null;
  acceptedAt: null;
  reasons: PullOutcomeReason[];
};

/** Contract-v10 vocabulary shared by engine, CLI, RPC, and Sync UI consumers. */
export type PullKindOutcome = PublishedPullOutcome | FailedPullOutcome;

export interface IsolatedPullReport {
  kinds: Record<string, PullKindOutcome>;
  workingFastForwarded: boolean;
  divergence: string[];
}

export function pullFailureCode(message: string): string {
  return /^([A-Z][A-Z0-9_]+)(?::|$)/u.exec(message)?.[1] ?? "PULL_KIND_FAILED";
}

export function aggregatePullReasons(
  reasons: readonly Readonly<{ code: string; count: number }>[],
): PullOutcomeReason[] {
  const totals = new Map<string, number>();
  for (const reason of reasons) {
    if (reason.code.length === 0 || reason.count <= 0) continue;
    totals.set(reason.code, (totals.get(reason.code) ?? 0) + reason.count);
  }
  return [...totals]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

export function selectedOutcome(
  report: IsolatedPullReport,
  kind: EntityKind,
): PullKindOutcome {
  const outcome = report.kinds[kind];
  if (outcome === undefined) {
    throw new Error(`Pull report omitted requested kind ${kind}`);
  }
  return outcome;
}

export function pullReportHasFailures(report: IsolatedPullReport): boolean {
  return Object.values(report.kinds).some(
    (outcome) => outcome.status === "failed",
  );
}

export function renderPullOutcomeCli(report: IsolatedPullReport): string {
  const outcomes = Object.entries(report.kinds).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const published = outcomes.filter(
    ([, outcome]) => outcome.status === "published",
  ).length;
  const failed = outcomes.length - published;
  const lines = [
    `Pull complete: ${published} published, ${failed} failed`,
    ...outcomes.map(([kind, outcome]) => {
      const counts = `${outcome.fetched} fetched, ${outcome.baseRows} base rows, ${outcome.quarantined} quarantined`;
      const reasons = outcome.reasons
        .map((reason) => `${reason.code}=${reason.count}`)
        .join(", ");
      return `${kind}: ${outcome.status} · ${counts}${reasons.length > 0 ? ` · ${reasons}` : ""}`;
    }),
  ];
  return `${lines.join("\n")}\n`;
}
