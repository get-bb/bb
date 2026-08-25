// The occupancy tally.
//
// Core deliberately puts no counts on the gate context: counting is the
// plugin's bookkeeping. A gate must decide in milliseconds and cannot await a
// query, so the count has to already be in memory when the gate runs. This
// module is that memory, and it is pure — no I/O, no timers, `now` passed in —
// so every arithmetic case below is testable without a server.
//
// "Occupying" means status `starting` or `active`. A thread that is idle is
// not consuming a slot; `thread.create` admits a brand-new thread and
// `turn.submit` admits an idle one about to go active.
//
// Three things contribute to a count:
//
//  1. A *baseline* seeded from `threads.count`, which returns counts and not
//     ids. We therefore cannot put seeded threads into a set.
//  2. An *observed* set of threads we watched become occupied since the seed.
//  3. *In-flight* proceeds: a gate's `proceed` is a commitment to occupancy
//     that the database does not know about yet. Evaluation is serial under a
//     server-wide lock, so without this a limit of 1 would admit every
//     dispatch that arrives before the first thread's row lands.
//
// The baseline and the observed set could double-count the same thread, and
// the rule that keeps them disjoint is: a thread we never saw become occupied,
// but do see become free, must have been part of the seed — so free it from
// the baseline. A thread we did see become occupied is ours to free from the
// observed set. `settled` makes that decision once per thread, so a duplicate
// free (idle then archived) cannot decrement the baseline twice.

import type { DispatchScope, ScopeKey } from "./scope.js";
import { GLOBAL_SCOPE_KEY, hostScopeKey, providerScopeKey } from "./scope.js";

/**
 * How long a `proceed` stays counted before we stop believing in it.
 *
 * The matching `thread.created` / `thread.active` normally arrives in
 * milliseconds. It never arrives when the dispatch failed *after* our gate
 * said yes — an invalid amendment from a later gate, a provisioning failure, a
 * crash between the verdict and the insert. Without an expiry those phantom
 * slots would leak until reload and the limiter would strangle itself.
 */
export const IN_FLIGHT_TIMEOUT_MS = 30_000;

export interface SeedCounts {
  /** Total occupying threads. */
  global: number;
  /** Occupying threads per host id. */
  byHost: Record<string, number>;
  /** Occupying threads per provider id. */
  byProvider: Record<string, number>;
}

export const EMPTY_SEED: SeedCounts = {
  global: 0,
  byHost: {},
  byProvider: {},
};

interface InFlight {
  scope: DispatchScope;
  expiresAt: number;
}

function matchesScope(scope: DispatchScope, key: ScopeKey): boolean {
  if (key === GLOBAL_SCOPE_KEY) return true;
  if (scope.hostId !== null && hostScopeKey(scope.hostId) === key) return true;
  if (scope.providerId !== null && providerScopeKey(scope.providerId) === key) {
    return true;
  }
  return false;
}

export class OccupancyTally {
  private baselineGlobal = 0;
  private baselineByHost = new Map<string, number>();
  private baselineByProvider = new Map<string, number>();

  /** Threads we watched become occupied since the last seed. */
  private readonly occupied = new Map<string, DispatchScope>();
  /** Threads already accounted for as free, so a second free is a no-op. */
  private readonly settled = new Set<string>();

  /**
   * `thread.create` proceeds. There is no thread id yet, so these are matched
   * to the `thread.created` event that follows by scope, oldest first.
   */
  private readonly pendingCreates: InFlight[] = [];
  /** `turn.submit` proceeds, which do have a thread id to key on. */
  private readonly pendingSubmits = new Map<string, InFlight>();

  /**
   * Replace the baseline from a fresh `threads.count` snapshot.
   *
   * The observed and settled sets are cleared with it: the new counts already
   * include everything they described, so keeping them would double-count. The
   * in-flight entries deliberately survive — they represent dispatches the
   * database has not seen yet, so a snapshot taken now cannot contain them.
   *
   * Re-seeding periodically is what makes the whole scheme self-healing: any
   * drift from a missed event is erased on the next pass.
   */
  seed(counts: SeedCounts): void {
    this.baselineGlobal = Math.max(0, counts.global);
    this.baselineByHost = new Map(
      Object.entries(counts.byHost).map(([id, n]) => [id, Math.max(0, n)]),
    );
    this.baselineByProvider = new Map(
      Object.entries(counts.byProvider).map(([id, n]) => [id, Math.max(0, n)]),
    );
    this.occupied.clear();
    this.settled.clear();
  }

  /** A gate said `proceed` at `thread.create`. */
  notePendingCreate(scope: DispatchScope, now: number): void {
    this.pendingCreates.push({
      scope,
      expiresAt: now + IN_FLIGHT_TIMEOUT_MS,
    });
  }

