import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
} from "@bb/domain";
import type {
  HostDaemonInteractiveRequestKey,
  HostDaemonInteractiveRequestResponse,
} from "@bb/host-daemon-contract";
import { normalizeCaughtError } from "./error-utils.js";

const DELIVERED_INTERACTIVE_REQUEST_TOMBSTONE_TTL_MS = 5 * 60 * 1000;

export interface InteractiveResolveCommandInput {
  interactionId: string;
  providerId: string;
  providerRequestId: string;
  providerThreadId: string;
  resolution: PendingInteractionResolution;
  threadId: string;
}

interface InteractiveRequestRegistrationFailure {
  error: Error;
  request: PendingInteractionCreate;
}

interface InteractiveRequestRegistryOptions {
  onRegistrationFailure?: (
    failure: InteractiveRequestRegistrationFailure,
  ) => void;
  onRequestWithdrawn: (request: PendingInteractionCreate) => void;
  registerRequest: (
    request: PendingInteractionCreate,
  ) => Promise<HostDaemonInteractiveRequestResponse>;
}

interface InterruptInteractiveThreadsArgs {
  providerId: string;
  reason: string;
  threadIds: readonly string[];
}

interface PendingInteractiveRequestEntry {
  interactionId: string | null;
  promise: Promise<PendingInteractionResolution>;
  registered: Promise<boolean>;
  reject: (error: Error) => void;
  resolve: (resolution: PendingInteractionResolution) => void;
  request: PendingInteractionCreate;
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

function buildWithdrawnError(): InteractiveRequestRegistryError {
  return new InteractiveRequestRegistryError(
    "interactive_request_withdrawn",
    "The provider withdrew this interactive request",
  );
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

  registerAndWait(
    request: PendingInteractionCreate,
    signal: AbortSignal,
  ): Promise<PendingInteractionResolution> {
    const key = buildInteractiveRequestKey(request);
    const existing = this.pendingEntries.get(key);
    if (existing) {
      return existing.promise;
    }

    if (signal.aborted) {
      return Promise.reject(buildWithdrawnError());
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
    promise.catch(() => undefined);
    const entry: PendingInteractiveRequestEntry = {
      interactionId: null,
      promise,
      registered: Promise.resolve(false),
      reject: (error) => rejectEntry(error),
      resolve: (resolution) => resolveEntry(resolution),
      request,
    };
    this.pendingEntries.set(key, entry);
    entry.registered = this.register(key, entry);
    const onAbort = (): void => this.withdraw(key, entry);
    signal.addEventListener("abort", onAbort, { once: true });
    void promise
      .catch(() => undefined)
      .finally(() => signal.removeEventListener("abort", onAbort));
    return promise;
  }

  private async register(
    key: string,
    entry: PendingInteractiveRequestEntry,
  ): Promise<boolean> {
    try {
      const response = await this.options.registerRequest(entry.request);
      if (this.pendingEntries.get(key) === entry) {
        this.applyRegistrationResponse(key, entry, response);
      }
      return (
        response.outcome !== "rejected" &&
        (response.status === "pending" || response.status === "resolving")
      );
    } catch (error) {
      if (this.pendingEntries.get(key) === entry) {
        this.pendingEntries.delete(key);
      }
      const registrationError = normalizeCaughtError(error);
      this.options.onRegistrationFailure?.({
        error: registrationError,
        request: entry.request,
      });
      entry.reject(registrationError);
      return false;
    }
  }

  private withdraw(key: string, entry: PendingInteractiveRequestEntry): void {
    if (this.pendingEntries.get(key) !== entry) {
      return;
    }
    this.pendingEntries.delete(key);
    entry.reject(buildWithdrawnError());
    void entry.registered.then((registered) => {
      if (registered) {
        this.options.onRequestWithdrawn(entry.request);
      }
    });
  }

  private applyRegistrationResponse(
    key: string,
    entry: PendingInteractiveRequestEntry,
    response: HostDaemonInteractiveRequestResponse,
  ): void {
    if (response.outcome === "rejected") {
      this.pendingEntries.delete(key);
      entry.reject(
        new InteractiveRequestRegistryError(
          "interactive_request_rejected",
          response.reason,
        ),
      );
      return;
    }
    entry.interactionId = response.interactionId;
    if (response.status !== "pending" && response.status !== "resolving") {
      this.pendingEntries.delete(key);
      entry.reject(
        new Error(
          `Pending interaction ${response.interactionId} is already ${response.status}`,
        ),
      );
    }
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

    this.pendingEntries.delete(key);
    this.addDeliveredTombstone(tombstoneKey);
    entry.resolve(request.resolution);
  }

  listOpenRequests(): HostDaemonInteractiveRequestKey[] {
    return [...this.pendingEntries.values()].map((entry) => ({
      threadId: entry.request.threadId,
      providerId: entry.request.providerId,
      providerThreadId: entry.request.providerThreadId,
      providerRequestId: entry.request.providerRequestId,
    }));
  }

  endRequests(
    requests: readonly HostDaemonInteractiveRequestKey[],
    reason: string,
  ): void {
    for (const request of requests) {
      const key = buildInteractiveRequestKey(request);
      const entry = this.pendingEntries.get(key);
      if (!entry) continue;
      this.pendingEntries.delete(key);
      entry.reject(
        new InteractiveRequestRegistryError(
          "interactive_request_ended",
          reason,
        ),
      );
    }
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

      this.pendingEntries.delete(key);
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
