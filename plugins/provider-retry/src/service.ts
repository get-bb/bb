import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ProviderRetryView } from "./contract.js";
import {
  inspectProviderRetry,
  type ProviderRetryCandidate as RecoveryCandidate,
  type ProviderRetryInspection as RecoveryStatus,
} from "./recovery.js";

export const RESET_BUFFER_MS = 15_000;
export const RESET_JITTER_MS = 30_000;
export const RELEASE_PACE_MS = 1_000;
export const DEFAULT_MAXIMUM_WAIT_MS = 6 * 60 * 60 * 1_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const REALTIME_CHANNEL = "provider-retry";

interface AttemptedWindow {
  resetsAtMs: number;
  scopeKey: string;
}

export interface ProviderRetrySources {
  now(): number;
  random(): number;
}

export interface ManualProviderRetryResult {
  failedRequestId: string;
}

interface WaitingEntry {
  candidate: RecoveryCandidate;
  firstObservedAtMs: number;
  hostId: string;
  providerId: string;
  releasing: boolean;
  retryAtMs: number | null;
  scopeKey: string;
  threadId: string;
}

interface ScopeQueue {
  releasing: boolean;
  threadIds: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isHostUnavailableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "host_unavailable"
  );
}

function isAutomaticCandidate(
  candidate: RecoveryCandidate | null,
): candidate is RecoveryCandidate & { automatic: true; resetsAtMs: number } {
  return candidate?.automatic === true && candidate.resetsAtMs !== null;
}

function toView(entry: WaitingEntry): ProviderRetryView | null {
  if (entry.releasing) return null;
  return {
    threadId: entry.threadId,
    providerId: entry.providerId,
    retryAtMs: entry.retryAtMs,
  };
}

export class ProviderRetryService {
  private readonly attemptedWindows = new Map<string, AttemptedWindow>();
  private readonly entries = new Map<string, WaitingEntry>();
  private readonly scopes = new Map<string, ScopeQueue>();
  private readonly threadLocks = new Map<string, Promise<void>>();
  private disposed = false;

