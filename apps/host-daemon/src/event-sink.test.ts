import { threadScope, turnScope } from "@bb/domain";
import { createDeferredPromise } from "@bb/test-helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEventSink,
  type CreateEventSinkOptions,
  type EventPostResult,
  type EventSink,
} from "./event-sink.js";
import { ServerResponseError } from "./server-client.js";

function permanentRejection(bodyMessage: string): ServerResponseError {
  return new ServerResponseError({
    action: "post events",
    bodyMessage,
    code: "invalid_request",
    retryable: false,
    status: 409,
    statusText: "Conflict",
  });
}

function createLogger(): CreateEventSinkOptions["logger"] {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
}

function acceptingPostEvents() {
  return vi.fn<CreateEventSinkOptions["postEvents"]>(async (events) => ({
    acceptedEvents: events.map((event, eventIndex) => ({
      eventIndex,
      sequence: eventIndex + 1,
      threadId: event.threadId,
    })),
    rejectedEvents: [],
  }));
}

function systemErrorEvent(threadId: string) {
  return {
    type: "system/error",
    threadId,
    scope: threadScope(),
    message: "boom",
  } as const;
}

describe("event sink", () => {
  it("drains successfully skipped diffs without requiring allocated sequences", async () => {
    const postEvents = vi.fn<CreateEventSinkOptions["postEvents"]>(
      async () => ({
        acceptedEvents: [],
        rejectedEvents: [],
      }),
    );
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents,
    });
    sink.emit({
      threadId: "thr_1",
      event: {
        type: "turn/diff/updated",
        threadId: "thr_1",
        providerThreadId: "provider-1",
        scope: turnScope("turn-1"),
        diff: "discarded snapshot",
      },
    });
    await sink.flush();
    await sink.flush();
    expect(postEvents).toHaveBeenCalledTimes(1);
    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    await sink.flush();
    expect(postEvents).toHaveBeenCalledTimes(2);
    expect(postEvents).toHaveBeenLastCalledWith([
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
    ]);
  });

  it("holds events while the session is closed, reports their threads, and delivers them once it reopens", async () => {
    let sessionOpen = false;
    const postEvents = acceptingPostEvents();
    const sink = createEventSink({
      isSessionOpen: () => sessionOpen,
      logger: createLogger(),
      postEvents,
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    sink.emit({ threadId: "thr_2", event: systemErrorEvent("thr_2") });
    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    await sink.flush();
    expect(postEvents).not.toHaveBeenCalled();
    expect(sink.listUndeliveredThreadIds()).toEqual(["thr_1", "thr_2"]);

    sessionOpen = true;
    await sink.flush();

    expect(postEvents).toHaveBeenCalledTimes(1);
    expect(postEvents).toHaveBeenCalledWith([
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
      { threadId: "thr_2", event: systemErrorEvent("thr_2") },
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
    ]);
    expect(sink.listUndeliveredThreadIds()).toEqual([]);
  });

  it("keeps events queued after a post failure and redelivers them on the next flush", async () => {
    const postEvents = vi
      .fn<CreateEventSinkOptions["postEvents"]>()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockImplementation(async (events) => ({
        acceptedEvents: events.map((event, eventIndex) => ({
          eventIndex,
          sequence: eventIndex + 1,
          threadId: event.threadId,
        })),
        rejectedEvents: [],
      }));
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents,
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    await expect(sink.flush()).resolves.toBeUndefined();

    await sink.flush();

    expect(postEvents).toHaveBeenCalledTimes(2);
    expect(postEvents).toHaveBeenLastCalledWith([
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
    ]);
  });

  it("drops rejected events with a warning without throwing", async () => {
    const logger = createLogger();
    const postEvents = vi.fn<CreateEventSinkOptions["postEvents"]>(
      async () => ({
        acceptedEvents: [],
        rejectedEvents: [
          {
            eventIndex: 0,
            reason: "thread_not_owned_by_host",
            threadId: "thr_1",
          },
        ],
      }),
    );
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger,
      postEvents,
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    await expect(sink.flush()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);

    await sink.flush();
    expect(postEvents).toHaveBeenCalledTimes(1);
  });

  it("warns once when a large queue remains undelivered", () => {
    const logger = createLogger();
    let now = 0;
    const sink = createEventSink({
      isSessionOpen: () => false,
      logger,
      now: () => now,
      postEvents: acceptingPostEvents(),
    });

    for (let index = 0; index < 511; index += 1) {
      sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    }
    expect(logger.warn).not.toHaveBeenCalled();

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    expect(logger.warn).not.toHaveBeenCalled();

    now = 5_000;
    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ queueAgeMs: 5_000, queueDepth: 513 }),
      expect.any(String),
    );
  });

  it("warns when even a small queue is stalled for thirty seconds", () => {
    const logger = createLogger();
    let now = 0;
    const sink = createEventSink({
      isSessionOpen: () => false,
      logger,
      now: () => now,
      postEvents: acceptingPostEvents(),
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    now = 30_000;
    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ queueAgeMs: 30_000, queueDepth: 2 }),
      expect.any(String),
    );
  });

  it("drops a permanently rejected event instead of retrying it forever", async () => {
    const logger = createLogger();
    const postEvents = vi.fn<CreateEventSinkOptions["postEvents"]>(
      async (events) => {
        if (events.some((event) => event.threadId === "thr_poison")) {
          throw permanentRejection(
            "Cannot append provider/unhandled for turn auto-compact-1 before turn/started is stored",
          );
        }
        return {
          acceptedEvents: events.map((event, eventIndex) => ({
            eventIndex,
            sequence: eventIndex + 1,
            threadId: event.threadId,
          })),
          rejectedEvents: [],
        };
      },
    );
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger,
      postEvents,
    });

    sink.emit({
      threadId: "thr_poison",
      event: systemErrorEvent("thr_poison"),
    });
    await sink.flush();

    postEvents.mockClear();
    await sink.flush();
    expect(postEvents).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("delivers events queued behind a permanently rejected event", async () => {
    const delivered: string[] = [];
    const postEvents = vi.fn<CreateEventSinkOptions["postEvents"]>(
      async (events) => {
        if (events.some((event) => event.threadId === "thr_poison")) {
          throw permanentRejection(
            "Cannot append provider/unhandled for turn auto-compact-1 before turn/started is stored",
          );
        }
        delivered.push(...events.map((event) => event.threadId));
        return {
          acceptedEvents: events.map((event, eventIndex) => ({
            eventIndex,
            sequence: eventIndex + 1,
            threadId: event.threadId,
          })),
          rejectedEvents: [],
        };
      },
    );
    let sessionOpen = false;
    const sink = createEventSink({
      isSessionOpen: () => sessionOpen,
      logger: createLogger(),
      postEvents,
    });

    sink.emit({
      threadId: "thr_poison",
      event: systemErrorEvent("thr_poison"),
    });
    sink.emit({ threadId: "thr_a", event: systemErrorEvent("thr_a") });
    sink.emit({ threadId: "thr_b", event: systemErrorEvent("thr_b") });
    sink.emit({ threadId: "thr_a", event: systemErrorEvent("thr_a") });

    await sink.flush();
    expect(postEvents).not.toHaveBeenCalled();

    sessionOpen = true;
    await sink.flush();

    expect(delivered).toEqual(["thr_a", "thr_b", "thr_a"]);

    postEvents.mockClear();
    await sink.flush();
    expect(postEvents).not.toHaveBeenCalled();
  });

  it("keeps retrying a batch that fails for a retryable reason", async () => {
    const postEvents = vi
      .fn<CreateEventSinkOptions["postEvents"]>()
      .mockRejectedValueOnce(
        new ServerResponseError({
          action: "post events",
          bodyMessage: "database is locked",
          code: "internal_error",
          retryable: true,
          status: 500,
          statusText: "Internal Server Error",
        }),
      )
      .mockImplementation(async (events) => ({
        acceptedEvents: events.map((event, eventIndex) => ({
          eventIndex,
          sequence: eventIndex + 1,
          threadId: event.threadId,
        })),
        rejectedEvents: [],
      }));
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents,
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    await sink.flush();
    await sink.flush();

    expect(postEvents).toHaveBeenCalledTimes(2);
    expect(postEvents).toHaveBeenLastCalledWith([
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
    ]);
  });

  it("keeps events queued when the session, not the batch, is rejected", async () => {
    const postEvents = vi
      .fn<CreateEventSinkOptions["postEvents"]>()
      .mockRejectedValueOnce(
        new ServerResponseError({
          action: "post events",
          bodyMessage: "Session is not active",
          code: "inactive_session",
          retryable: false,
          status: 401,
          statusText: "Unauthorized",
        }),
      )
      .mockImplementation(async (events) => ({
        acceptedEvents: events.map((event, eventIndex) => ({
          eventIndex,
          sequence: eventIndex + 1,
          threadId: event.threadId,
        })),
        rejectedEvents: [],
      }));
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents,
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    sink.emit({ threadId: "thr_2", event: systemErrorEvent("thr_2") });
    await sink.flush();

    expect(postEvents).toHaveBeenCalledTimes(1);

    await sink.flush();
    expect(postEvents).toHaveBeenLastCalledWith([
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
      { threadId: "thr_2", event: systemErrorEvent("thr_2") },
    ]);
  });

  it("never throws from emit regardless of how many events queue up", () => {
    const sink = createEventSink({
      isSessionOpen: () => false,
      logger: createLogger(),
      postEvents: acceptingPostEvents(),
    });

    expect(() => {
      for (let index = 0; index < 1000; index += 1) {
        sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
      }
    }).not.toThrow();
  });
});

