import type { ThreadEvent } from "@bb/domain";
import { TEXT_DELTA_FLUSH_MS } from "@bb/provider-bridge-protocol/assembler";
import type {
  HostDaemonEventBatchResponse,
  HostDaemonEventEnvelope,
  HostDaemonRejectedEvent,
} from "@bb/host-daemon-contract";
import { normalizeCaughtError, runtimeErrorLogFields } from "./error-utils.js";
import type { HostDaemonLogger } from "./logger.js";
import { ServerResponseError } from "./server-client.js";

const STREAM_TICK_MS = TEXT_DELTA_FLUSH_MS;
const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

const QUEUE_DEPTH_WARN_THRESHOLD = 512;
const QUEUE_DEPTH_WARN_MIN_AGE_MS = 5_000;
const QUEUE_AGE_WARN_THRESHOLD_MS = 30_000;

export interface EventSinkInput {
  event: ThreadEvent;
  threadId: string;
}

export interface EventPostResult {
  acceptedEvents: HostDaemonEventBatchResponse["acceptedEvents"];
  rejectedEvents: HostDaemonEventBatchResponse["rejectedEvents"];
}

export interface CreateEventSinkOptions {
  isSessionOpen: () => boolean;
  logger: Pick<HostDaemonLogger, "debug" | "error" | "warn">;
  now?: () => number;
  postEvents: (events: HostDaemonEventEnvelope[]) => Promise<EventPostResult>;
}

export interface EventSink {
  emit(event: EventSinkInput): void;
  flush(): Promise<void>;
  listUndeliveredThreadIds(): string[];
  dispose(): Promise<void>;
}

interface QueuedEvent {
  envelope: HostDaemonEventEnvelope;
  immediate: boolean;
  queuedAt: number;
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

function shouldFlushThreadEventImmediately(event: ThreadEvent): boolean {
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
  const now = options.now ?? (() => Date.now());
  const queue: QueuedEvent[] = [];
  const inFlightByThreadId = new Map<string, number>();
  const inFlightPosts = new Set<Promise<void>>();
  let lastPostAt: number | null = null;
  let lastBatchStartedAt = Number.NEGATIVE_INFINITY;
  let tickTimer: ReturnType<typeof setTimeout> | null = null;
  let tickDueAt = Number.POSITIVE_INFINITY;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let failedPosts = 0;
  let disposed = false;
  let backedUpSinceMs: number | null = null;
  let backpressureLogged = false;
  let retryDelayMs = INITIAL_RETRY_DELAY_MS;

  function maybeLogQueuePressure(): void {
    if (backpressureLogged || backedUpSinceMs === null) {
      return;
    }
    const queueDepth = queue.length;
    const queueAgeMs = now() - backedUpSinceMs;
    if (
      queueAgeMs < QUEUE_AGE_WARN_THRESHOLD_MS &&
      (queueDepth < QUEUE_DEPTH_WARN_THRESHOLD ||
        queueAgeMs < QUEUE_DEPTH_WARN_MIN_AGE_MS)
    ) {
      return;
    }
    backpressureLogged = true;
    options.logger.warn(
      { queueDepth, queueAgeMs },
      "Daemon event queue is backing up; delivery may be stalled",
    );
  }

  function clearTick(): void {
    if (tickTimer !== null) {
      clearTimeout(tickTimer);
      tickTimer = null;
      tickDueAt = Number.POSITIVE_INFINITY;
    }
  }

  function clearRetry(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function logFlushFailure(error: unknown): void {
    options.logger.error(
      runtimeErrorLogFields(normalizeCaughtError(error)),
      "Daemon event delivery failed",
    );
  }

  function scheduleTick(immediate: boolean): void {
    if (disposed || retryTimer !== null || queue.length === 0) {
      return;
    }
    const delayMs = immediate
      ? 0
      : Math.max(0, lastBatchStartedAt + STREAM_TICK_MS - now());
    const dueAt = now() + delayMs;
    if (tickTimer !== null) {
      if (tickDueAt <= dueAt) {
        return;
      }
      clearTick();
    }
    tickDueAt = dueAt;
    tickTimer = setTimeout(() => {
      tickTimer = null;
      tickDueAt = Number.POSITIVE_INFINITY;
      startEligibleBatch();
    }, delayMs);
  }

  function scheduleRetry(): void {
    if (disposed || retryTimer !== null || !options.isSessionOpen()) {
      return;
    }
    clearTick();
    const delayMs = Math.floor(retryDelayMs * (0.5 + Math.random() * 0.5));
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void flush().catch(logFlushFailure);
    }, delayMs);
  }

