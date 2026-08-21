import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Timeline-window refetch pacing (mirrors the `events-appended` handling in
 * apps/app/src/hooks/cache-owners/realtime-cache-registry.ts).
 *
 * A streaming turn appends events many times a second. Invalidating the
 * timeline query the default way would abort the in-flight `afterSequence`
 * read on every batch and restart it, so the window would never land. Instead
 * an append invalidates *without* cancelling the active fetch and, if one was
 * in flight, schedules exactly one trailing refetch for when it settles — so
 * an event that raced the read is not lost. The trailing refetch waits out the
 * observed fetch duration (floored/capped) so a slow server-side projection is
 * not rebuilt at a 100% duty cycle.
 *
 * A terminal event (`turn/completed`) is rare and authoritative: it cancels
 * the stale in-turn read and refetches the completed shape immediately.
 */

const TRAILING_REFETCH_MIN_INTERVAL_MS = 50;
const TRAILING_REFETCH_MAX_INTERVAL_MS = 1_000;

export function resolveTrailingRefetchDelayMs(
  observedFetchDurationMs: number,
): number {
  return Math.min(
    TRAILING_REFETCH_MAX_INTERVAL_MS,
    Math.max(TRAILING_REFETCH_MIN_INTERVAL_MS, observedFetchDurationMs),
  );
}

const trailingRefetchCancellers = new WeakMap<
  QueryClient,
  Map<string, () => void>
>();

function scheduleKeyOf(queryKey: QueryKey): string {
  return JSON.stringify(queryKey);
}

function cancellersFor(queryClient: QueryClient): Map<string, () => void> {
  let cancellers = trailingRefetchCancellers.get(queryClient);
  if (!cancellers) {
    cancellers = new Map();
    trailingRefetchCancellers.set(queryClient, cancellers);
  }
  return cancellers;
}

function hasActiveFetchingQueries(
  queryClient: QueryClient,
  queryKey: QueryKey,
): boolean {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey, type: "active" })
    .some((query) => query.state.fetchStatus !== "idle");
}

function scheduleTrailingActiveRefetch(
  queryClient: QueryClient,
  queryKey: QueryKey,
): void {
  const cancellers = cancellersFor(queryClient);
  const scheduleKey = scheduleKeyOf(queryKey);
  if (cancellers.has(scheduleKey)) return;

  // Measured within this cycle only (from now — a fetch is in flight, that is
  // why we were scheduled — until it settles), never across cycles, which
  // would fold the previous delay into the next and grow geometrically.
  const waitingSince = Date.now();
  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    if (hasActiveFetchingQueries(queryClient, queryKey)) return;
    unsubscribe();
    const delayMs = resolveTrailingRefetchDelayMs(Date.now() - waitingSince);
    const timer = setTimeout(() => {
      cancellers.delete(scheduleKey);
      void queryClient
        .refetchQueries({ queryKey, type: "active" }, { cancelRefetch: false })
        .catch(() => {
          // The query state already records the failure.
        });
    }, delayMs);
    // Swap the (already called) unsubscriber for a timer canceller so a
    // dispose cannot refetch into a torn-down client.
    cancellers.set(scheduleKey, () => clearTimeout(timer));
  });
  cancellers.set(scheduleKey, unsubscribe);
}

function cancelTrailingActiveRefetch(
  queryClient: QueryClient,
  queryKey: QueryKey,
): void {
  const cancellers = trailingRefetchCancellers.get(queryClient);
  if (!cancellers) return;
  const scheduleKey = scheduleKeyOf(queryKey);
  cancellers.get(scheduleKey)?.();
  cancellers.delete(scheduleKey);
  if (cancellers.size === 0) trailingRefetchCancellers.delete(queryClient);
}

/**
 * `events-appended`: mark stale, keep the in-flight read, and queue one
 * trailing refetch if a read was active.
 */
export function invalidateTimelineQueryKeyPaced(
  queryClient: QueryClient,
  queryKey: QueryKey,
): void {
  const hadActiveFetch = hasActiveFetchingQueries(queryClient, queryKey);
  void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
  if (hadActiveFetch) scheduleTrailingActiveRefetch(queryClient, queryKey);
}

/**
 * `turn/completed`: drop the stale in-turn read and the trailing refetch it
 * may have queued, then fetch the completed-turn projection right away.
 */
export function invalidateTimelineQueryKeyTerminal(
  queryClient: QueryClient,
  queryKey: QueryKey,
): void {
  cancelTrailingActiveRefetch(queryClient, queryKey);
  void queryClient.cancelQueries({ queryKey });
  void queryClient.invalidateQueries({ queryKey });
}

export function disposeTrailingActiveRefetches(queryClient: QueryClient): void {
  const cancellers = trailingRefetchCancellers.get(queryClient);
  if (!cancellers) return;
  for (const cancel of cancellers.values()) cancel();
  trailingRefetchCancellers.delete(queryClient);
}
