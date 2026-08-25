// Scopes: which limit applies to a dispatch, and what to tell the user when
// one binds.
//
// A dispatch belongs to up to three scopes at once (global, its host, its
// provider). Each has its own limit, any of them can bind, and the user needs
// to know *which*, so the scope is carried as a value rather than recomputed
// from a formatted string.

import type { ResolvedLimits } from "./limits.js";

/** Reason strings are capped by the hold contract; host names are user-set. */
export const MAX_REASON_LENGTH = 200;

export type ScopeKind = "global" | "host" | "provider";

/** A scope key is the identity a count and a hold are filed under. */
export type ScopeKey = string;

export const GLOBAL_SCOPE_KEY: ScopeKey = "global";

export function hostScopeKey(hostId: string): ScopeKey {
  return `host:${hostId}`;
}

export function providerScopeKey(providerId: string): ScopeKey {
  return `provider:${providerId}`;
}

/**
 * Where a dispatch (or a running thread) sits. `hostId` is null whenever the
 * environment has not been chosen yet — at `thread.create` before provisioning
 * — which means such a dispatch counts toward the global and provider scopes
 * but toward no host's.
 */
export interface DispatchScope {
  hostId: string | null;
  providerId: string | null;
}

/** Every scope key a dispatch or thread occupies, most specific last. */
export function scopeKeysFor(scope: DispatchScope): ScopeKey[] {
  const keys: ScopeKey[] = [GLOBAL_SCOPE_KEY];
  if (scope.hostId !== null) keys.push(hostScopeKey(scope.hostId));
  if (scope.providerId !== null) keys.push(providerScopeKey(scope.providerId));
  return keys;
}

/**
 * Whether this dispatch is exempt from counting and from limiting.
 *
 * This is the deadlock guard, and it is why "Include child threads" defaults
 * to false. A `workflows`-style parent sits in `active` for the entire time it
 * waits on hidden children. If children counted against the same pool, a limit
 * of N would be consumed by N parents that can only finish once their children
 * run — and the children would be held forever behind the parents. Exempting
 * children breaks the cycle: the parent occupies a slot, its children do not.
 *
 * `parentThreadId` catches forks and side-chats; `originPluginId` catches
 * plugin-spawned roots that have no parent thread but are still someone else's
 * internal machinery rather than a user asking for work.
 */
export function isExemptDispatch(args: {
  parentThreadId: string | null;
  originPluginId: string | null;
  includeChildThreads: boolean;
}): boolean {
  if (args.includeChildThreads) return false;
  return args.parentThreadId !== null || args.originPluginId !== null;
}

/** A load reading for one host, as cached by the backend poller. */
export interface HostLoad {
  cpuPercent: number;
  memoryPercent: number;
}

/** What a gate needs to decide, with every input already in memory. */
export interface EvaluateDispatchArgs {
  limits: ResolvedLimits;
  scope: DispatchScope;
  /** Display name for the target host, when one is known. */
  hostName: string | null;
  /** Occupancy in a scope, excluding this dispatch. */
  countInScope: (key: ScopeKey) => number;
  /** The cached load sample for the target host, or null when there is none. */
  load: HostLoad | null;
}

/** A gate verdict, in the plugin's own vocabulary. */
export type DispatchEvaluation =
  | { action: "proceed" }
  | { action: "hold"; reason: string; scopeKey: ScopeKey };

function truncateReason(reason: string): string {
  if (reason.length <= MAX_REASON_LENGTH) return reason;
  return `${reason.slice(0, MAX_REASON_LENGTH - 1)}…`;
}

/**
 * "N of N running on <scope>". The count shown is the *occupancy that blocked
 * this dispatch*, which for a binding limit is always the limit itself — so
 * "4 of 4 running on all hosts" reads as a full pool rather than an off-by-one
 * ("5 of 4"). A limit of 0 is shown as "0 of 0", which is honest: the pool has
 * no slots.
 */
export function formatCountReason(args: {
  count: number;
  limit: number;
  scopeLabel: string;
}): string {
  return truncateReason(
    `${args.count} of ${args.limit} running on ${args.scopeLabel}`,
  );
}

export function formatLoadReason(args: {
  metric: "CPU" | "Memory";
  percent: number;
  hostLabel: string;
}): string {
  return truncateReason(
    `${args.metric} ${Math.round(args.percent)}% on ${args.hostLabel}`,
  );
}

function hostLabel(scope: DispatchScope, hostName: string | null): string {
  if (hostName !== null && hostName.trim() !== "") return hostName;
  return scope.hostId ?? "this host";
}

/**
 * Apply every configured limit in a fixed order — global, host, provider, CPU,
 * memory — and report the first that binds.
 *
 * The order is deterministic on purpose. Several limits can be at capacity at
 * once, and a gate that reported whichever one it noticed first would give the
 * same thread a different reason on each re-evaluation (passes re-run on
 * release, restart and retry). Broadest-first also gives the most useful
 * answer: "the server is full" explains more than "this provider is full" when
 * both are true.
 */
export function evaluateDispatch(
  args: EvaluateDispatchArgs,
): DispatchEvaluation {
  const { limits, scope, load } = args;

  if (limits.global !== null) {
    const count = args.countInScope(GLOBAL_SCOPE_KEY);
    if (count >= limits.global) {
      return {
        action: "hold",
        scopeKey: GLOBAL_SCOPE_KEY,
        reason: formatCountReason({
          count: limits.global,
          limit: limits.global,
          scopeLabel: "all hosts",
        }),
      };
    }
  }

  if (limits.perHost !== null && scope.hostId !== null) {
    const key = hostScopeKey(scope.hostId);
    const count = args.countInScope(key);
    if (count >= limits.perHost) {
      return {
        action: "hold",
        scopeKey: key,
        reason: formatCountReason({
          count: limits.perHost,
          limit: limits.perHost,
          scopeLabel: `host ${hostLabel(scope, args.hostName)}`,
        }),
      };
    }
  }

  if (limits.perProvider !== null && scope.providerId !== null) {
    const key = providerScopeKey(scope.providerId);
    const count = args.countInScope(key);
    if (count >= limits.perProvider) {
      return {
        action: "hold",
        scopeKey: key,
        reason: formatCountReason({
          count: limits.perProvider,
          limit: limits.perProvider,
          scopeLabel: `provider ${scope.providerId}`,
        }),
      };
    }
  }

  // Load thresholds need both a target host and a fresh sample for it. With
  // either missing the dispatch proceeds: holding work because telemetry has
  // not arrived would turn a monitoring gap into an outage.
  if (load !== null && scope.hostId !== null) {
    const label = hostLabel(scope, args.hostName);
    if (
      limits.maxCpuPercent !== null &&
      load.cpuPercent >= limits.maxCpuPercent
    ) {
      return {
        action: "hold",
        scopeKey: hostScopeKey(scope.hostId),
        reason: formatLoadReason({
          metric: "CPU",
          percent: load.cpuPercent,
          hostLabel: label,
        }),
      };
    }
    if (
      limits.maxMemoryPercent !== null &&
      load.memoryPercent >= limits.maxMemoryPercent
    ) {
      return {
        action: "hold",
        scopeKey: hostScopeKey(scope.hostId),
        reason: formatLoadReason({
          metric: "Memory",
          percent: load.memoryPercent,
          hostLabel: label,
        }),
      };
    }
  }

  return { action: "proceed" };
}
