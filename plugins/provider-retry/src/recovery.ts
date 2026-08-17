import type {
  BbPluginApi,
  ExperimentalFailedTurnCandidate,
  ExperimentalFailedTurnInspection,
} from "@get-bb/plugin-sdk";

type FailedTurnEventRow = ExperimentalFailedTurnCandidate["events"][number];
type RateLimitsEventRow = Extract<
  FailedTurnEventRow,
  { type: "provider/rateLimits/updated" }
>;
type ProviderErrorEventRow = Extract<
  FailedTurnEventRow,
  { type: "provider/error" }
>;

export type ProviderRateLimitState =
  RateLimitsEventRow["data"]["rateLimits"];

export type ProviderRetryReason =
  | ExperimentalFailedTurnInspection["reason"]
  | "manual-only"
  | "no-rate-limit-state"
  | "no-terminal-rate-limit-error"
  | "provider-will-retry";

export interface ProviderRetryCandidate {
  automatic: boolean;
  failedRequestId: ExperimentalFailedTurnCandidate["failedRequestId"];
  rateLimits: ProviderRateLimitState;
  resetsAtMs: number | null;
  turnId: string;
}

export type ProviderRetryInspection =
  | {
      candidate: ProviderRetryCandidate;
      hostId: string;
      rateLimits: ProviderRateLimitState;
      reason: "eligible" | "manual-only";
      scopeKey: string;
    }
  | {
      candidate: null;
      hostId: null;
      rateLimits: ProviderRateLimitState | null;
      reason: Exclude<ProviderRetryReason, "eligible" | "manual-only">;
      scopeKey: null;
    };

function emptyInspection(
  reason: Exclude<ProviderRetryReason, "eligible" | "manual-only">,
  rateLimits: ProviderRateLimitState | null = null,
): ProviderRetryInspection {
  return {
    candidate: null,
    hostId: null,
    rateLimits,
    reason,
    scopeKey: null,
  };
}

function recoveryResetAtMs(rateLimits: ProviderRateLimitState): number | null {
  const blockedWindows = rateLimits.windows.filter(
    (window) => window.status === "blocked",
  );
  const relevantWindows =
    blockedWindows.length > 0 ? blockedWindows : rateLimits.windows;
  const resetTimes = relevantWindows.flatMap((window) =>
    window.resetsAtMs === null ? [] : [window.resetsAtMs],
  );
  return resetTimes.length === 0 ? null : Math.max(...resetTimes);
}

function isRateLimitsEvent(
  row: FailedTurnEventRow,
): row is RateLimitsEventRow {
  return row.type === "provider/rateLimits/updated";
}

function isRateLimitError(row: FailedTurnEventRow): row is ProviderErrorEventRow {
  return (
    row.type === "provider/error" &&
    row.data.errorInfo?.category === "rate-limit"
  );
}

function belongsToFailedTurn(
  row: FailedTurnEventRow,
  candidate: ExperimentalFailedTurnCandidate,
): boolean {
  return (
    row.seq <= candidate.completedSeq &&
    row.scope.kind === "turn" &&
    row.scope.turnId === candidate.turnId
  );
}

export function classifyProviderRetry(
  inspection: ExperimentalFailedTurnInspection,
): ProviderRetryInspection {
  const failedTurn = inspection.candidate;
  if (failedTurn === null) {
    return emptyInspection(inspection.reason);
  }

  const observedRateLimits = failedTurn.events
    .filter(isRateLimitsEvent)
    .filter(
      (row) => row.data.rateLimits.providerId === failedTurn.providerId,
    )
    .at(-1)?.data.rateLimits;
  const failedTurnRateLimits = failedTurn.events
    .filter(isRateLimitsEvent)
    .filter(
      (row) =>
        row.seq <= failedTurn.completedSeq &&
        row.data.rateLimits.providerId === failedTurn.providerId,
    )
    .at(-1)?.data.rateLimits;
  const blockedRateLimits =
    failedTurnRateLimits?.status === "blocked"
      ? failedTurnRateLimits
      : observedRateLimits?.status === "blocked"
        ? observedRateLimits
        : null;
  if (blockedRateLimits === null) {
    return emptyInspection(
      "no-rate-limit-state",
      observedRateLimits ?? null,
    );
  }

  const rateLimitErrors = failedTurn.events.filter(
    (row): row is ProviderErrorEventRow =>
      belongsToFailedTurn(row, failedTurn) && isRateLimitError(row),
  );
  if (!rateLimitErrors.some((row) => row.data.willRetry !== true)) {
    return emptyInspection(
      rateLimitErrors.length > 0
        ? "provider-will-retry"
        : "no-terminal-rate-limit-error",
      observedRateLimits ?? blockedRateLimits,
    );
  }

  const currentBlockedRateLimits =
    observedRateLimits?.status === "blocked"
      ? observedRateLimits
      : blockedRateLimits;
  const resetsAtMs = recoveryResetAtMs(currentBlockedRateLimits);
  const automatic =
    currentBlockedRateLimits.kind === "subscription-window" &&
    resetsAtMs !== null;
  return {
    candidate: {
      automatic,
      failedRequestId: failedTurn.failedRequestId,
      rateLimits: currentBlockedRateLimits,
      resetsAtMs,
      turnId: failedTurn.turnId,
    },
    hostId: failedTurn.hostId,
    rateLimits: observedRateLimits ?? blockedRateLimits,
    reason: automatic ? "eligible" : "manual-only",
    scopeKey: `${failedTurn.hostId}:${failedTurn.providerId}`,
  };
}

export async function inspectProviderRetry(
  bb: BbPluginApi,
  threadId: string,
): Promise<ProviderRetryInspection> {
  return classifyProviderRetry(
    await bb.experimental_failedTurnContinuation.inspect({ threadId }),
  );
}
