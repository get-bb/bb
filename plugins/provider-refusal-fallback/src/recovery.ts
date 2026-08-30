import type { BbPluginApi } from "@get-bb/plugin-sdk";

type ThreadEventRows = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>
>;
type ThreadEventRow = ThreadEventRows[number];
type TurnRequestEventRow = Extract<
  ThreadEventRow,
  { type: "client/turn/requested" }
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

export type RefusalFallbackReason =
  | "eligible"
  | "environment-unavailable"
  | "input-not-accepted"
  | "no-refusal"
  | "superseded"
  | "turn-not-finished";

export interface RefusalFallbackCandidate {
  detail: string;
  refusedModel: string;
  turnId: string;
}

export type RefusalFallbackInspection =
  | {
      candidate: RefusalFallbackCandidate;
      environmentId: string;
      providerId: string;
      reason: "eligible";
    }
  | {
      candidate: null;
      environmentId: null;
      providerId: null;
      reason: Exclude<RefusalFallbackReason, "eligible">;
    };

const EVENT_PAGE_SIZE = 500;
const REFUSAL_EVENT_TYPES = [
  "client/turn/requested",
  "provider/error",
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

function emptyInspection(
  reason: Exclude<RefusalFallbackReason, "eligible">,
): RefusalFallbackInspection {
  return {
    candidate: null,
    environmentId: null,
    providerId: null,
    reason,
  };
}

function isPolicyRefusal(row: ThreadEventRow): row is ProviderErrorEventRow {
  return (
    row.type === "provider/error" && row.data.errorInfo?.category === "policy"
  );
}

function belongsToTurn(row: ThreadEventRow, turnId: string): boolean {
  return row.scope.kind === "turn" && row.scope.turnId === turnId;
}

interface FinishedTurn {
  completedSeq: number;
  refusedModel: string;
  turnId: string;
}

type FinishedTurnInspection =
  | { turn: FinishedTurn; reason: "eligible" }
  | {
      turn: null;
      reason: Exclude<
        RefusalFallbackReason,
        "eligible" | "environment-unavailable" | "no-refusal"
      >;
    };

function inspectFinishedTurn(events: ThreadEventRows): FinishedTurnInspection {
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
    return { turn: null, reason: "input-not-accepted" };
  }

  let latest:
    | { completed: TurnCompletedEventRow; request: TurnRequestEventRow }
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
    if (latest === undefined || completed.seq > latest.completed.seq) {
      latest = { completed, request };
    }
  }
  if (latest === undefined) {
    return { turn: null, reason: "turn-not-finished" };
  }

  const { completed, request } = latest;
  if (request.seq !== latestRequest.seq) {
    return { turn: null, reason: "superseded" };
  }
  if (completed.scope.kind !== "turn") {
    return { turn: null, reason: "turn-not-finished" };
  }

  const manuallyStopped = events.some(
    (row) =>
      row.seq > request.seq &&
      row.type === "system/thread/interrupted" &&
      row.data.reason === "manual-stop",
  );
  if (manuallyStopped) {
    return { turn: null, reason: "superseded" };
  }

  return {
    turn: {
      completedSeq: completed.seq,
      refusedModel: request.data.execution.model,
      turnId: completed.scope.turnId,
    },
    reason: "eligible",
  };
}

export function classifyRefusalFallback(args: {
  environmentId: string | null;
  events: ThreadEventRows;
  providerId: string;
}): RefusalFallbackInspection {
  const inspection = inspectFinishedTurn(args.events);
  if (inspection.turn === null) {
    return emptyInspection(inspection.reason);
  }
  const turn = inspection.turn;

  const refusal = args.events
    .filter(
      (row): row is ProviderErrorEventRow =>
        row.seq <= turn.completedSeq &&
        belongsToTurn(row, turn.turnId) &&
        isPolicyRefusal(row),
    )
    .at(-1);
  if (refusal === undefined) {
    return emptyInspection("no-refusal");
  }
  if (args.environmentId === null) {
    return emptyInspection("environment-unavailable");
  }

  return {
    candidate: {
      detail: refusal.data.detail ?? refusal.data.message,
      refusedModel: turn.refusedModel,
      turnId: turn.turnId,
    },
    environmentId: args.environmentId,
    providerId: args.providerId,
    reason: "eligible",
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
      types: REFUSAL_EVENT_TYPES,
    });
    events.push(...page);
    if (page.length < EVENT_PAGE_SIZE) return events;
    const newestRow = page.at(-1);
    if (newestRow === undefined) return events;
    afterSeq = String(newestRow.seq);
  }
}

export async function inspectRefusalFallback(
  bb: BbPluginApi,
  threadId: string,
): Promise<RefusalFallbackInspection> {
  const thread = await bb.sdk.threads.get({ threadId });
  const request = await findLatestRequestEvent(bb, threadId);
  if (request === undefined) {
    return emptyInspection("input-not-accepted");
  }
  const events = await listRequestWindowEvents(bb, threadId, request);
  return classifyRefusalFallback({
    environmentId: thread.environmentId,
    events,
    providerId: thread.providerId,
  });
}
