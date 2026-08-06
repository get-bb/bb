import type { BbPluginApi } from "@bb/plugin-sdk";
import type { ProviderRetryPhase, ProviderRetryView } from "./contract.js";

type RecoveryStatus = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["rateLimitRecovery"]>
>;
type RecoveryCandidate = NonNullable<RecoveryStatus["candidate"]>;
type ProviderUsageResponse = Awaited<
  ReturnType<BbPluginApi["sdk"]["system"]["usageLimits"]>
>;
type ProviderUsage = ProviderUsageResponse[keyof ProviderUsageResponse];

export const RESET_BUFFER_MS = 15_000;
export const RESET_JITTER_MS = 30_000;
export const RELEASE_PACE_MS = 1_000;
export const HOST_RETRY_MS = 30_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const REALTIME_CHANNEL = "provider-retry";

export interface ProviderRetrySources {
  now(): number;
  random(): number;
}

interface WaitingEntry {
  view: ProviderRetryView;
  candidate: RecoveryCandidate | null;
}

interface ScopeQueue {
  releasing: boolean;
  threadIds: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function refreshSupported(providerId: string): boolean {
  return providerId === "codex" || providerId === "claude-code";
}

function usageForProvider(
  usage: ProviderUsageResponse,
  providerId: string,
): ProviderUsage | null {
  switch (providerId) {
    case "codex":
      return usage.codex;
    case "claude-code":
      return usage.claudeCode;
    default:
      return null;
  }
}

function blockedWindowLabel(status: RecoveryStatus): string | null {
  const windows = status.rateLimits?.windows ?? [];
  const window =
    windows.find((candidate) => candidate.status === "blocked") ?? windows[0];
  return window?.label ?? window?.providerKey ?? null;
}

function recoveryView(args: {
  candidate: RecoveryCandidate | null;
  dueAtMs: number | null;
  phase: ProviderRetryPhase;
  status: RecoveryStatus;
  threadId: string;
}): ProviderRetryView {
  const rateLimits = args.status.rateLimits ?? args.candidate?.rateLimits;
  return {
    threadId: args.threadId,
    failedRequestId: args.candidate?.failedRequestId ?? null,
    scopeKey: args.status.scopeKey,
    hostId: args.status.hostId,
    providerId: rateLimits?.providerId ?? "unknown",
    phase: args.phase,
    automatic: args.candidate?.automatic ?? false,
    dueAtMs: args.dueAtMs,
    resetsAtMs: args.candidate?.resetsAtMs ?? null,
    windowLabel: blockedWindowLabel(args.status),
    kind: rateLimits?.kind ?? "unknown",
    reachedReason: rateLimits?.reachedReason ?? null,
    overageReason: rateLimits?.overageReason ?? null,
    recoveryReason: args.status.reason,
    refreshError: null,
  };
}

function unsafeRecovery(status: RecoveryStatus): boolean {
  return (
    status.rateLimits?.status === "blocked" &&
    [
      "input-not-accepted",
      "output-or-side-effect-observed",
      "execution-unavailable",
    ].includes(status.reason)
  );
}

function refreshFailureMessage(usage: ProviderUsage): string | null {
  switch (usage.status) {
    case "ok":
      return null;
    case "not_installed":
      return "The provider CLI is not installed on this host.";
    case "unauthenticated":
      return "The provider CLI is not signed in on this host.";
    case "expired":
      return "The provider credentials on this host have expired.";
    case "error":
      return usage.message;
  }
}

function latestUsageResetAtMs(usage: ProviderUsage): number | null {
  if (usage.status !== "ok") return null;
  const blockedWindows = usage.windows.filter(
    (window) => window.usedPercent >= 100,
  );
  const relevantWindows =
    blockedWindows.length > 0 ? blockedWindows : usage.windows;
  const timestamps = relevantWindows.flatMap((window) => {
    if (window.resetsAt === null) return [];
    const timestamp = Date.parse(window.resetsAt);
    return Number.isFinite(timestamp) ? [timestamp] : [];
  });
  return timestamps.length === 0 ? null : Math.max(...timestamps);
}

function usageIsAllowed(usage: ProviderUsage): boolean {
  return (
    usage.status === "ok" &&
    usage.windows.length > 0 &&
    usage.windows.every((window) => window.usedPercent < 100)
  );
}

export class ProviderRetryService {
  private readonly entries = new Map<string, WaitingEntry>();
  private readonly scopes = new Map<string, ScopeQueue>();
  private readonly reconcileLocks = new Map<string, Promise<void>>();
  private readonly releaseLocks = new Map<string, Promise<boolean>>();
  private disposed = false;

