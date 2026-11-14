import type { ClientTurnRequestId, ThreadEvent } from "@bb/domain";
import { requireThreadEventScopeTurnId } from "@bb/domain";
import type { EventMeta } from "./event-decode.js";

export interface ThreadEventWithMetaLike {
  event: ThreadEvent;
  meta: EventMeta;
}

export interface DeliveringBusyRetry {
  requestId: ClientTurnRequestId;
  requestMeta: EventMeta;
}

export interface AcceptedClientRequest {
  deliveredByBusyRetry: DeliveringBusyRetry | null;
  meta: EventMeta;
  turnId: string;
}

export interface AcceptedClientRequestContext {
  acceptedClientRequestEvents: readonly ThreadEventWithMetaLike[];
  busyRetryGiveUpEvents: readonly ThreadEventWithMetaLike[];
  rejectedClientRequestEvents: readonly ThreadEventWithMetaLike[];
  requestedClientRequestEvents: readonly ThreadEventWithMetaLike[];
}

export const EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT: AcceptedClientRequestContext =
  {
    acceptedClientRequestEvents: [],
    busyRetryGiveUpEvents: [],
    rejectedClientRequestEvents: [],
    requestedClientRequestEvents: [],
  };

type ClientTurnRequestedEventWithMeta = {
  event: Extract<ThreadEvent, { type: "client/turn/requested" }>;
  meta: EventMeta;
};

function contextAndWindowClientRequestedEvents(
  context: AcceptedClientRequestContext,
  events: readonly ThreadEventWithMetaLike[],
): ClientTurnRequestedEventWithMeta[] {
  const requested: ClientTurnRequestedEventWithMeta[] = [];
  for (const { event, meta } of [
    ...events,
    ...context.requestedClientRequestEvents,
  ]) {
    if (event.type === "client/turn/requested") {
      requested.push({ event, meta });
    }
  }
  return requested;
}

const BUSY_REJECTION_REASON = "thread_busy";
const BUSY_RETRIES_EXHAUSTED_ERROR_CODE = "provider_busy";

function contextAndWindowRejectionEvents(
  context: AcceptedClientRequestContext,
  events: readonly ThreadEventWithMetaLike[],
): ThreadEventWithMetaLike[] {
  return [...events, ...context.rejectedClientRequestEvents].filter(
    ({ event }) => event.type === "client/turn/rejected",
  );
}

function collectBusyRejectedRequestIds(
  rejectionEvents: readonly ThreadEventWithMetaLike[],
): Set<ClientTurnRequestId> {
  const requestIds = new Set<ClientTurnRequestId>();
  for (const { event } of rejectionEvents) {
    if (
      event.type === "client/turn/rejected" &&
      event.reason === BUSY_REJECTION_REASON
    ) {
      requestIds.add(event.requestId);
    }
  }
  return requestIds;
}

function addBusyRefusedRequestsDeliveredByRetry(
  acceptedById: Map<ClientTurnRequestId, AcceptedClientRequest>,
  { context, events }: BuildAcceptedClientRequestByIdArgs,
): void {
  const busyRejectedRequestIds = collectBusyRejectedRequestIds(
    contextAndWindowRejectionEvents(context, events),
  );
  if (busyRejectedRequestIds.size === 0) {
    return;
  }
  for (const { event, meta } of contextAndWindowClientRequestedEvents(
    context,
    events,
  )) {
    if (
      event.retryOfRequestId === undefined ||
      !busyRejectedRequestIds.has(event.retryOfRequestId) ||
      acceptedById.has(event.retryOfRequestId)
    ) {
      continue;
    }
    const acceptedRetry = acceptedById.get(event.requestId);
    if (acceptedRetry !== undefined) {
      acceptedById.set(event.retryOfRequestId, {
        deliveredByBusyRetry: { requestId: event.requestId, requestMeta: meta },
        meta: acceptedRetry.meta,
        turnId: acceptedRetry.turnId,
      });
    }
  }
}

