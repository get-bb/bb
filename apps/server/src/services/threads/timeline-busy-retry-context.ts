import {
  listStoredClientTurnRequestRowsByKeys,
  listStoredClientTurnRetryRequestRows,
  listStoredEventRowsInSequenceRange,
  listStoredSystemErrorRowsWithCode,
  listStoredTurnInputAcceptedRowsByClientRequestIds,
  listStoredTurnRejectedRowsByClientRequestIds,
  type DbConnection,
  type StoredEventRow,
} from "@bb/db";
import type { ClientTurnRequestId, ThreadEvent } from "@bb/domain";
import { THREAD_BUSY_ERROR_CODE } from "@bb/host-daemon-contract";

export interface BusyRetryContextRows {
  acceptedRows: readonly StoredEventRow[];
  giveUpRows: readonly StoredEventRow[];
  rejectedRows: readonly StoredEventRow[];
  requestedRows: readonly StoredEventRow[];
}

export const EMPTY_BUSY_RETRY_CONTEXT_ROWS: BusyRetryContextRows = {
  acceptedRows: [],
  giveUpRows: [],
  rejectedRows: [],
  requestedRows: [],
};

const BUSY_RETRIES_EXHAUSTED_ERROR_CODE = "provider_busy";

type StoredEventDecoder = (row: StoredEventRow) => ThreadEvent;

interface WindowClientRequest {
  requestId: ClientTurnRequestId;
  retryOfRequestId: ClientTurnRequestId | undefined;
}

export function readRetryOfRequestId(
  row: StoredEventRow,
  decode: StoredEventDecoder,
): ClientTurnRequestId | null {
  if (row.type !== "client/turn/requested") {
    return null;
  }
  const event = decode(row);
  return event.type === "client/turn/requested"
    ? (event.retryOfRequestId ?? null)
    : null;
}

