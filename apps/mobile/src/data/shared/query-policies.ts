/**
 * Named query policies (mirrors apps/app/src/hooks/queries/query-policies.ts).
 * Prefer one of these over open-coding refetch/stale-time combinations so the
 * cache lifecycle choice is visible at the hook call site.
 */

const SERVER_SESSION_STALE_TIME_MS = 60 * 60_000;
const FOCUS_OWNED_LIVE_STALE_TIME_MS = 30_000;
const FAST_FOCUS_OWNED_LIVE_STALE_TIME_MS = 5_000;
const TYPEAHEAD_STALE_TIME_MS = 15_000;

/** Never refetches on its own; only an explicit invalidation refreshes it. */
export const SESSION_STATIC_QUERY_POLICY = {
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  staleTime: Infinity,
} as const;

/** Slow-moving server facts (version): an hour fresh, no focus refetch. */
export const SERVER_SESSION_QUERY_POLICY = {
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  staleTime: SERVER_SESSION_STALE_TIME_MS,
} as const;

export const FOCUS_OWNED_LIVE_QUERY_POLICY = {
  refetchOnReconnect: true,
  refetchOnWindowFocus: true,
  staleTime: FOCUS_OWNED_LIVE_STALE_TIME_MS,
} as const;

export const FAST_FOCUS_OWNED_LIVE_QUERY_POLICY = {
  refetchOnReconnect: true,
  refetchOnWindowFocus: true,
  staleTime: FAST_FOCUS_OWNED_LIVE_STALE_TIME_MS,
} as const;

/** Suggestion lists: never retry, never refetch on focus, cache briefly. */
export const TYPEAHEAD_QUERY_POLICY = {
  refetchOnWindowFocus: false,
  retry: false,
  staleTime: TYPEAHEAD_STALE_TIME_MS,
} as const;

/** Realtime invalidation owns freshness; the cache never goes stale by age. */
export const REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY = {
  staleTime: Infinity,
} as const;

/**
 * Realtime owns freshness, but a subscription may have lapsed while nothing
 * was listening: a (re)mount establishes a fresh baseline instead of trusting
 * cached data (web `REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY`).
 */
export const REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY = {
  refetchOnMount: "always",
  refetchOnWindowFocus: false,
} as const;

/** Expensive reads refreshed by explicit invalidation, never by focus. */
export const EXPENSIVE_MANUAL_QUERY_POLICY = {
  refetchOnWindowFocus: false,
} as const;

/**
 * Heavy per-thread payloads (file previews, diff patches) are only useful
 * while their consumer is on screen: one minute after the last observer
 * leaves is enough for a quick back-and-forth and keeps a browsing session's
 * memory bounded (web `HEAVY_PAYLOAD_QUERY_POLICY`).
 */
const HEAVY_PAYLOAD_GC_TIME_MS = 60_000;

export const HEAVY_PAYLOAD_QUERY_POLICY = {
  gcTime: HEAVY_PAYLOAD_GC_TIME_MS,
} as const;
