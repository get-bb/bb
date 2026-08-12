import type { ThreadEvent } from "@bb/domain";
import type {
  HostDaemonEventBatchResponse,
  HostDaemonEventEnvelope,
  HostDaemonRejectedEvent,
} from "@bb/host-daemon-contract";
import { normalizeCaughtError, runtimeErrorLogFields } from "./error-utils.js";
import type { HostDaemonLogger } from "./logger.js";
import { ServerResponseError } from "./server-client.js";

const DEFAULT_DEBOUNCE_MS = 100;

// Tripwires for noticing that delivery has stalled and the in-memory queue is
// growing. These only warn — they never drop, fault, or bound the queue. If
// they fire in practice, that is the signal to add real backpressure.
const QUEUE_DEPTH_WARN_THRESHOLD = 512;
const QUEUE_AGE_WARN_THRESHOLD_MS = 30_000;

export interface EventSinkInput {
  event: ThreadEvent;
  threadId: string;
}

export interface EventPostResult {
  acceptedEvents: HostDaemonEventBatchResponse["acceptedEvents"];
  rejectedEvents: HostDaemonEventBatchResponse["rejectedEvents"];
  kind: "accepted";
}

export interface CreateEventSinkOptions {
  isSessionOpen: () => boolean;
  logger: Pick<HostDaemonLogger, "debug" | "error" | "warn">;
  postEvents: (events: HostDaemonEventEnvelope[]) => Promise<EventPostResult>;
}

export interface EventSink {
  emit(event: EventSinkInput): void;
  flush(): Promise<void>;
  flushRequired(): Promise<void>;
  dispose(): Promise<void>;
}

interface RejectedEventSummary {
  eventIndex: number;
  reason: HostDaemonRejectedEvent["reason"];
  threadId: string;
}

export class EventSinkDisposedError extends Error {
  constructor() {
    super("Cannot emit to disposed event sink");
    this.name = "EventSinkDisposedError";
  }
}

function isWaitingForApprovalItemEvent(event: ThreadEvent): boolean {
  if (event.type !== "item/started" && event.type !== "item/completed") {
    return false;
  }

  if (
    event.item.type !== "commandExecution" &&
    event.item.type !== "fileChange"
  ) {
    return false;
  }

  return event.item.approvalStatus === "waiting_for_approval";
}

export function shouldFlushThreadEventImmediately(event: ThreadEvent): boolean {
  if (event.type === "turn/started" || event.type === "item/completed") {
    return true;
  }

  if (
    event.type === "turn/completed" ||
    event.type === "system/error" ||
    event.type === "system/thread/interrupted"
  ) {
    return true;
  }

  if (event.type === "provider/error") {
    return event.willRetry !== true;
  }

  return isWaitingForApprovalItemEvent(event);
}

// True when the server refused these events for what they *are*, so reposting
// them unchanged can only produce the same refusal: a malformed batch (400) or
// one carrying an event the store will never accept (409). Both answer with
// `invalid_request`.
//
// The code check is what keeps this narrow. `/session/events` also fails
// non-retryably with `unauthorized` and `inactive_session` (401), and those say
// nothing about the events themselves — the daemon must keep them queued for
// the session it is about to reopen, not discard them.
function isPermanentPostRejection(error: Error): boolean {
  return (
    error instanceof ServerResponseError &&
    !error.retryable &&
    error.code === "invalid_request"
  );
}

function summarizeRejectedEvents(
  events: readonly HostDaemonRejectedEvent[],
): RejectedEventSummary[] {
  return events.map((event) => ({
    eventIndex: event.eventIndex,
    reason: event.reason,
    threadId: event.threadId,
  }));
}