describe("event sink automatic retries", () => {
  let postEvents: ReturnType<typeof acceptingPostEvents>;
  let sink: EventSink;
  let sessionOpen: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    sessionOpen = true;
    postEvents = acceptingPostEvents();
    sink = createEventSink({
      isSessionOpen: () => sessionOpen,
      logger: createLogger(),
      postEvents,
    });
    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("delivers a completion queued during a failed upload without new activity", async () => {
    const request = createDeferredPromise<EventPostResult>();
    postEvents.mockImplementationOnce(() => request.promise);
    const flush = sink.flush();
    const completion = {
      type: "turn/completed",
      threadId: "thr_1",
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
      status: "completed",
    } as const;
    sink.emit({ threadId: "thr_1", event: completion });
    request.reject(new TypeError("fetch failed"));
    await flush;

    await vi.advanceTimersByTimeAsync(1000);
    expect(postEvents).toHaveBeenLastCalledWith([
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
      { threadId: "thr_1", event: completion },
    ]);
    expect(postEvents).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("backs off repeated failures up to a capped interval despite urgent arrivals", async () => {
    postEvents.mockRejectedValue(new Error("offline"));
    await sink.flush();
    let attempts = 1;
    for (const delay of [750, 1500, 3000, 6000, 12000, 22500, 22500]) {
      sink.emit({ threadId: "thr_2", event: systemErrorEvent("thr_2") });
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(postEvents).toHaveBeenCalledTimes(attempts);
      await vi.advanceTimersByTimeAsync(1);
      expect(postEvents).toHaveBeenCalledTimes(++attempts);
    }
  });

  it("stops retrying while disconnected and resumes on a session-open flush", async () => {
    postEvents.mockRejectedValueOnce(new Error("offline"));
    await sink.flush();
    sessionOpen = false;
    await vi.advanceTimersByTimeAsync(60000);
    expect(postEvents).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    sessionOpen = true;
    await sink.flush();
    expect(postEvents).toHaveBeenCalledTimes(2);
  });

  it("cancels a scheduled retry when disposed", async () => {
    postEvents.mockRejectedValue(new Error("offline"));
    await sink.flush();
    await sink.dispose();
    await vi.advanceTimersByTimeAsync(60000);
    expect(postEvents).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resets backoff after the queue drains successfully", async () => {
    postEvents
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"));
    await sink.flush();
    await vi.advanceTimersByTimeAsync(2250);
    expect(postEvents).toHaveBeenCalledTimes(3);
    postEvents.mockRejectedValueOnce(new Error("offline again"));
    sink.emit({ threadId: "thr_2", event: systemErrorEvent("thr_2") });
    await sink.flush();
    await vi.advanceTimersByTimeAsync(750);
    expect(postEvents).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps retries serialized when more events and flushes arrive during an upload", async () => {
    const request = createDeferredPromise<EventPostResult>();
    postEvents
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => request.promise);
    await sink.flush();
    await vi.advanceTimersByTimeAsync(750);
    sink.emit({ threadId: "thr_2", event: systemErrorEvent("thr_2") });
    const flush = sink.flush();
    await vi.advanceTimersByTimeAsync(60000);
    expect(postEvents).toHaveBeenCalledTimes(2);
    request.resolve({ acceptedEvents: [], rejectedEvents: [] });
    await flush;
    expect(postEvents).toHaveBeenCalledTimes(3);
    expect(postEvents).toHaveBeenLastCalledWith([
      { threadId: "thr_2", event: systemErrorEvent("thr_2") },
    ]);
  });
});