function mergeRowsBySequence(
  rows: readonly StoredEventRow[],
): StoredEventRow[] {
  return [...new Map(rows.map((row) => [row.sequence, row])).values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

function minSequence(rows: readonly StoredEventRow[]): number {
  return rows.reduce(
    (min, row) => Math.min(min, row.sequence),
    Number.POSITIVE_INFINITY,
  );
}

export function selectBusyRetryContextRows(
  db: DbConnection,
  args: {
    decode: StoredEventDecoder;
    maxSeq: number;
    rows: readonly StoredEventRow[];
    threadId: string;
  },
): BusyRetryContextRows {
  const { decode, maxSeq, rows, threadId } = args;
  const requestsById = new Map<ClientTurnRequestId, WindowClientRequest>();
  const acceptedRequestIds = new Set<ClientTurnRequestId>();
  const busyRejectionRows: StoredEventRow[] = [];
  for (const row of rows) {
    if (
      row.type !== "client/turn/requested" &&
      row.type !== "turn/input/accepted" &&
      row.type !== "client/turn/rejected"
    ) {
      continue;
    }
    const event = decode(row);
    if (event.type === "client/turn/requested") {
      requestsById.set(event.requestId, {
        requestId: event.requestId,
        retryOfRequestId: event.retryOfRequestId,
      });
    } else if (event.type === "turn/input/accepted") {
      acceptedRequestIds.add(event.clientRequestId);
    } else if (
      event.type === "client/turn/rejected" &&
      event.reason === THREAD_BUSY_ERROR_CODE
    ) {
      busyRejectionRows.push(row);
    }
  }
  const missingOriginalIds = new Set<ClientTurnRequestId>();
  const deliveredOriginalIds = new Set<ClientTurnRequestId>();
  for (const request of requestsById.values()) {
    if (request.retryOfRequestId === undefined) {
      continue;
    }
    if (!requestsById.has(request.retryOfRequestId)) {
      missingOriginalIds.add(request.retryOfRequestId);
    }
    if (acceptedRequestIds.has(request.requestId)) {
      deliveredOriginalIds.add(request.retryOfRequestId);
    }
  }
  const undeliveredRefusalRows = busyRejectionRows.filter((row) => {
    const event = decode(row);
    if (event.type !== "client/turn/rejected") {
      return false;
    }
    const request = requestsById.get(event.requestId);
    return (
      request !== undefined &&
      request.retryOfRequestId === undefined &&
      !acceptedRequestIds.has(request.requestId) &&
      !deliveredOriginalIds.has(request.requestId)
    );
  });
  if (missingOriginalIds.size === 0 && undeliveredRefusalRows.length === 0) {
    return EMPTY_BUSY_RETRY_CONTEXT_ROWS;
  }
  const inWindowSequences = new Set(rows.map((row) => row.sequence));
  const outsideWindow = (row: StoredEventRow): boolean =>
    row.sequence <= maxSeq && !inWindowSequences.has(row.sequence);

  const originalRows =
    missingOriginalIds.size === 0
      ? []
      : listStoredClientTurnRequestRowsByKeys(db, {
          keys: [...missingOriginalIds].map((requestId) => ({
            requestId,
            threadId,
          })),
        }).filter(outsideWindow);
  const originalRejectedRows =
    originalRows.length === 0
      ? []
      : listStoredTurnRejectedRowsByClientRequestIds(db, {
          afterSequence: minSequence(originalRows) - 1,
          clientRequestIds: [...missingOriginalIds],
          threadId,
        }).filter(outsideWindow);

  const refusedOriginalIds = undeliveredRefusalRows.flatMap((row) => {
    const event = decode(row);
    return event.type === "client/turn/rejected" ? [event.requestId] : [];
  });
  const allRetryRows =
    refusedOriginalIds.length === 0
      ? []
      : listStoredClientTurnRetryRequestRows(db, {
          afterSequence: minSequence(undeliveredRefusalRows),
          retryOfRequestIds: refusedOriginalIds,
          threadId,
        }).filter((row) => row.sequence <= maxSeq);
  const retryRows = allRetryRows.filter(outsideWindow);
  const retryRequestIds = allRetryRows.flatMap((row) => {
    const event = decode(row);
    return event.type === "client/turn/requested" ? [event.requestId] : [];
  });
  const retryAcceptedRows =
    retryRequestIds.length === 0
      ? []
      : listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
          afterSequence: minSequence(allRetryRows),
          clientRequestIds: retryRequestIds,
          threadId,
        }).filter(outsideWindow);
  const retryRejectedRows =
    retryRequestIds.length === 0
      ? []
      : listStoredTurnRejectedRowsByClientRequestIds(db, {
          afterSequence: minSequence(allRetryRows),
          clientRequestIds: retryRequestIds,
          threadId,
        }).filter(outsideWindow);

  const giveUpRows =
    undeliveredRefusalRows.length === 0
      ? []
      : listStoredSystemErrorRowsWithCode(db, {
          afterSequence: minSequence(undeliveredRefusalRows),
          code: BUSY_RETRIES_EXHAUSTED_ERROR_CODE,
          threadId,
        }).filter(outsideWindow);
  const giveUpRefusalRows = giveUpRows.flatMap((giveUp) =>
    listStoredEventRowsInSequenceRange(db, {
      afterSequence: giveUp.sequence - 2,
      limit: 1,
      maxInlineOutputChars: null,
      threadId,
      throughSequence: giveUp.sequence - 1,
    }).filter(
      (row) => row.type === "client/turn/rejected" && outsideWindow(row),
    ),
  );

  return {
    acceptedRows: retryAcceptedRows,
    giveUpRows,
    rejectedRows: mergeRowsBySequence([
      ...originalRejectedRows,
      ...retryRejectedRows,
      ...giveUpRefusalRows,
    ]),
    requestedRows: [...originalRows, ...retryRows],
  };
}
