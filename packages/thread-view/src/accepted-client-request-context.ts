import type { ClientTurnRequestId, ThreadEvent } from "@bb/domain";
import { requireThreadEventScopeTurnId } from "@bb/domain";
import type { EventMeta } from "./event-decode.js";

export interface ThreadEventWithMetaLike {
  event: ThreadEvent;
  meta: EventMeta;
}

export interface AcceptedClientRequest {
  meta: EventMeta;
  turnId: string;
}

export interface AcceptedClientRequestContext {
  acceptedClientRequestEvents: readonly ThreadEventWithMetaLike[];
  rejectedClientRequestEvents: readonly ThreadEventWithMetaLike[];
}

export const EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT: AcceptedClientRequestContext =
  {
    acceptedClientRequestEvents: [],
    rejectedClientRequestEvents: [],
  };

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
  return acceptedById;
}