  private async withThreadLock<T>(
    threadId: string,
    operation: () => T | Promise<T>,
  ): Promise<T> {
    const previous = this.threadLocks.get(threadId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    const lock = next.then(
      () => undefined,
      () => undefined,
    );
    this.threadLocks.set(threadId, lock);
    try {
      return await next;
    } finally {
      if (this.threadLocks.get(threadId) === lock) {
        this.threadLocks.delete(threadId);
      }
    }
  }

  constructor(
    private readonly bb: BbPluginApi,
    private readonly sources: ProviderRetrySources = {
      now: () => Date.now(),
      random: () => Math.random(),
    },
    private maximumWaitMs: number | null = DEFAULT_MAXIMUM_WAIT_MS,
  ) {
    this.validateMaximumWait(maximumWaitMs);
  }

  setMaximumWaitMs(maximumWaitMs: number | null): void {
    this.validateMaximumWait(maximumWaitMs);
    if (this.maximumWaitMs === maximumWaitMs) return;
    this.maximumWaitMs = maximumWaitMs;

    for (const entry of [...this.entries.values()]) {
      const resetsAtMs = entry.candidate.resetsAtMs;
      if (
        !entry.releasing &&
        (resetsAtMs === null ||
          !this.withinMaximumWait(resetsAtMs, entry.firstObservedAtMs))
      ) {
        this.remove(entry.threadId);
      }
    }
  }

  private validateMaximumWait(maximumWaitMs: number | null): void {
    if (
      maximumWaitMs !== null &&
      (!Number.isFinite(maximumWaitMs) || maximumWaitMs < 0)
    ) {
      throw new Error("Maximum provider retry wait must be nonnegative");
    }
  }

  private withinMaximumWait(
    resetsAtMs: number,
    firstObservedAtMs: number,
  ): boolean {
    return (
      this.maximumWaitMs === null ||
      resetsAtMs - firstObservedAtMs <= this.maximumWaitMs
    );
  }

  private retryAt(resetsAtMs: number): number {
    return (
      resetsAtMs +
      RESET_BUFFER_MS +
      Math.floor(this.sources.random() * RESET_JITTER_MS)
    );
  }

  list(): ProviderRetryView[] {
    return [...this.entries.values()]
      .flatMap((entry) => {
        const view = toView(entry);
        return view === null ? [] : [view];
      })
      .sort((a, b) => a.threadId.localeCompare(b.threadId));
  }

  status(threadId: string): ProviderRetryView | null {
    const entry = this.entries.get(threadId);
    return entry === undefined ? null : toView(entry);
  }

  async cancel(threadId: string): Promise<boolean> {
    return this.withThreadLock(threadId, () => {
      const entry = this.entries.get(threadId);
      if (entry === undefined || entry.releasing) return false;
      this.remove(threadId);
      return true;
    });
  }

  async retry(threadId: string): Promise<ManualProviderRetryResult> {
    return this.withThreadLock(threadId, async () => {
      if (this.disposed) {
        throw new Error("Provider retry is shutting down");
      }
      const status = await inspectProviderRetry(this.bb, threadId);
      const candidate = status.candidate;
      if (candidate === null) {
        throw new Error(
          `Thread ${threadId} cannot be continued after a provider rate limit (${status.reason}).`,
        );
      }

      const existing = this.entries.get(threadId);
      if (existing !== undefined) {
        existing.releasing = true;
        this.publish(threadId);
      }
      try {
        await this.continueCandidate(threadId, candidate);
        if (candidate.resetsAtMs !== null) {
          this.attemptedWindows.set(threadId, {
            resetsAtMs: candidate.resetsAtMs,
            scopeKey: status.scopeKey,
          });
        }
        this.remove(threadId);
        return {
          failedRequestId: candidate.failedRequestId,
        };
      } catch (error) {
        if (existing !== undefined && this.entries.get(threadId) === existing) {
          existing.releasing = false;
          this.publish(threadId);
        }
        throw error;
      }
    });
  }

  async reconcile(threadId: string): Promise<ProviderRetryView | null> {
    return this.withThreadLock(threadId, () => this.reconcileDirect(threadId));
  }

  async reconcileTracked(threadId: string): Promise<ProviderRetryView | null> {
    return this.withThreadLock(threadId, () =>
      this.entries.has(threadId) ? this.reconcileDirect(threadId) : null,
    );
  }

  private async reconcileDirect(
    threadId: string,
  ): Promise<ProviderRetryView | null> {
    if (this.disposed) return null;
    const status = await inspectProviderRetry(this.bb, threadId);
    if (this.disposed) return null;
    const existing = this.entries.get(threadId);
    if (existing?.releasing) return null;

    if (status.candidate === null || !isAutomaticCandidate(status.candidate)) {
      this.remove(threadId);
      return null;
    }
    const candidate = status.candidate;
    const resetsAtMs = candidate.resetsAtMs;

    const attemptedWindow = this.attemptedWindows.get(threadId);
    if (
      attemptedWindow?.scopeKey === status.scopeKey &&
      attemptedWindow.resetsAtMs === resetsAtMs
    ) {
      this.remove(threadId);
      return null;
    }

    const sameRequest =
      existing?.candidate.failedRequestId === candidate.failedRequestId;
    const firstObservedAtMs = sameRequest
      ? existing.firstObservedAtMs
      : this.sources.now();
    if (!this.withinMaximumWait(resetsAtMs, firstObservedAtMs)) {
      this.remove(threadId);
      return null;
    }

    const sameReset =
      sameRequest && existing.candidate.resetsAtMs === resetsAtMs;
    let retryAtMs: number | null;
    if (status.rateLimits?.status === "allowed") {
      retryAtMs = this.sources.now();
    } else if (sameReset && existing.retryAtMs === null) {
      retryAtMs = null;
    } else if (sameReset) {
      retryAtMs = existing.retryAtMs;
    } else {
      retryAtMs = this.retryAt(resetsAtMs);
    }

    this.upsert({
      candidate,
      firstObservedAtMs,
      hostId: status.hostId,
      providerId: candidate.rateLimits.providerId,
      releasing: false,
      retryAtMs,
      scopeKey: status.scopeKey,
      threadId,
    });
    return this.status(threadId);
  }

  async supersede(threadId: string): Promise<void> {
    await this.withThreadLock(threadId, () => {
      this.remove(threadId);
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.withThreadLock(threadId, () => {
      this.remove(threadId);
      this.attemptedWindows.delete(threadId);
    });
  }

  hostChanged(hostId: string): void {
    const scopeKeys = new Set<string>();
    for (const entry of this.entries.values()) {
      if (
        entry.hostId === hostId &&
        !entry.releasing &&
        entry.retryAtMs === null
      ) {
        entry.retryAtMs = this.sources.now();
        scopeKeys.add(entry.scopeKey);
        this.publish(entry.threadId);
      }
    }
    for (const scopeKey of scopeKeys) this.schedule(scopeKey);
  }

  private upsert(entry: WaitingEntry): void {
    const previousScopeKey = this.entries.get(entry.threadId)?.scopeKey;
    if (previousScopeKey && previousScopeKey !== entry.scopeKey) {
      this.removeFromScope(entry.threadId, previousScopeKey);
    }
    this.entries.set(entry.threadId, entry);
    this.ensureScope(entry.scopeKey).threadIds.add(entry.threadId);
    this.publish(entry.threadId);
    this.schedule(entry.scopeKey);
  }

  private ensureScope(scopeKey: string): ScopeQueue {
    const existing = this.scopes.get(scopeKey);
    if (existing) return existing;
    const created: ScopeQueue = {
      releasing: false,
      threadIds: new Set(),
      timer: null,
    };
    this.scopes.set(scopeKey, created);
    return created;
  }

  private remove(threadId: string): void {
    const entry = this.entries.get(threadId);
    if (!entry) return;
    this.entries.delete(threadId);
    this.removeFromScope(threadId, entry.scopeKey);
    this.publish(threadId);
  }

  private removeFromScope(threadId: string, scopeKey: string): void {
    const scope = this.scopes.get(scopeKey);
    if (!scope) return;
    scope.threadIds.delete(threadId);
    if (scope.threadIds.size === 0) {
      if (scope.timer !== null) clearTimeout(scope.timer);
      this.scopes.delete(scopeKey);
      return;
    }
    this.schedule(scopeKey);
  }

  private publish(threadId: string): void {
    this.bb.realtime.publish(REALTIME_CHANNEL, { threadId });
  }

  private schedule(scopeKey: string): void {
    const scope = this.scopes.get(scopeKey);
    if (!scope || this.disposed) return;
    if (scope.timer !== null) {
      clearTimeout(scope.timer);
      scope.timer = null;
    }
    if (scope.releasing) return;
    const retryAtMs = [...scope.threadIds]
      .map((threadId) => this.entries.get(threadId))
      .flatMap((entry) =>
        entry && !entry.releasing && entry.retryAtMs !== null
          ? [entry.retryAtMs]
          : [],
      )
      .sort((a, b) => a - b)[0];
    if (retryAtMs === undefined) return;
    const delay = Math.min(
      MAX_TIMER_DELAY_MS,
      Math.max(0, retryAtMs - this.sources.now()),
    );
    scope.timer = setTimeout(() => {
      scope.timer = null;
      void this.runScope(scopeKey);
    }, delay);
  }

  private async runScope(scopeKey: string): Promise<void> {
    const scope = this.scopes.get(scopeKey);
    if (!scope || scope.releasing || this.disposed) return;
    const dueEntry = [...scope.threadIds]
      .map((threadId) => this.entries.get(threadId))
      .filter(
        (entry): entry is WaitingEntry =>
          entry !== undefined &&
          !entry.releasing &&
          entry.retryAtMs !== null &&
          entry.retryAtMs <= this.sources.now(),
      )
      .sort(
        (a, b) =>
          (a.retryAtMs ?? 0) - (b.retryAtMs ?? 0) ||
          a.threadId.localeCompare(b.threadId),
      )[0];
    if (!dueEntry) {
      this.schedule(scopeKey);
      return;
    }

    scope.releasing = true;
    try {
      await this.release(dueEntry.threadId);
      const nextRetryAtMs = this.sources.now() + RELEASE_PACE_MS;
      for (const threadId of scope.threadIds) {
        const entry = this.entries.get(threadId);
        if (
          entry &&
          !entry.releasing &&
          entry.retryAtMs !== null &&
          entry.retryAtMs <= this.sources.now()
        ) {
          entry.retryAtMs = nextRetryAtMs;
          this.publish(threadId);
        }
      }
    } finally {
      scope.releasing = false;
      this.schedule(scopeKey);
    }
  }

  private async release(threadId: string): Promise<boolean> {
    return this.withThreadLock(threadId, () => this.releaseDirect(threadId));
  }

  private async releaseDirect(threadId: string): Promise<boolean> {
    const entry = this.entries.get(threadId);
    if (!entry || this.disposed) return false;
    const failedRequestId = entry.candidate.failedRequestId;
    entry.releasing = true;
    this.publish(threadId);
    try {
      const status = await inspectProviderRetry(this.bb, threadId);
      if (this.disposed) return false;
      if (
        status.candidate === null ||
        !isAutomaticCandidate(status.candidate) ||
        status.candidate.failedRequestId !== failedRequestId
      ) {
        this.remove(threadId);
        return false;
      }
      const candidate = status.candidate;
      const resetsAtMs = candidate.resetsAtMs;
      await this.continueCandidate(threadId, candidate);
      this.attemptedWindows.set(threadId, {
        resetsAtMs,
        scopeKey: status.scopeKey,
      });
      this.remove(threadId);
      return true;
    } catch (error) {
      this.bb.log.warn(
        `Provider retry for thread ${threadId} could not start: ${errorMessage(error)}`,
      );
      let status: RecoveryStatus | null = null;
      try {
        status = await inspectProviderRetry(this.bb, threadId);
      } catch (inspectionError) {
        this.bb.log.warn(
          `Provider retry status refresh for thread ${threadId} failed: ${errorMessage(inspectionError)}`,
        );
      }
      if (
        status !== null &&
        (status.candidate?.failedRequestId !== failedRequestId ||
          status.candidate.automatic !== true ||
          status.candidate.resetsAtMs === null)
      ) {
        this.remove(threadId);
        return false;
      }

      const current = this.entries.get(threadId);
      if (!current) return false;
      if (isHostUnavailableError(error)) {
        if (status?.candidate) current.candidate = status.candidate;
        current.releasing = false;
        current.retryAtMs = null;
        this.publish(threadId);
        return false;
      }

      this.remove(threadId);
      return false;
    }
  }

  private async continueCandidate(
    threadId: string,
    candidate: RecoveryCandidate,
  ): Promise<void> {
    await this.bb.sdk.threads.send({
      threadId,
      mode: "start",
      input: [
        {
          type: "text",
          text: "Please continue.",
          mentions: [],
          visibility: "agent-only",
        },
      ],
      ...candidate.execution,
      executionInputSources: {
        model: "explicit",
        permissionMode: "explicit",
        reasoningLevel: "explicit",
        serviceTier: "explicit",
      },
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const scope of this.scopes.values()) {
      if (scope.timer !== null) clearTimeout(scope.timer);
    }
    this.scopes.clear();
    this.entries.clear();
    this.attemptedWindows.clear();
    this.threadLocks.clear();
  }
}