  function logPostedBatch(
    batch: readonly QueuedEvent[],
    postedAt: number,
  ): void {
    let textChars = 0;
    let oldestQueuedAt = postedAt;
    for (const { envelope, queuedAt } of batch) {
      oldestQueuedAt = Math.min(oldestQueuedAt, queuedAt);
      if (
        envelope.event.type === "item/agentMessage/delta" ||
        envelope.event.type === "item/reasoning/summaryTextDelta" ||
        envelope.event.type === "item/reasoning/textDelta" ||
        envelope.event.type === "item/plan/delta"
      ) {
        textChars += envelope.event.delta.length;
      }
    }
    options.logger.debug(
      {
        eventBatch: {
          events: batch.length,
          textChars,
          oldestQueuedMs: postedAt - oldestQueuedAt,
          sincePreviousPostMs:
            lastPostAt === null ? null : postedAt - lastPostAt,
          postMs: now() - postedAt,
          postedAt,
        },
      },
      "Posted daemon event batch",
    );
    lastPostAt = postedAt;
  }

  async function deliverBatch(batch: readonly QueuedEvent[]): Promise<number> {
    let response: EventPostResult;
    const postedAt = now();
    try {
      response = await options.postEvents(
        batch.map((queued) => queued.envelope),
      );
    } catch (error) {
      const normalized = normalizeCaughtError(error);
      if (!isPermanentPostRejection(normalized)) {
        options.logger.error(
          runtimeErrorLogFields(normalized),
          "Failed to post daemon events; keeping events queued for retry",
        );
        return 0;
      }

      const [offending] = batch;
      if (batch.length === 1 && offending !== undefined) {
        options.logger.error(
          {
            ...runtimeErrorLogFields(normalized),
            eventType: offending.envelope.event.type,
            threadId: offending.envelope.threadId,
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

    logPostedBatch(batch, postedAt);
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

  function takeEligibleBatch(): QueuedEvent[] {
    const batch: QueuedEvent[] = [];
    const waiting: QueuedEvent[] = [];
    for (const queued of queue) {
      (inFlightByThreadId.has(queued.envelope.threadId) ? waiting : batch).push(
        queued,
      );
    }
    queue.splice(0, queue.length, ...waiting);
    return batch;
  }

  function settleBatch(batch: readonly QueuedEvent[], delivered: number): void {
    for (const queued of batch) {
      const remaining =
        (inFlightByThreadId.get(queued.envelope.threadId) ?? 1) - 1;
      if (remaining === 0) {
        inFlightByThreadId.delete(queued.envelope.threadId);
      } else {
        inFlightByThreadId.set(queued.envelope.threadId, remaining);
      }
    }
    if (delivered < batch.length) {
      failedPosts += 1;
      if (!disposed) {
        queue.unshift(...batch.slice(delivered));
      }
      return;
    }
    if (queue.length === 0 && inFlightByThreadId.size === 0) {
      backedUpSinceMs = null;
      backpressureLogged = false;
      retryDelayMs = INITIAL_RETRY_DELAY_MS;
    }
  }

  function startEligibleBatch(): void {
    if (disposed || !options.isSessionOpen()) {
      return;
    }
    const batch = takeEligibleBatch();
    if (batch.length === 0) {
      return;
    }
    lastBatchStartedAt = now();
    for (const queued of batch) {
      inFlightByThreadId.set(
        queued.envelope.threadId,
        (inFlightByThreadId.get(queued.envelope.threadId) ?? 0) + 1,
      );
    }
    const failuresBefore = failedPosts;
    const post: Promise<void> = deliverBatch(batch)
      .catch((error: unknown) => {
        logFlushFailure(error);
        return 0;
      })
      .then((delivered) => {
        settleBatch(batch, delivered);
      })
      .finally(() => {
        inFlightPosts.delete(post);
        if (failedPosts !== failuresBefore) {
          scheduleRetry();
        } else {
          scheduleTick(
            queue.some(
              (queued) =>
                queued.immediate &&
                !inFlightByThreadId.has(queued.envelope.threadId),
            ),
          );
        }
      });
    inFlightPosts.add(post);
  }

  async function flush(): Promise<void> {
    clearTick();
    clearRetry();
    for (;;) {
      const failuresBefore = failedPosts;
      startEligibleBatch();
      if (inFlightPosts.size === 0) {
        return;
      }
      await Promise.all(inFlightPosts);
      if (failedPosts !== failuresBefore) {
        return;
      }
    }
  }

  return {
    emit(input): void {
      if (disposed) {
        throw new EventSinkDisposedError();
      }
      if (backedUpSinceMs === null) {
        backedUpSinceMs = now();
      }
      const immediate = shouldFlushThreadEventImmediately(input.event);
      queue.push({
        envelope: { threadId: input.threadId, event: input.event },
        immediate,
        queuedAt: now(),
      });
      maybeLogQueuePressure();
      scheduleTick(immediate);
    },
    flush,
    listUndeliveredThreadIds(): string[] {
      return [
        ...new Set([
          ...inFlightByThreadId.keys(),
          ...queue.map((queued) => queued.envelope.threadId),
        ]),
      ];
    },
    async dispose(): Promise<void> {
      disposed = true;
      clearTick();
      clearRetry();
      await Promise.all(inFlightPosts);
      queue.length = 0;
    },
  };
}
