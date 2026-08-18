import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
} from "@bb/domain";
import type { HostDaemonInteractiveRequestResponse } from "@bb/host-daemon-contract";
import { normalizeCaughtError } from "./error-utils.js";

const DELIVERED_INTERACTIVE_REQUEST_TOMBSTONE_TTL_MS = 5 * 60 * 1000;

/**
 * How long a user-question interaction may sit unanswered before the daemon
 * gives up on it. The plugin interaction path defaults to the same ten
 * minutes (`bb.ui.requestInput`), so a native provider question waits no
 * longer than a plugin one. Without this, `registerAndWait` resolves only
 * when a client answers or the provider exits, so an unattended thread hangs
 * for hours and the human's replies queue behind a turn that never ends.
 */
export const USER_QUESTION_DEADLINE_MS = 10 * 60 * 1000;

export interface InteractiveResolveCommandInput {
  interactionId: string;
  providerId: string;
  providerRequestId: string;
  providerThreadId: string;
  resolution: PendingInteractionResolution;
  threadId: string;
}

export interface InteractiveRequestRegistrationFailure {
  error: Error;
  request: PendingInteractionCreate;
}

export interface InteractiveRequestRegistryOptions {
  onRegistrationFailure?: (
    failure: InteractiveRequestRegistrationFailure,
  ) => void;
  registerRequest: (
    request: PendingInteractionCreate,
  ) => Promise<HostDaemonInteractiveRequestResponse>;
  /** Invoked when a user-question request exceeds its deadline unanswered. */
  onTimeout?: (request: PendingInteractionCreate) => void;
}

export interface InterruptInteractiveThreadsArgs {
  providerId: string;
  reason: string;
  threadIds: readonly string[];
}

interface PendingInteractiveRequestEntry {
  interactionId: string | null;
  promise: Promise<PendingInteractionResolution>;
  reject: (error: Error) => void;
  resolve: (resolution: PendingInteractionResolution) => void;
  request: PendingInteractionCreate;
  /** Armed for user questions; cleared on every terminal path. */
  timeout?: ReturnType<typeof setTimeout>;
}

interface DeliveredInteractiveRequestTombstone {
  timeout: ReturnType<typeof setTimeout>;
}

export class InteractiveRequestRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "InteractiveRequestRegistryError";
  }
}

function buildInteractiveRequestKey(
  request: Pick<
    PendingInteractionCreate,
    "providerId" | "providerRequestId" | "providerThreadId" | "threadId"
  >,
): string {
  return [
    request.threadId,
    request.providerId,
    request.providerThreadId,
    request.providerRequestId,
  ].join("\0");
}

function buildDeliveredTombstoneKey(
  request: Pick<
    InteractiveResolveCommandInput,
    | "interactionId"
    | "providerId"
    | "providerRequestId"
    | "providerThreadId"
    | "threadId"
  >,
): string {
  return [
    request.interactionId,
    request.threadId,
    request.providerId,
    request.providerThreadId,
    request.providerRequestId,
  ].join("\0");
}

export class InteractiveRequestRegistry {
  private readonly deliveredTombstones = new Map<
    string,
    DeliveredInteractiveRequestTombstone
  >();
  private readonly pendingEntries = new Map<
    string,
    PendingInteractiveRequestEntry
  >();

  constructor(private readonly options: InteractiveRequestRegistryOptions) {}