  /** A gate said `proceed` at `turn.submit` for an existing thread. */
  notePendingSubmit(threadId: string, scope: DispatchScope, now: number): void {
    this.pendingSubmits.set(threadId, {
      scope,
      expiresAt: now + IN_FLIGHT_TIMEOUT_MS,
    });
  }

  /**
   * `thread.created`: the row now exists and the thread is starting. This is
   * where an anonymous create proceed becomes a tracked thread — matched by
   * scope so that a create for host A does not consume the slot reserved for a
   * create on host B.
   */
  noteCreated(threadId: string, scope: DispatchScope): void {
    this.consumeMatchingCreate(scope);
    this.markOccupied(threadId, scope);
  }

  /** `thread.active`: the thread is running. */
  noteActive(threadId: string, scope: DispatchScope): void {
    this.pendingSubmits.delete(threadId);
    this.markOccupied(threadId, scope);
  }

  /** `thread.idle` / `failed` / `archived` / `deleted`: the slot is free. */
  noteFreed(threadId: string, scope: DispatchScope): void {
    this.pendingSubmits.delete(threadId);
    if (this.settled.has(threadId)) return;
    this.settled.add(threadId);
    if (this.occupied.delete(threadId)) return;
    // Never observed occupying, so its slot came from the seed.
    this.releaseFromBaseline(scope);
  }

  /** Current occupancy in a scope, in-flight proceeds included. */
  count(key: ScopeKey, now: number): number {
    this.sweep(now);
    let total = this.baselineFor(key);
    for (const scope of this.occupied.values()) {
      if (matchesScope(scope, key)) total += 1;
    }
    for (const entry of this.pendingCreates) {
      if (matchesScope(entry.scope, key)) total += 1;
    }
    for (const entry of this.pendingSubmits.values()) {
      if (matchesScope(entry.scope, key)) total += 1;
    }
    return total;
  }

  /** Drop in-flight entries whose confirming event never arrived. */
  sweep(now: number): void {
    for (let i = this.pendingCreates.length - 1; i >= 0; i -= 1) {
      const entry = this.pendingCreates[i];
      if (entry !== undefined && entry.expiresAt <= now) {
        this.pendingCreates.splice(i, 1);
      }
    }
    for (const [threadId, entry] of this.pendingSubmits) {
      if (entry.expiresAt <= now) this.pendingSubmits.delete(threadId);
    }
  }

  private markOccupied(threadId: string, scope: DispatchScope): void {
    this.settled.delete(threadId);
    this.occupied.set(threadId, scope);
  }

  /**
   * Retire the reservation this newly created thread was admitted under.
   *
   * A null `hostId` means "not known yet" on either side, and both sides
   * genuinely happen: the gate sees no host when the environment has not been
   * chosen, and the freshly inserted row has no environment yet even when the
   * gate did see one. So null matches anything, and only two *known,
   * different* hosts are treated as different dispatches — which is the case
   * that matters, since it is what stops a create on host B from consuming the
   * slot reserved for one on host A.
   *
   * Failing to consume here is the expensive mistake: the reservation would
   * sit alongside the thread it belongs to, counting the same dispatch twice
   * until it expired.
   */
  private consumeMatchingCreate(scope: DispatchScope): void {
    const exact = this.pendingCreates.findIndex(
      (entry) =>
        entry.scope.hostId === scope.hostId &&
        entry.scope.providerId === scope.providerId,
    );
    if (exact >= 0) {
      this.pendingCreates.splice(exact, 1);
      return;
    }
    const loose = this.pendingCreates.findIndex(
      (entry) =>
        (entry.scope.hostId === null || scope.hostId === null) &&
        entry.scope.providerId === scope.providerId,
    );
    if (loose >= 0) this.pendingCreates.splice(loose, 1);
  }

  private baselineFor(key: ScopeKey): number {
    if (key === GLOBAL_SCOPE_KEY) return this.baselineGlobal;
    for (const [hostId, count] of this.baselineByHost) {
      if (hostScopeKey(hostId) === key) return count;
    }
    for (const [providerId, count] of this.baselineByProvider) {
      if (providerScopeKey(providerId) === key) return count;
    }
    return 0;
  }

  private releaseFromBaseline(scope: DispatchScope): void {
    this.baselineGlobal = Math.max(0, this.baselineGlobal - 1);
    if (scope.hostId !== null) {
      const current = this.baselineByHost.get(scope.hostId) ?? 0;
      this.baselineByHost.set(scope.hostId, Math.max(0, current - 1));
    }
    if (scope.providerId !== null) {
      const current = this.baselineByProvider.get(scope.providerId) ?? 0;
      this.baselineByProvider.set(scope.providerId, Math.max(0, current - 1));
    }
  }
}