  constructor(
    private readonly bb: BbPluginApi,
    private readonly sources: ProviderRetrySources = {
      now: () => Date.now(),
      random: () => Math.random(),
    },
  ) {}

  list(): ProviderRetryView[] {
    return [...this.entries.values()]
      .map((entry) => entry.view)
      .sort((a, b) => a.threadId.localeCompare(b.threadId));
  }

  status(threadId: string): ProviderRetryView | null {
    return this.entries.get(threadId)?.view ?? null;
  }

  async reconcile(threadId: string): Promise<ProviderRetryView | null> {
    const previous = this.reconcileLocks.get(threadId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.reconcileDirect(threadId));
    const lock = next.then(
      () => undefined,
      () => undefined,
    );
    this.reconcileLocks.set(threadId, lock);
    try {
      return await next;
    } finally {
      if (this.reconcileLocks.get(threadId) === lock) {
        this.reconcileLocks.delete(threadId);
      }
    }
  }

  private async reconcileDirect(
    threadId: string,
  ): Promise<ProviderRetryView | null> {
    if (this.disposed) return null;
    const status = await this.bb.sdk.threads.rateLimitRecovery({ threadId });
    const existing = this.entries.get(threadId);
    if (existing?.view.phase === "releasing") {
      return existing.view;
    }
    const candidate = status.candidate;
    if (candidate === null) {
      if (unsafeRecovery(status)) {
        this.upsert(threadId, {
          candidate: null,
          view: recoveryView({
            candidate: null,
            dueAtMs: null,
            phase: "unsafe",
            status,
            threadId,
          }),
        });
        return this.status(threadId);
      }
      this.remove(threadId);
      return null;
    }

    let dueAtMs: number | null = null;
    let phase: ProviderRetryPhase = "blocked";
    if (candidate.automatic && candidate.resetsAtMs !== null) {
      const sameCandidate =
        existing?.candidate?.failedRequestId === candidate.failedRequestId &&
        existing.candidate.resetsAtMs === candidate.resetsAtMs;
      if (status.rateLimits?.status === "allowed") {
        dueAtMs = this.sources.now();
      } else if (sameCandidate && existing.view.phase === "waiting-for-host") {
        dueAtMs = existing.view.dueAtMs;
        phase = "waiting-for-host";
      } else if (sameCandidate && existing.view.dueAtMs !== null) {
        dueAtMs = existing.view.dueAtMs;
      } else {
        dueAtMs =
          candidate.resetsAtMs +
          RESET_BUFFER_MS +
          Math.floor(this.sources.random() * RESET_JITTER_MS);
      }
      if (phase !== "waiting-for-host") phase = "waiting-for-reset";
    }
    this.upsert(threadId, {
      candidate,
      view: recoveryView({ candidate, dueAtMs, phase, status, threadId }),
    });
    return this.status(threadId);
  }

  async retryNow(threadId: string): Promise<boolean> {
    if (!this.entries.has(threadId)) await this.reconcile(threadId);
    const entry = this.entries.get(threadId);
    if (entry?.candidate === null || entry === undefined) return false;
    return this.release(threadId);
  }

  cancel(threadId: string): boolean {
    const entry = this.entries.get(threadId);
    if (!entry || entry.view.phase === "releasing") return false;
    this.remove(threadId);
    return true;
  }

  supersede(threadId: string): void {
    const entry = this.entries.get(threadId);
    if (entry?.view.phase === "releasing") return;
    this.remove(threadId);
  }

  hostChanged(hostId: string): void {
    const now = this.sources.now();
    const scopeKeys = new Set<string>();
    for (const entry of this.entries.values()) {
      if (
        entry.view.hostId === hostId &&
        entry.view.phase === "waiting-for-host"
      ) {
        entry.view = { ...entry.view, dueAtMs: now };
        scopeKeys.add(entry.view.scopeKey);
        this.publish(entry.view.threadId);
      }
    }
    for (const scopeKey of scopeKeys) this.schedule(scopeKey);
  }