  async registerAndWait(
    request: PendingInteractionCreate,
  ): Promise<PendingInteractionResolution> {
    const key = buildInteractiveRequestKey(request);
    const existing = this.pendingEntries.get(key);
    if (existing) {
      return existing.promise;
    }

    let resolveEntry: (
      resolution: PendingInteractionResolution,
    ) => void = () => {};
    let rejectEntry: (error: Error) => void = () => {};
    const promise = new Promise<PendingInteractionResolution>(
      (resolve, reject) => {
        resolveEntry = resolve;
        rejectEntry = reject;
      },
    );
    const entry: PendingInteractiveRequestEntry = {
      interactionId: null,
      promise,
      reject: (error) => rejectEntry(error),
      resolve: (resolution) => resolveEntry(resolution),
      request,
    };
    this.pendingEntries.set(key, entry);
    if (request.payload.kind === "user_question") {
      entry.timeout = setTimeout(() => {
        this.expireUserQuestionEntry(key, entry);
      }, USER_QUESTION_DEADLINE_MS);
      entry.timeout.unref();
    }

    try {
      const response = await this.options.registerRequest(request);
      if (response.outcome === "rejected") {
        this.removeEntry(key);
        entry.reject(
          new InteractiveRequestRegistryError(
            "interactive_request_rejected",
            response.reason,
          ),
        );
        return promise;
      }

      entry.interactionId = response.interactionId;
      if (response.status !== "pending" && response.status !== "resolving") {
        this.removeEntry(key);
        entry.reject(
          new Error(
            `Pending interaction ${response.interactionId} is already ${response.status}`,
          ),
        );
      }
    } catch (error) {
      this.removeEntry(key);
      const registrationError = normalizeCaughtError(error);
      this.options.onRegistrationFailure?.({
        error: registrationError,
        request,
      });
      entry.reject(registrationError);
    }

    return promise;
  }

  /**
   * Gives up on a user question no client answered within the deadline. The
   * rejection propagates to the provider bridge, which turns it into a denial
   * the model can answer in prose; `onTimeout` lets the caller tell the server
   * to drop the still-pending row so the thread is not stuck "already awaiting
   * user interaction" afterwards.
   */
  private expireUserQuestionEntry(
    key: string,
    entry: PendingInteractiveRequestEntry,
  ): void {
    if (!this.pendingEntries.has(key)) {
      return;
    }
    this.removeEntry(key);
    entry.reject(
      new InteractiveRequestRegistryError(
        "interactive_request_timeout",
        `No client answered this question within ${USER_QUESTION_DEADLINE_MS / 60_000} minutes — ask it in prose instead so the answer arrives as a message`,
      ),
    );
    this.options.onTimeout?.(entry.request);
  }

  private removeEntry(key: string): void {
    const entry = this.pendingEntries.get(key);
    if (entry?.timeout !== undefined) {
      clearTimeout(entry.timeout);
      entry.timeout = undefined;
    }
    this.pendingEntries.delete(key);
  }

  resolve(request: InteractiveResolveCommandInput): void {
    const key = buildInteractiveRequestKey(request);
    const tombstoneKey = buildDeliveredTombstoneKey(request);
    if (this.deliveredTombstones.has(tombstoneKey)) {
      return;
    }

    const entry = this.pendingEntries.get(key);
    if (!entry) {
      throw new InteractiveRequestRegistryError(
        "stale_interactive_request",
        `Interactive request ${request.interactionId} is no longer awaiting a provider response`,
      );
    }
    if (
      entry.interactionId !== null &&
      entry.interactionId !== request.interactionId
    ) {
      throw new InteractiveRequestRegistryError(
        "interactive_request_mismatch",
        `Interactive request ${request.interactionId} does not match registered interaction ${entry.interactionId}`,
      );
    }

    this.removeEntry(key);
    this.addDeliveredTombstone(tombstoneKey);
    entry.resolve(request.resolution);
  }

  interruptThreads(args: InterruptInteractiveThreadsArgs): void {
    const threadIds = new Set(args.threadIds);
    for (const [key, entry] of this.pendingEntries) {
      if (
        entry.request.providerId !== args.providerId ||
        !threadIds.has(entry.request.threadId)
      ) {
        continue;
      }

      this.removeEntry(key);
      entry.reject(new Error(args.reason));
    }
  }

  private addDeliveredTombstone(key: string): void {
    const existing = this.deliveredTombstones.get(key);
    if (existing) {
      clearTimeout(existing.timeout);
    }

    const timeout = setTimeout(() => {
      this.deliveredTombstones.delete(key);
    }, DELIVERED_INTERACTIVE_REQUEST_TOMBSTONE_TTL_MS);
    timeout.unref();
    this.deliveredTombstones.set(key, { timeout });
  }
}
