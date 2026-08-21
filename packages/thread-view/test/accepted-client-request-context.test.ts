import { describe, expect, it } from "vitest";
import { turnScope } from "@bb/domain";
import {
  buildAcceptedClientRequestById,
  type AcceptedClientRequestContext,
  type ThreadEventWithMetaLike,
} from "../src/accepted-client-request-context.js";

interface InputAcceptedEventArgs {
  clientRequestId: string;
  createdAt: number;
  eventId: string;
  sequence: number;
  turnId: string;
}

function inputAcceptedEvent({
  clientRequestId,
  createdAt,
  eventId,
  sequence,
  turnId,
}: InputAcceptedEventArgs): ThreadEventWithMetaLike {
  return {
    event: {
      type: "turn/input/accepted",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope(turnId),
      clientRequestId,
    },
    meta: {
      createdAt,
      id: eventId,
      seq: sequence,
    },
  };
}

describe("accepted client request context", () => {
  it("keeps the first accepted event for duplicate accepted inputs", () => {
    const context: AcceptedClientRequestContext = {
      acceptedClientRequestEvents: [],
      rejectedClientRequestEvents: [],
    };

    const acceptedRequests = buildAcceptedClientRequestById({
      context,
      events: [
        inputAcceptedEvent({
          clientRequestId: "creq_1234567890",
          createdAt: 100,
          eventId: "event-1",
          sequence: 1,
          turnId: "turn-1",
        }),
        inputAcceptedEvent({
          clientRequestId: "creq_1234567890",
          createdAt: 200,
          eventId: "event-2",
          sequence: 2,
          turnId: "turn-2",
        }),
      ],
    });

    expect(acceptedRequests.get("creq_1234567890")).toMatchObject({
      meta: {
        createdAt: 100,
      },
      turnId: "turn-1",
    });
  });

  it("dedupes current-window and context accepted events with current-window precedence", () => {
    const context: AcceptedClientRequestContext = {
      acceptedClientRequestEvents: [
        inputAcceptedEvent({
          clientRequestId: "creq_1234567890",
          createdAt: 200,
          eventId: "event-2",
          sequence: 2,
          turnId: "turn-2",
        }),
      ],
      rejectedClientRequestEvents: [],
    };

    const acceptedRequests = buildAcceptedClientRequestById({
      context,
      events: [
        inputAcceptedEvent({
          clientRequestId: "creq_1234567890",
          createdAt: 100,
          eventId: "event-1",
          sequence: 1,
          turnId: "turn-1",
        }),
      ],
    });

    expect(acceptedRequests.size).toBe(1);
    expect(acceptedRequests.get("creq_1234567890")).toMatchObject({
      meta: {
        createdAt: 100,
      },
      turnId: "turn-1",
    });
  });
});
