import type { BbPluginApi } from "@get-bb/plugin-sdk";

type ThreadEventRows = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>
>;
type ThreadEventRow = ThreadEventRows[number];
type TurnRequestEventRow = Extract<
  ThreadEventRow,
  { type: "client/turn/requested" }
>;
type RateLimitsEventRow = Extract<
  ThreadEventRow,
  { type: "provider/rateLimits/updated" }
>;
type ProviderErrorEventRow = Extract<
  ThreadEventRow,
  { type: "provider/error" }
>;

export type ProviderRateLimitState = RateLimitsEventRow["data"]["rateLimits"];

type FailedTurnInspectionReason =
  | "no-failed-turn"
  | "input-not-accepted"
  | "superseded"
  | "execution-unavailable";

export type ProviderRetryReason =
  | FailedTurnInspectionReason
  | "eligible"
  | "manual-only"
  | "no-rate-limit-state"
  | "no-terminal-rate-limit-error"
  | "provider-will-retry";

export interface ProviderRetryExecution {
  model: string;
  permissionMode: "accept-edits" | "auto" | "full";
  reasoningLevel: TurnRequestEventRow["data"]["execution"]["reasoningLevel"];
  serviceTier: TurnRequestEventRow["data"]["execution"]["serviceTier"];
}

export interface ProviderRetryCandidate {
  automatic: boolean;
  execution: ProviderRetryExecution;
  failedRequestId: TurnRequestEventRow["data"]["requestId"];
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

interface FailedTurnCandidate {
  completedSeq: number;
  events: ThreadEventRow[];
  execution: ProviderRetryExecution;
  failedRequestId: TurnRequestEventRow["data"]["requestId"];
  turnId: string;
}

type FailedTurnInspection =
  | { candidate: FailedTurnCandidate; reason: "eligible" }
  | {
      candidate: null;
      reason: FailedTurnInspectionReason;
    };

const EVENT_PAGE_SIZE = 500;

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

function isRateLimitsEvent(row: ThreadEventRow): row is RateLimitsEventRow {
  return row.type === "provider/rateLimits/updated";
}

function isRateLimitError(row: ThreadEventRow): row is ProviderErrorEventRow {
  return (
    row.type === "provider/error" &&
    row.data.errorInfo?.category === "rate-limit"
  );
}

function belongsToTurn(row: ThreadEventRow, turnId: string): boolean {
  return row.scope.kind === "turn" && row.scope.turnId === turnId;
}

function currentExecution(
  request: TurnRequestEventRow,
): ProviderRetryExecution | null {
  const execution = request.data.execution;
  if (
    execution.permissionMode !== "accept-edits" &&
    execution.permissionMode !== "auto" &&
    execution.permissionMode !== "full"
  ) {
    return null;
  }
  return {
    model: execution.model,
    permissionMode: execution.permissionMode,
    reasoningLevel: execution.reasoningLevel,
    serviceTier: execution.serviceTier,
  };
}

function inspectFailedTurn(events: ThreadEventRows): FailedTurnInspection {
  const requests = events.filter(
    (row): row is TurnRequestEventRow => row.type === "client/turn/requested",
  );
  const latestRequest = requests.at(-1);
  if (latestRequest === undefined) {
    return { candidate: null, reason: "input-not-accepted" };
  }

  const completedAcceptedTurns = requests.flatMap((request) => {
    const accepted = events.find(
      (row) =>
        row.seq > request.seq &&
        row.type === "turn/input/accepted" &&
        row.data.clientRequestId === request.data.requestId &&
        row.scope.kind === "turn",
    );
    if (accepted === undefined || accepted.scope.kind !== "turn") return [];
    const turnId = accepted.scope.turnId;
    const completed = events
      .filter(
        (row) =>
          row.seq > accepted.seq &&
          row.type === "turn/completed" &&
          belongsToTurn(row, turnId),
      )
      .at(-1);
    return completed === undefined ? [] : [{ accepted, completed, request }];
  });
  const latestCompleted = completedAcceptedTurns
    .sort((left, right) => left.completed.seq - right.completed.seq)
    .at(-1);
  if (latestCompleted === undefined) {
    return { candidate: null, reason: "input-not-accepted" };
  }
  const { completed, request } = latestCompleted;
  if (request.seq !== latestRequest.seq) {
    return { candidate: null, reason: "superseded" };
  }

  const manuallyStopped = events.some(
    (row) =>
      row.seq > request.seq &&
      row.type === "system/thread/interrupted" &&
      row.data.reason === "manual-stop",
  );
  if (manuallyStopped) {
    return { candidate: null, reason: "superseded" };
  }

  if (
    completed.type !== "turn/completed" ||
    completed.data.status !== "failed" ||
    completed.scope.kind !== "turn"
  ) {
    return { candidate: null, reason: "no-failed-turn" };
  }
  const turnId = completed.scope.turnId;

  const execution = currentExecution(request);
  if (execution === null) {
    return { candidate: null, reason: "execution-unavailable" };
  }

  return {
    candidate: {
      completedSeq: completed.seq,
      events: events.filter((row) => row.seq >= request.seq),
      execution,
      failedRequestId: request.data.requestId,
      turnId,
    },
    reason: "eligible",
  };
}

/*
 * Keep failure classification plugin-local. The server event API supplies
 * facts; this plugin decides which provider failures are recoverable.
 */
export function classifyProviderRetry(args: {
  events: ThreadEventRows;
  hostId: string;
  providerId: string;
}): ProviderRetryInspection {
  const observedRateLimits = args.events
    .filter(isRateLimitsEvent)
    .filter((row) => row.data.rateLimits.providerId === args.providerId)
    .at(-1)?.data.rateLimits;
  const inspection = inspectFailedTurn(args.events);
  const failedTurn = inspection.candidate;
  if (failedTurn === null) {
    return emptyInspection(inspection.reason, observedRateLimits ?? null);
  }

  const failedTurnRateLimits = failedTurn.events
    .filter(isRateLimitsEvent)
    .filter(
      (row) =>
        row.seq <= failedTurn.completedSeq &&
        row.data.rateLimits.providerId === args.providerId,
    )
    .at(-1)?.data.rateLimits;
  const blockedRateLimits =
    failedTurnRateLimits?.status === "blocked"
      ? failedTurnRateLimits
      : observedRateLimits?.status === "blocked"
        ? observedRateLimits
        : null;
  if (blockedRateLimits === null) {
    return emptyInspection("no-rate-limit-state", observedRateLimits ?? null);
  }

  const rateLimitErrors = failedTurn.events.filter(
    (row): row is ProviderErrorEventRow =>
      row.seq <= failedTurn.completedSeq &&
      belongsToTurn(row, failedTurn.turnId) &&
      isRateLimitError(row),
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
      execution: failedTurn.execution,
      failedRequestId: failedTurn.failedRequestId,
      rateLimits: currentBlockedRateLimits,
      resetsAtMs,
      turnId: failedTurn.turnId,
    },
    hostId: args.hostId,
    rateLimits: observedRateLimits ?? blockedRateLimits,
    reason: automatic ? "eligible" : "manual-only",
    scopeKey: `${args.hostId}:${args.providerId}`,
  };
}

async function listThreadEvents(
  bb: BbPluginApi,
  threadId: string,
): Promise<ThreadEventRows> {
  const events: ThreadEventRow[] = [];
  let afterSeq: string | undefined;
  while (true) {
    const page = await bb.sdk.threads.events.list({
      threadId,
      ...(afterSeq === undefined ? {} : { afterSeq }),
      limit: String(EVENT_PAGE_SIZE),
    });
    events.push(...page);
    if (page.length < EVENT_PAGE_SIZE) return events;
    afterSeq = String(page.at(-1)?.seq);
  }
}

export async function inspectProviderRetry(
  bb: BbPluginApi,
  threadId: string,
): Promise<ProviderRetryInspection> {
  const [thread, events] = await Promise.all([
    bb.sdk.threads.get({ threadId }),
    listThreadEvents(bb, threadId),
  ]);
  if (thread.environmentId === null) {
    return emptyInspection("execution-unavailable");
  }
  const environment = await bb.sdk.environments.get({
    environmentId: thread.environmentId,
  });
  return classifyProviderRetry({
    events,
    hostId: environment.hostId,
    providerId: thread.providerId,
  });
}