  async refresh(threadId: string): Promise<ProviderRetryView | null> {
    if (!this.entries.has(threadId)) await this.reconcile(threadId);
    const entry = this.entries.get(threadId);
    if (!entry) return null;
    if (entry.view.phase === "releasing") return entry.view;
    if (!refreshSupported(entry.view.providerId)) {
      entry.view = {
        ...entry.view,
        refreshError: "Usage refresh is unavailable for this provider.",
      };
      this.publish(threadId);
      return entry.view;
    }

    let usage: ProviderUsage | null = null;
    try {
      const response = await this.bb.sdk.system.usageLimits({
        hostId: entry.view.hostId,
      });
      usage = usageForProvider(response, entry.view.providerId);
    } catch (error) {
      this.setScopeRefreshError(entry.view.scopeKey, errorMessage(error));
      return this.status(threadId);
    }
    if (usage === null) {
      this.setScopeRefreshError(
        entry.view.scopeKey,
        "Usage refresh is unavailable for this provider.",
      );
      return this.status(threadId);
    }

    const failure = refreshFailureMessage(usage);
    if (failure !== null) {
      this.setScopeRefreshError(entry.view.scopeKey, failure);
      return this.status(threadId);
    }
    this.setScopeRefreshError(entry.view.scopeKey, null);
    if (usageIsAllowed(usage)) {
      this.releaseScopeEarly(entry.view.scopeKey);
      return this.status(threadId);
    }
    const resetAtMs = latestUsageResetAtMs(usage);
    if (resetAtMs !== null) {
      this.rescheduleScope(entry.view.scopeKey, resetAtMs);
    }
    return this.status(threadId);
  }

  private setScopeRefreshError(scopeKey: string, error: string | null): void {
    const scope = this.scopes.get(scopeKey);
    if (!scope) return;
    for (const threadId of scope.threadIds) {
      const entry = this.entries.get(threadId);
      if (!entry || entry.view.phase === "releasing") continue;
      entry.view = {
        ...entry.view,
        refreshError: error,
      };
      this.publish(threadId);
    }
  }

  private releaseScopeEarly(scopeKey: string): void {
    const scope = this.scopes.get(scopeKey);
    if (!scope) return;
    const now = this.sources.now();
    for (const threadId of scope.threadIds) {
      const entry = this.entries.get(threadId);
      if (!entry?.candidate?.automatic || entry.view.phase === "releasing") {
        continue;
      }
      entry.view = {
        ...entry.view,
        dueAtMs: now,
        phase: "waiting-for-reset",
      };
      this.publish(threadId);
    }
    this.schedule(scopeKey);
  }

  private rescheduleScope(scopeKey: string, resetAtMs: number): void {
    const scope = this.scopes.get(scopeKey);
    if (!scope) return;
    const dueAtMs =
      resetAtMs +
      RESET_BUFFER_MS +
      Math.floor(this.sources.random() * RESET_JITTER_MS);
    for (const threadId of scope.threadIds) {
      const entry = this.entries.get(threadId);
      if (!entry?.candidate?.automatic || entry.view.phase === "releasing") {
        continue;
      }
      entry.view = { ...entry.view, dueAtMs, resetsAtMs: resetAtMs };
      this.publish(threadId);
    }
    this.schedule(scopeKey);
  }

  private upsert(threadId: string, entry: WaitingEntry): void {
    const previousScopeKey = this.entries.get(threadId)?.view.scopeKey;
    if (previousScopeKey && previousScopeKey !== entry.view.scopeKey) {
      this.removeFromScope(threadId, previousScopeKey);
    }
    this.entries.set(threadId, entry);
    const scope = this.ensureScope(entry.view.scopeKey);
    scope.threadIds.add(threadId);
    this.publish(threadId);
    this.schedule(entry.view.scopeKey);
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
    this.removeFromScope(threadId, entry.view.scopeKey);
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
    const dueAtMs = [...scope.threadIds]
      .map((threadId) => this.entries.get(threadId)?.view.dueAtMs ?? null)
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b)[0];
    if (dueAtMs === undefined) return;
    const delay = Math.min(
      MAX_TIMER_DELAY_MS,
      Math.max(0, dueAtMs - this.sources.now()),
    );
    scope.timer = setTimeout(() => {
      scope.timer = null;
      void this.runScope(scopeKey);
    }, delay);
  }

