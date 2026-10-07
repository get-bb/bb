import type {
  BuildEventProjectionMessagesOptions,
  EventProjectionUserMessage,
} from "./event-projection-types.js";
import type { AcceptedClientRequestContext } from "./accepted-client-request-context.js";
import {
  buildAcceptedClientRequestById,
  buildRejectedClientRequestById,
} from "./accepted-client-request-context.js";
import {
  getOrderedThreadEvents,
  type ThreadEventWithMeta,
} from "./group-event-projection-turns.js";
import {
  parsePendingSteersFromClientRequest,
  parseRejectedUsersFromClientRequest,
} from "./user-message-parsing.js";

export function buildPendingSteerMessagesFromEvents(
  acceptedClientRequestContext: AcceptedClientRequestContext,
  events: ThreadEventWithMeta[],
  options: BuildEventProjectionMessagesOptions,
): EventProjectionUserMessage[] {
  const orderedEvents = getOrderedThreadEvents(events);
  const acceptedClientRequestById = buildAcceptedClientRequestById({
    context: acceptedClientRequestContext,
    events: orderedEvents,
  });
  const rejectedClientRequestById = buildRejectedClientRequestById(
    acceptedClientRequestContext,
    orderedEvents,
  );
  const inWindowRejectedClientRequestIds = new Set(
    orderedEvents.flatMap(({ event }) =>
      event.type === "client/turn/rejected" ? [event.requestId] : [],
    ),
  );
  const legacyRejectedRequestMetaById = new Map<
    string,
    ThreadEventWithMeta["meta"]
  >();
  const unresolvedSteerRequestIds = new Set<string>();
  const unresolvedSteerRequestOrder: string[] = [];
  let explicitRejectionNeedsCompanionError = false;
  for (const { event, meta } of orderedEvents) {
    if (
      event.type === "client/turn/requested" &&
      (event.target.kind === "auto" || event.target.kind === "steer") &&
      event.target.expectedTurnId !== null
    ) {
      unresolvedSteerRequestIds.add(event.requestId);
      unresolvedSteerRequestOrder.push(event.requestId);
      explicitRejectionNeedsCompanionError = false;
      continue;
    }
    if (event.type === "turn/input/accepted") {
      unresolvedSteerRequestIds.delete(event.clientRequestId);
      explicitRejectionNeedsCompanionError = false;
      continue;
    }
    if (event.type === "client/turn/rejected") {
      unresolvedSteerRequestIds.delete(event.requestId);
      explicitRejectionNeedsCompanionError = true;
      continue;
    }
    if (
      event.type === "system/error" &&
      event.code === "thread_command_failed"
    ) {
      if (explicitRejectionNeedsCompanionError) {
        explicitRejectionNeedsCompanionError = false;
        continue;
      }
      let requestId = unresolvedSteerRequestOrder.pop();
      while (requestId && !unresolvedSteerRequestIds.delete(requestId)) {
        requestId = unresolvedSteerRequestOrder.pop();
      }
      if (requestId) legacyRejectedRequestMetaById.set(requestId, meta);
      continue;
    }
    explicitRejectionNeedsCompanionError = false;
  }
  const pendingSteerMessages: EventProjectionUserMessage[] = [];

  for (const { event, meta } of orderedEvents) {
    if (
      event.type === "client/turn/requested" &&
      inWindowRejectedClientRequestIds.has(event.requestId)
    ) {
      continue;
    }
    const acceptedClientRequest =
      event.type === "client/turn/requested"
        ? acceptedClientRequestById.get(event.requestId)
        : undefined;
    const legacyRejectedMeta =
      event.type === "client/turn/requested"
        ? legacyRejectedRequestMetaById.get(event.requestId)
        : undefined;
    const rejectedMeta =
      event.type === "client/turn/requested"
        ? rejectedClientRequestById.get(event.requestId)
        : undefined;
    if (
      event.type === "client/turn/requested" &&
      acceptedClientRequest === undefined &&
      rejectedMeta
    ) {
      pendingSteerMessages.push(
        ...parseRejectedUsersFromClientRequest({
          decoded: event,
          requestMeta: meta,
          meta: rejectedMeta,
          options,
        }),
      );
      continue;
    }
    if (
      event.type === "client/turn/requested" &&
      acceptedClientRequest === undefined &&
      legacyRejectedMeta
    ) {
      pendingSteerMessages.push(
        ...parseRejectedUsersFromClientRequest({
          decoded: event,
          requestMeta: meta,
          meta: legacyRejectedMeta,
          options,
        }),
      );
      continue;
    }
    const pendingSteers = parsePendingSteersFromClientRequest({
      acceptedClientRequest,
      decoded: event,
      meta,
      options,
    });
    if (pendingSteers.length === 0) {
      continue;
    }
    pendingSteerMessages.push(...pendingSteers);
  }

  return pendingSteerMessages;
}
