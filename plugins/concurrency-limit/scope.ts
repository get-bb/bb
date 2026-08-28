// Scopes: which limit applies to a dispatch, and what to tell the user when
// one binds.
//
// A dispatch belongs to two scopes at once — the global pool and its host's.
// Either can bind, and the user needs to know *which*, so the scope is carried
// as a value rather than recomputed from a formatted string. A dispatch whose
// host is not known yet belongs to the global pool only.

import type { ResolvedLimits } from "./limits.js";

/** Reason strings are capped by the hold contract; host names are user-set. */
export const MAX_REASON_LENGTH = 200;

/** A scope key is the identity a count and a hold are filed under. */
export type ScopeKey = string;

export const GLOBAL_SCOPE_KEY: ScopeKey = "global";

export function hostScopeKey(hostId: string): ScopeKey {
  return `host:${hostId}`;
}

/**
 * Every scope key a dispatch or thread occupies, most specific last. `hostId`
 * is null whenever the environment has not been chosen yet — at `thread.create`
 * before provisioning — which means such a dispatch counts toward the global
 * pool but toward no host's.
 */
export function scopeKeysFor(hostId: string | null): ScopeKey[] {
  if (hostId === null) return [GLOBAL_SCOPE_KEY];
  return [GLOBAL_SCOPE_KEY, hostScopeKey(hostId)];
}

/**
 * Whether this dispatch is exempt from counting and from limiting.
 *
 * Child and plugin-spawned threads always are, and this is not a setting.
 * It is the deadlock guard: a `workflows`-style parent sits in `active` for the
 * entire time it waits on hidden children. If children counted against the same
 * pool, a limit of N would be consumed by N parents that can only finish once
 * their children run — and the children would be held forever behind the
 * parents. Exempting children breaks the cycle: the parent occupies a slot, its
 * children do not.
 *
 * `parentThreadId` catches forks and side-chats; `originPluginId` catches
 * plugin-spawned roots that have no parent thread but are still someone else's
 * internal machinery rather than a user asking for work.
 */
export function isExemptDispatch(args: {
  parentThreadId: string | null;
  originPluginId: string | null;
}): boolean {
  return args.parentThreadId !== null || args.originPluginId !== null;
}

/** What a gate needs to decide, with every input already in memory. */
export interface EvaluateDispatchArgs {
  limits: ResolvedLimits;
  /** The host this dispatch would run on, or null when it is not chosen yet. */
  hostId: string | null;
  /** Display name for the target host, when one is known. */
  hostName: string | null;
  /** Occupancy in a scope, excluding this dispatch. */
  countInScope: (key: ScopeKey) => number;
}

/** A gate verdict, in the plugin's own vocabulary. */
export type DispatchEvaluation =
  | { action: "proceed" }
  | { action: "wait"; reason: string; scopeKey: ScopeKey };

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
function formatCountReason(args: {
  count: number;
  limit: number;
  scopeLabel: string;
}): string {
  return truncateReason(
    `${args.count} of ${args.limit} running on ${args.scopeLabel}`,
  );
}

function hostLabel(hostId: string, hostName: string | null): string {
  if (hostName !== null && hostName.trim() !== "") return hostName;
  return hostId;
}

/**
 * Apply both configured limits, global first, and report the first that binds.
 *
 * The order is deterministic on purpose. Both limits can be at capacity at
 * once, and a gate that reported whichever one it noticed first would give the
 * same thread a different reason on each re-evaluation (passes re-run on
 * release, restart and retry). Broadest-first also gives the most useful
 * answer: "the server is full" explains more than "this host is full" when
 * both are true.
 */
export function evaluateDispatch(
  args: EvaluateDispatchArgs,
): DispatchEvaluation {
  const { limits, hostId } = args;

  if (limits.global !== null) {
    const count = args.countInScope(GLOBAL_SCOPE_KEY);
    if (count >= limits.global) {
      return {
        action: "wait",
        scopeKey: GLOBAL_SCOPE_KEY,
        reason: formatCountReason({
          count: limits.global,
          limit: limits.global,
          scopeLabel: "all hosts",
        }),
      };
    }
  }

  if (limits.perHost !== null && hostId !== null) {
    const key = hostScopeKey(hostId);
    const count = args.countInScope(key);
    if (count >= limits.perHost) {
      return {
        action: "wait",
        scopeKey: key,
        reason: formatCountReason({
          count: limits.perHost,
          limit: limits.perHost,
          scopeLabel: `host ${hostLabel(hostId, args.hostName)}`,
        }),
      };
    }
  }

  return { action: "proceed" };
}
