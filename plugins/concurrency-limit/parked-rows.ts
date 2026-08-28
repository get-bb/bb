// Tracking the rows we parked, so a finished thread clears the right one.
//
// A gate's `wait` verdict returns a reason, not a row id — core parks the row
// and announces it on `queue.parked`. To clear the *oldest row waiting on the
// scope that just freed*, we need to link the two, and nothing on the queued
// row says which limit produced it.
//
// The link is ordering. Gate evaluation is strictly serial under one
// server-wide lock, so our hold verdicts and the `dispatch.held` events that
// follow them are in the same order. Each verdict pushes an intent; each event
// claims one. The reason string is used as a tiebreak so a mismatch (a pass
// that held for someone else, a restart mid-flight) degrades to "unknown
// scope" rather than mislabelling a hold.
//
// Pure and I/O-free: `bb.experimental_dispatch.clearWait` is called by the
// caller with whatever this returns.

import type { ScopeKey } from "./scope.js";

/** A row we are holding. `scopeKey` is null when we could not attribute it. */
export interface TrackedRow {
  queuedMessageId: string;
  threadId: string;
  createdAt: number;
  scopeKey: ScopeKey | null;
}

interface HoldIntent {
  reason: string;
  scopeKey: ScopeKey;
}

/** The subset of a parked queued row this registry reads. */
export interface ParkedRecord {
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

export class ParkedRowRegistry {
  private readonly live = new Map<string, TrackedRow>();
  private readonly intents: HoldIntent[] = [];

  constructor(private readonly holder: string) {}

  /** Record that our gate just returned `wait` with this reason and scope. */
  expectWait(reason: string, scopeKey: ScopeKey): void {
    this.intents.push({ reason, scopeKey });
    while (this.intents.length > MAX_PENDING_INTENTS) this.intents.shift();
  }

  /**
   * A `queue.parked` event arrived. Holds owned by anyone else are ignored:
   * every listener sees every hold, and releasing another owner's hold is
   * refused by core anyway.
   */
  noteParked(record: ParkedRecord): boolean {
    if (record.holder !== this.holder) return false;
    this.live.set(record.id, {
      queuedMessageId: record.id,
      threadId: record.threadId,
      createdAt: record.createdAt,
      scopeKey: this.claimIntent(record.reason),
    });
    return true;
  }

  /**
   * Adopt rows that already existed — the startup reconciliation for rows we
   * parked before a restart. Their scope is unknown, which makes them eligible
   * for any freed scope; core re-runs our gate when a wait clears, so a clear
   * that was not actually warranted simply re-parks.
   */
  adopt(records: readonly ParkedRecord[]): void {
    for (const record of records) {
      if (record.holder !== this.holder) continue;
      if (this.live.has(record.id)) continue;
      this.live.set(record.id, {
        queuedMessageId: record.id,
        threadId: record.threadId,
        createdAt: record.createdAt,
        scopeKey: null,
      });
    }
  }

  /** A `queue.dispatched` or `queue.cancelled` event arrived. */
  noteResolved(queuedMessageId: string): void {
    this.live.delete(queuedMessageId);
  }

  /**
   * The hold to release now that `freedScopeKeys` have a slot spare.
   *
   * Oldest first, by row creation time, so rows drain in the order they were
   * parked rather than by whichever thread happened to finish. Ties break on
   * row id purely so the choice is deterministic across restarts and in tests.
   * A row with an unknown scope is eligible for any free.
   */
  oldestForScopes(freedScopeKeys: readonly ScopeKey[]): TrackedRow | null {
    const freed = new Set(freedScopeKeys);
    let best: TrackedRow | null = null;
    for (const hold of this.live.values()) {
      if (hold.scopeKey !== null && !freed.has(hold.scopeKey)) continue;
      if (
        best === null ||
        hold.createdAt < best.createdAt ||
        (hold.createdAt === best.createdAt && hold.queuedMessageId < best.queuedMessageId)
      ) {
        best = hold;
      }
    }
    return best;
  }

  /** Live rows we are holding, for logging and tests. */
  liveRows(): TrackedRow[] {
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