export function buildBusyRetryingClientRequestIds(
  context: AcceptedClientRequestContext,
  events: readonly ThreadEventWithMetaLike[],
  acceptedClientRequestById: ReadonlyMap<
    ClientTurnRequestId,
    AcceptedClientRequest
  >,
): ReadonlySet<ClientTurnRequestId> {
  const rejectionEvents = contextAndWindowRejectionEvents(context, events);
  if (collectBusyRejectedRequestIds(rejectionEvents).size === 0) {
    return new Set();
  }
  const originalRequestIdByRetryId = new Map<
    ClientTurnRequestId,
    ClientTurnRequestId
  >();
  for (const { event } of contextAndWindowClientRequestedEvents(
    context,
    events,
  )) {
    if (event.retryOfRequestId !== undefined) {
      originalRequestIdByRetryId.set(event.requestId, event.retryOfRequestId);
    }
  }
  const retryingOriginalRequestIds = new Set<ClientTurnRequestId>();
  let lastBusyOriginalRequestId: ClientTurnRequestId | null = null;
  const orderedEvents = [
    ...rejectionEvents,
    ...[...events, ...context.busyRetryGiveUpEvents].filter(
      ({ event }) => event.type === "system/error",
    ),
  ].sort((left, right) => left.meta.seq - right.meta.seq);
  for (const { event } of orderedEvents) {
    if (event.type === "client/turn/rejected") {
      const originalRequestId =
        originalRequestIdByRetryId.get(event.requestId) ?? event.requestId;
      if (event.reason === BUSY_REJECTION_REASON) {
        retryingOriginalRequestIds.add(originalRequestId);
        lastBusyOriginalRequestId = originalRequestId;
      } else {
        retryingOriginalRequestIds.delete(originalRequestId);
        lastBusyOriginalRequestId = null;
      }
      continue;
    }
    if (
      event.type === "system/error" &&
      event.code === BUSY_RETRIES_EXHAUSTED_ERROR_CODE &&
      lastBusyOriginalRequestId !== null
    ) {
      retryingOriginalRequestIds.delete(lastBusyOriginalRequestId);
      lastBusyOriginalRequestId = null;
    }
  }
  for (const requestId of retryingOriginalRequestIds) {
    if (acceptedClientRequestById.has(requestId)) {
      retryingOriginalRequestIds.delete(requestId);
    }
  }
  return retryingOriginalRequestIds;
}

export function buildRejectedClientRequestById(
  context: AcceptedClientRequestContext,
  events: readonly ThreadEventWithMetaLike[],
): Map<ClientTurnRequestId, EventMeta> {
  const rejectedRequestById = new Map<ClientTurnRequestId, EventMeta>();
  for (const { event, meta } of [
    ...events,
    ...context.rejectedClientRequestEvents,
  ]) {
    if (
      event.type === "client/turn/rejected" &&
      !rejectedRequestById.has(event.requestId)
    ) {
      rejectedRequestById.set(event.requestId, meta);
    }
  }
  return rejectedRequestById;
}

interface AcceptedClientRequestEvent {
  meta: EventMeta;
  requestId: ClientTurnRequestId;
  turnId: string;
}

interface AddAcceptedClientRequestEventsArgs {
  events: readonly ThreadEventWithMetaLike[];
  onAccepted: (accepted: AcceptedClientRequestEvent) => void;
}

interface BuildAcceptedClientRequestByIdArgs {
  context: AcceptedClientRequestContext;
  events: readonly ThreadEventWithMetaLike[];
}

function addAcceptedClientRequestEvents({
  events,
  onAccepted,
}: AddAcceptedClientRequestEventsArgs): void {
  for (const { event, meta } of events) {
    if (event.type !== "turn/input/accepted") {
      continue;
    }
    onAccepted({
      meta,
      requestId: event.clientRequestId,
      turnId: requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      }),
    });
  }
}

export function buildAcceptedClientRequestById({
  context,
  events,
}: BuildAcceptedClientRequestByIdArgs): Map<
  ClientTurnRequestId,
  AcceptedClientRequest
> {
  const acceptedById = new Map<ClientTurnRequestId, AcceptedClientRequest>();
  const addAccepted = (accepted: AcceptedClientRequestEvent): void => {
    if (acceptedById.has(accepted.requestId)) {
      return;
    }
    acceptedById.set(accepted.requestId, {
      deliveredByBusyRetry: null,
      meta: accepted.meta,
      turnId: accepted.turnId,
    });
  };
  addAcceptedClientRequestEvents({
    events,
    onAccepted: addAccepted,
  });
  addAcceptedClientRequestEvents({
    events: context.acceptedClientRequestEvents,
    onAccepted: addAccepted,
  });
  addBusyRefusedRequestsDeliveredByRetry(acceptedById, { context, events });
  return acceptedById;
}
