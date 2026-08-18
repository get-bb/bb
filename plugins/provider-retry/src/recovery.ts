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
type TurnCompletedEventRow = Extract<
  ThreadEventRow,
  { type: "turn/completed" }
>;
type TurnInputAcceptedEventRow = Extract<
  ThreadEventRow,
  { type: "turn/input/accepted" }
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
const RATE_LIMIT_PAGE_SIZE = 100;
const PROVIDER_RETRY_EVENT_TYPES = [
  "client/turn/requested",
  "provider/error",
  "provider/rateLimits/updated",
  "system/thread/interrupted",
  "turn/completed",
  "turn/input/accepted",
] as const satisfies readonly [
  ThreadEventRow["type"],
  ...ThreadEventRow["type"][],
];
const REQUEST_EVENT_TYPES = [
  "client/turn/requested",
] as const satisfies readonly [
  ThreadEventRow["type"],
  ...ThreadEventRow["type"][],
];
const RATE_LIMIT_EVENT_TYPES = [
  "provider/rateLimits/updated",
] as const satisfies readonly [
  ThreadEventRow["type"],
  ...ThreadEventRow["type"][],
];

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
  const requests: TurnRequestEventRow[] = [];
  const acceptedByRequestId = new Map<
    TurnInputAcceptedEventRow["data"]["clientRequestId"],
    TurnInputAcceptedEventRow
  >();
  const completedByTurnId = new Map<string, TurnCompletedEventRow>();
  for (const row of events) {
    if (row.type === "client/turn/requested") {
      requests.push(row);
      continue;
    }
    if (row.type === "turn/input/accepted" && row.scope.kind === "turn") {
      if (!acceptedByRequestId.has(row.data.clientRequestId)) {
        acceptedByRequestId.set(row.data.clientRequestId, row);
      }
      continue;
    }
    if (row.type === "turn/completed" && row.scope.kind === "turn") {
      completedByTurnId.set(row.scope.turnId, row);
    }
  }

  const latestRequest = requests.at(-1);
  if (latestRequest === undefined) {
    return { candidate: null, reason: "input-not-accepted" };
  }

  let latestCompleted:
    | {
        completed: TurnCompletedEventRow;
        request: TurnRequestEventRow;
      }
    | undefined;
  for (const request of requests) {
    const accepted = acceptedByRequestId.get(request.data.requestId);
    if (
      accepted === undefined ||
      accepted.seq <= request.seq ||
      accepted.scope.kind !== "turn"
    ) {
      continue;
    }
    const completed = completedByTurnId.get(accepted.scope.turnId);
    if (completed === undefined || completed.seq <= accepted.seq) continue;
    if (
      latestCompleted === undefined ||
      completed.seq > latestCompleted.completed.seq
    ) {
      latestCompleted = { completed, request };
    }
  }
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

async function findLatestRequestEvent(
  bb: BbPluginApi,
  threadId: string,
): Promise<TurnRequestEventRow | undefined> {
  const rows = await bb.sdk.threads.events.list({
    threadId,
    limit: "1",
    order: "desc",
    types: REQUEST_EVENT_TYPES,
  });
  return rows.find(
    (row): row is TurnRequestEventRow => row.type === "client/turn/requested",
  );
}

async function findLatestProviderRateLimitsEvent(
  bb: BbPluginApi,
  threadId: string,
  providerId: string,
): Promise<RateLimitsEventRow | undefined> {
  let beforeSeq: string | undefined;
  while (true) {
    const page = await bb.sdk.threads.events.list({
      threadId,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      limit: String(RATE_LIMIT_PAGE_SIZE),
      order: "desc",
      types: RATE_LIMIT_EVENT_TYPES,
    });
    const match = page.find(
      (row): row is RateLimitsEventRow =>
        isRateLimitsEvent(row) && row.data.rateLimits.providerId === providerId,
    );
    if (match !== undefined) return match;
    if (page.length < RATE_LIMIT_PAGE_SIZE) return undefined;
    const oldestRow = page.at(-1);
    if (oldestRow === undefined) return undefined;
    beforeSeq = String(oldestRow.seq);
  }
}

async function listRequestWindowEvents(
  bb: BbPluginApi,
  threadId: string,
  request: TurnRequestEventRow,
): Promise<ThreadEventRow[]> {
  const events: ThreadEventRow[] = [request];
  let afterSeq = String(request.seq);
  while (true) {
    const page = await bb.sdk.threads.events.list({
      threadId,
      afterSeq,
      limit: String(EVENT_PAGE_SIZE),
      order: "asc",
      types: PROVIDER_RETRY_EVENT_TYPES,
    });
    events.push(...page);
    if (page.length < EVENT_PAGE_SIZE) return events;
    const newestRow = page.at(-1);
    if (newestRow === undefined) return events;
    afterSeq = String(newestRow.seq);
  }
}

async function listThreadEvents(
  bb: BbPluginApi,
  threadId: string,
  providerId: string,
): Promise<ThreadEventRows> {
  const [request, observedRateLimits] = await Promise.all([
    findLatestRequestEvent(bb, threadId),
    findLatestProviderRateLimitsEvent(bb, threadId, providerId),
  ]);
  if (request === undefined) {
    return observedRateLimits === undefined ? [] : [observedRateLimits];
  }

  const events = await listRequestWindowEvents(bb, threadId, request);
  if (
    observedRateLimits !== undefined &&
    !events.some((row) => row.seq === observedRateLimits.seq)
  ) {
    events.push(observedRateLimits);
    events.sort((left, right) => left.seq - right.seq);
  }
  return events;
}

export async function inspectProviderRetry(
  bb: BbPluginApi,
  threadId: string,
): Promise<ProviderRetryInspection> {
  const thread = await bb.sdk.threads.get({ threadId });
  if (thread.environmentId === null) {
    return emptyInspection("execution-unavailable");
  }
  const [environment, events] = await Promise.all([
    bb.sdk.environments.get({
      environmentId: thread.environmentId,
    }),
    listThreadEvents(bb, threadId, thread.providerId),
  ]);
  return classifyProviderRetry({
    events,
    hostId: environment.hostId,
    providerId: thread.providerId,
  });
}