  private async runScope(scopeKey: string): Promise<void> {
    const scope = this.scopes.get(scopeKey);
    if (!scope || scope.releasing || this.disposed) return;
    const dueThreadId = [...scope.threadIds]
      .map((threadId) => this.entries.get(threadId))
      .filter(
        (entry): entry is WaitingEntry =>
          entry !== undefined &&
          entry.candidate?.automatic === true &&
          entry.view.phase !== "releasing" &&
          entry.view.dueAtMs !== null &&
          entry.view.dueAtMs <= this.sources.now(),
      )
      .sort(
        (a, b) =>
          (a.view.dueAtMs ?? 0) - (b.view.dueAtMs ?? 0) ||
          a.view.threadId.localeCompare(b.view.threadId),
      )[0]?.view.threadId;
    if (dueThreadId === undefined) {
      this.schedule(scopeKey);
      return;
    }

    scope.releasing = true;
    try {
      await this.release(dueThreadId);
      const nextDueAtMs = this.sources.now() + RELEASE_PACE_MS;
      for (const threadId of scope.threadIds) {
        const entry = this.entries.get(threadId);
        if (
          entry !== undefined &&
          entry.view.phase !== "releasing" &&
          entry.view.dueAtMs !== null &&
          entry.view.dueAtMs <= this.sources.now()
        ) {
          entry.view = { ...entry.view, dueAtMs: nextDueAtMs };
          this.publish(threadId);
        }
      }
    } finally {
      scope.releasing = false;
      this.schedule(scopeKey);
    }
  }

  private release(threadId: string): Promise<boolean> {
    const existing = this.releaseLocks.get(threadId);
    if (existing) return existing;
    const release = this.releaseDirect(threadId).finally(() => {
      if (this.releaseLocks.get(threadId) === release) {
        this.releaseLocks.delete(threadId);
      }
    });
    this.releaseLocks.set(threadId, release);
    return release;
  }

  private async releaseDirect(threadId: string): Promise<boolean> {
    const entry = this.entries.get(threadId);
    if (!entry?.candidate || this.disposed) return false;
    const failedRequestId = entry.candidate.failedRequestId;
    entry.view = { ...entry.view, phase: "releasing" };
    this.publish(threadId);
    try {
      const status = await this.bb.sdk.threads.rateLimitRecovery({ threadId });
      if (status.candidate?.failedRequestId !== failedRequestId) {
        this.remove(threadId);
        return false;
      }
      await this.bb.sdk.threads.continueAfterRateLimit({
        threadId,
        failedRequestId,
      });
      this.remove(threadId);
      return true;
    } catch (error) {
      this.bb.log.warn(
        `Provider retry for thread ${threadId} could not start: ${errorMessage(error)}`,
      );
      let status: RecoveryStatus | null = null;
      try {
        status = await this.bb.sdk.threads.rateLimitRecovery({ threadId });
      } catch (inspectionError) {
        this.bb.log.warn(
          `Provider retry status refresh for thread ${threadId} failed: ${errorMessage(inspectionError)}`,
        );
      }
      if (status?.candidate?.failedRequestId !== failedRequestId) {
        this.remove(threadId);
        return false;
      }
      const current = this.entries.get(threadId);
      if (!current) return false;
      current.candidate = status.candidate;
      current.view = {
        ...recoveryView({
          candidate: status.candidate,
          dueAtMs: this.sources.now() + HOST_RETRY_MS,
          phase: "waiting-for-host",
          status,
          threadId,
        }),
        refreshError: current.view.refreshError,
      };
      this.publish(threadId);
      this.schedule(current.view.scopeKey);
      return false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const scope of this.scopes.values()) {
      if (scope.timer !== null) clearTimeout(scope.timer);
    }
    this.scopes.clear();
    this.entries.clear();
    this.reconcileLocks.clear();
    this.releaseLocks.clear();
  }
}