export function createEventSink(options: CreateEventSinkOptions): EventSink {
  const queue: HostDaemonEventEnvelope[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<void> | null = null;
  let disposed = false;
  // When the queue first became non-empty in the current backed-up episode, or
  // null while the queue is empty. Used only for the debug tripwire below.
  let backedUpSinceMs: number | null = null;
  let backpressureLogged = false;

  function maybeLogQueuePressure(): void {
    if (backpressureLogged || backedUpSinceMs === null) {
      return;
    }
    const queueDepth = queue.length;
    const queueAgeMs = Date.now() - backedUpSinceMs;
    if (
      queueDepth < QUEUE_DEPTH_WARN_THRESHOLD &&
      queueAgeMs < QUEUE_AGE_WARN_THRESHOLD_MS
    ) {
      return;
    }
    backpressureLogged = true;
    // A stalled queue means every thread on this host is silently falling
    // behind in the UI, so this needs to be visible at the default log level.
    options.logger.warn(
      { queueDepth, queueAgeMs },
      "Daemon event queue is backing up; delivery may be stalled",
    );
  }

  function clearScheduledFlush(): void {
    if (flushTimer === null) {
      return;
    }
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  function scheduleFlush(delayMs: number): void {
    if (disposed || flushPromise !== null) {
      return;
    }
    if (flushTimer !== null) {
      if (delayMs > 0) {
        return;
      }
      clearScheduledFlush();
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush().catch((error) => {
        options.logger.error(
          runtimeErrorLogFields(normalizeCaughtError(error)),
          "Daemon event delivery failed",
        );
      });
    }, delayMs);
  }

  // Delivers `batch` and reports how many of its leading events no longer need
  // sending — either the server took them or they were undeliverable by
  // construction and were dropped. A count below `batch.length` means delivery
  // stopped early and the remainder must be retried by a later flush.
  //
  // The server marks a rejection non-retryable when reposting the identical
  // payload can only produce the identical rejection (a turn-scoped event whose
  // turn/started it never saw, for instance, which it answers with 409). Such a
  // batch must never be retried as-is: the queue is host-wide, so one
  // undeliverable event at its head would stall every thread on the machine
  // until the daemon restarted. Bisect instead — the server appends a batch in
  // a single transaction and rolls the whole thing back when it refuses one
  // event, so nothing was committed and re-posting the halves cannot duplicate.
  // That isolates the offending events in O(log n) posts and lets the healthy
  // ones through.
  async function deliverBatch(
    batch: readonly HostDaemonEventEnvelope[],
  ): Promise<number> {
    let response: EventPostResult;
    try {
      response = await options.postEvents([...batch]);
    } catch (error) {
      const normalized = normalizeCaughtError(error);
      if (!isPermanentPostRejection(normalized)) {
        options.logger.error(
          runtimeErrorLogFields(normalized),
          "Failed to post daemon events; will retry on the next flush",
        );
        return 0;
      }

      const [offending] = batch;
      if (batch.length === 1 && offending !== undefined) {
        options.logger.error(
          {
            ...runtimeErrorLogFields(normalized),
            eventType: offending.event.type,
            threadId: offending.threadId,
          },
          "Dropped a daemon event the server will never accept",
        );
        return 1;
      }

      const midpoint = Math.floor(batch.length / 2);
      const deliveredFromFirstHalf = await deliverBatch(
        batch.slice(0, midpoint),
      );
      if (deliveredFromFirstHalf < midpoint) {
        return deliveredFromFirstHalf;
      }
      return midpoint + (await deliverBatch(batch.slice(midpoint)));
    }

    if (response.rejectedEvents.length > 0) {
      options.logger.warn(
        {
          rejectedEvents: summarizeRejectedEvents(response.rejectedEvents),
        },
        "Server rejected daemon events",
      );
    }
    return batch.length;
  }

  // Posts queued events while the session is open. Events that cannot be
  // delivered right now — because the session is closed or the post failed —
  // stay queued and are retried by the next flush (the next emit, or the
  // reconnect that reopens the session). The queue lives only in memory, so a
  // daemon crash drops anything still pending; that is an accepted tradeoff.
  async function drainQueue(): Promise<void> {
    while (queue.length > 0 && !disposed && options.isSessionOpen()) {
      const batch = queue.slice();
      const delivered = await deliverBatch(batch);
      queue.splice(0, delivered);
      if (queue.length === 0) {
        backedUpSinceMs = null;
        backpressureLogged = false;
      }
      if (delivered < batch.length) {
        return;
      }
    }
  }

  async function flush(): Promise<void> {
    clearScheduledFlush();
    if (flushPromise !== null) {
      await flushPromise;
      return;
    }

    flushPromise = drainQueue();
    try {
      await flushPromise;
    } finally {
      flushPromise = null;
    }
  }

  return {
    emit(input): void {
      if (disposed) {
        throw new EventSinkDisposedError();
      }
      if (backedUpSinceMs === null) {
        backedUpSinceMs = Date.now();
      }
      queue.push({
        threadId: input.threadId,
        event: input.event,
      });
      maybeLogQueuePressure();
      scheduleFlush(
        shouldFlushThreadEventImmediately(input.event) ? 0 : DEFAULT_DEBOUNCE_MS,
      );
    },
    flush,
    flushRequired: flush,
    async dispose(): Promise<void> {
      disposed = true;
      clearScheduledFlush();
      if (flushPromise !== null) {
        await flushPromise.catch(() => undefined);
      }
      queue.length = 0;
    },
  };
}
