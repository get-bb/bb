// Tracking our own holds, so a finished thread releases the right one.
//
// A gate's `hold` verdict returns a reason, not a hold id — core creates the
// row and announces it on `dispatch.held`. To release the *oldest hold waiting
// on the scope that just freed*, we need to link the two, and nothing on
// `DispatchHoldResponse` says which limit produced it.
//
// The link is ordering. Gate evaluation is strictly serial under one
// server-wide lock, so our hold verdicts and the `dispatch.held` events that
// follow them are in the same order. Each verdict pushes an intent; each event
// claims one. The reason string is used as a tiebreak so a mismatch (a pass
// that held for someone else, a restart mid-flight) degrades to "unknown
// scope" rather than mislabelling a hold.
//
// Pure and I/O-free: `bb.experimental_dispatch.release` is called by the
// caller with whatever this returns.

import type { ScopeKey } from "./scope.js";

/** A hold we own. `scopeKey` is null when we could not attribute it. */
export interface TrackedHold {
  holdId: string;
  threadId: string;
  createdAt: number;
  scopeKey: ScopeKey | null;
}

interface HoldIntent {
  reason: string;
  scopeKey: ScopeKey;
}

/** The subset of `DispatchHoldResponse` this registry reads. */
export interface HeldRecord {
  id: string;
  threadId: string;
  reason: string;
  createdAt: number;
  holder: string;
}

/**
 * How many unclaimed intents to keep. Intents are claimed within milliseconds
 * of being pushed; a backlog means holds are being created without events
 * reaching us, and an unbounded queue would then mislabel every later hold
 * with a stale scope. Dropping the oldest keeps attribution recent.
 */
const MAX_PENDING_INTENTS = 64;

export class HoldRegistry {
  private readonly live = new Map<string, TrackedHold>();
  private readonly intents: HoldIntent[] = [];

  constructor(private readonly holder: string) {}

  /** Record that our gate just returned `hold` with this reason and scope. */
  expectHold(reason: string, scopeKey: ScopeKey): void {
    this.intents.push({ reason, scopeKey });
    while (this.intents.length > MAX_PENDING_INTENTS) this.intents.shift();
  }

  /**
   * A `dispatch.held` event arrived. Holds owned by anyone else are ignored:
   * every listener sees every hold, and releasing another owner's hold is
   * refused by core anyway.
   */
  noteHeld(record: HeldRecord): boolean {
    if (record.holder !== this.holder) return false;
    this.live.set(record.id, {
      holdId: record.id,
      threadId: record.threadId,
      createdAt: record.createdAt,
      scopeKey: this.claimIntent(record.reason),
    });
    return true;
  }

  /**
   * Adopt holds that already existed — the startup reconciliation for holds we
   * created before a restart. Their scope is unknown, which makes them
   * eligible for release by any freed scope; core re-runs our gate on release,
   * so a release that was not actually warranted simply re-holds.
   */
  adopt(records: readonly HeldRecord[]): void {
    for (const record of records) {
      if (record.holder !== this.holder) continue;
      if (this.live.has(record.id)) continue;
      this.live.set(record.id, {
        holdId: record.id,
        threadId: record.threadId,
        createdAt: record.createdAt,
        scopeKey: null,
      });
    }
  }

  /** A `dispatch.released` or `dispatch.cancelled` event arrived. */
  noteResolved(holdId: string): void {
    this.live.delete(holdId);
  }

  /**
   * The hold to release now that `freedScopeKeys` have a slot spare.
   *
   * Oldest first, by hold creation time, so holds drain in the order they were
   * placed rather than by whichever thread happened to finish. Ties break on
   * hold id purely so the choice is deterministic across restarts and in
   * tests. A hold with an unknown scope is eligible for any free.
   */
  oldestForScopes(freedScopeKeys: readonly ScopeKey[]): TrackedHold | null {
    const freed = new Set(freedScopeKeys);
    let best: TrackedHold | null = null;
    for (const hold of this.live.values()) {
      if (hold.scopeKey !== null && !freed.has(hold.scopeKey)) continue;
      if (
        best === null ||
        hold.createdAt < best.createdAt ||
        (hold.createdAt === best.createdAt && hold.holdId < best.holdId)
      ) {
        best = hold;
      }
    }
    return best;
  }

  /** Live holds we own, for logging and tests. */
  liveHolds(): TrackedHold[] {
    return [...this.live.values()];
  }

  private claimIntent(reason: string): ScopeKey | null {
    const exact = this.intents.findIndex((intent) => intent.reason === reason);
    const index = exact >= 0 ? exact : this.intents.length > 0 ? 0 : -1;
    if (index < 0) return null;
    const [claimed] = this.intents.splice(index, 1);
    return claimed?.scopeKey ?? null;
  }
}
