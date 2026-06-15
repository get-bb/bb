import parcelWatcher from "@parcel/watcher";
import { calculateExponentialBackoffDelay } from "@bb/domain";
import { pathExists } from "./path-exists.js";

// Parcel's FSEvents backend reports every dropped-events variant with this
// phrase. Dropped events are recoverable: the OS kept the stream alive but
// asked us to re-scan to catch up on what it could not deliver. We must rescan
// rather than surface a watch error — see onDroppedEvents.
const FSEVENTS_DROPPED_EVENTS_RESCAN_MESSAGE = "File system must be re-scanned";

type ParcelWatcherSubscribe = typeof parcelWatcher.subscribe;
type ParcelWatcherCallback = Parameters<ParcelWatcherSubscribe>[1];
type ParcelWatcherAsyncSubscription = Awaited<
  ReturnType<ParcelWatcherSubscribe>
>;
type ParcelWatcherError = Parameters<ParcelWatcherCallback>[0];

export type ParcelWatcherEventBatch = Parameters<ParcelWatcherCallback>[1];
export type ParcelWatcherSubscribeOptions =
  Parameters<ParcelWatcherSubscribe>[2];

export interface RootSubscriptionArgs {
  rootPath: string;
  subscribeOptions?: ParcelWatcherSubscribeOptions;
  retryDelayMs: number;
  maxRetryDelayMs: number;
  /** Non-error event batch delivered by the live subscription. */
  onEvents: (events: ParcelWatcherEventBatch) => void;
  /**
   * Dropped FSEvents detected. Invoked once when the drop is observed and again
   * after the subscription is re-established, so callers can rescan both the
   * gap that was missed and anything that changed during re-subscription.
   */
  onDroppedEvents: () => void;
  /** Genuine, non-recoverable watch failure. Reported at most once until the
   * subscription successfully (re-)establishes. */
  onWatchError: (message: string) => void;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown watch error";
}

function isDroppedEventsRescanRequiredMessage(message: string): boolean {
  return message.includes(FSEVENTS_DROPPED_EVENTS_RESCAN_MESSAGE);
}

/**
 * Owns the full lifecycle of a single Parcel subscription on one root path:
 * existence gating before subscribe, startup retry, warn-once error reporting,
 * dropped-events recovery, and disposal that drains in-flight start/stop work.
 * Callers compose one (single-root watchers) or many (keyed by root path) and
 * layer their own change aggregation on top.
 */
export class RootSubscription {
  private disposed = false;
  private subscription: ParcelWatcherAsyncSubscription | null = null;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private warned = false;
  private recoveryPending = false;
  private readonly pendingStarts = new Set<Promise<void>>();
  private readonly pendingStops = new Set<Promise<void>>();

  constructor(private readonly args: RootSubscriptionArgs) {}

  start(): void {
    const pendingStart = this.startAsync().finally(() => {
      this.pendingStarts.delete(pendingStart);
    });
    this.pendingStarts.add(pendingStart);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.subscription !== null) {
      const subscription = this.subscription;
      this.subscription = null;
      this.stopSubscription(subscription);
    }
    await Promise.all([...this.pendingStarts]);
    await this.awaitPendingStops();
  }

  private async awaitPendingStops(): Promise<void> {
    while (this.pendingStops.size > 0) {
      await Promise.all([...this.pendingStops]);
    }
  }

  private stopSubscription(subscription: ParcelWatcherAsyncSubscription): void {
    const pendingStop = subscription
      .unsubscribe()
      .catch(() => {
        // Ignore unsubscribe failures during watcher teardown.
      })
      .finally(() => {
        this.pendingStops.delete(pendingStop);
      });
    this.pendingStops.add(pendingStop);
  }

  private reportWatchError(message: string): void {
    if (this.warned) {
      return;
    }
    this.warned = true;
    this.args.onWatchError(message);
  }

  private scheduleRetry(): void {
    if (
      this.disposed ||
      this.retryTimer !== null ||
      this.subscription !== null
    ) {
      return;
    }
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = null;
        this.start();
      },
      calculateExponentialBackoffDelay({
        attempt: this.retryAttempt,
        baseDelayMs: this.args.retryDelayMs,
        maxDelayMs: this.args.maxRetryDelayMs,
      }),
    );
  }

  private handleRecoverableSubscriptionFailure(): void {
    if (this.subscription !== null) {
      const subscription = this.subscription;
      this.subscription = null;
      this.stopSubscription(subscription);
    }
    this.scheduleRetry();
  }

  private async startAsync(): Promise<void> {
    if (this.disposed || this.subscription !== null) {
      return;
    }

    if (!(await pathExists(this.args.rootPath))) {
      this.reportWatchError(
        `Watched path does not exist yet: ${this.args.rootPath}`,
      );
      this.scheduleRetry();
      return;
    }
    if (this.disposed) {
      return;
    }

    try {
      let recoverableFailureObserved = false;
      let terminalFailureObserved = false;
      const subscription = await parcelWatcher.subscribe(
        this.args.rootPath,
        (error: ParcelWatcherError, events: ParcelWatcherEventBatch) => {
          if (this.disposed) {
            return;
          }
          if (error) {
            const message = toErrorMessage(error);
            if (isDroppedEventsRescanRequiredMessage(message)) {
              recoverableFailureObserved = true;
              this.recoveryPending = true;
              this.args.onDroppedEvents();
              this.handleRecoverableSubscriptionFailure();
              return;
            }
            terminalFailureObserved = true;
            this.reportWatchError(message);
            // Parcel has already cleared the callback for runtime backend
            // errors. On Linux, retrying after an inotify backend poll/read
            // error creates a fresh native backend while the failed one may
            // still hold its fd/thread state. Leave the subscription unavailable
            // until the owner recreates it or the process restarts.
            this.subscription = null;
            return;
          }
          this.args.onEvents(events);
        },
        this.args.subscribeOptions,
      );
      if (this.disposed) {
        if (!terminalFailureObserved) {
          this.stopSubscription(subscription);
        }
        return;
      }
      if (recoverableFailureObserved) {
        this.stopSubscription(subscription);
        return;
      }
      if (terminalFailureObserved) {
        return;
      }
      this.warned = false;
      this.retryAttempt = 0;
      this.subscription = subscription;
      if (this.recoveryPending) {
        this.recoveryPending = false;
        this.args.onDroppedEvents();
      }
    } catch (error) {
      if (this.disposed) {
        return;
      }
      this.reportWatchError(toErrorMessage(error));
      this.scheduleRetry();
    }
  }
}
