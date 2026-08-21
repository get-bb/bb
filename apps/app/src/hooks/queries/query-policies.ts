/**
 * Named query policies keep cache lifecycle choices explicit at hook call
 * sites. Prefer one of these over open-coding refetch/stale-time combinations
 * unless a query has genuinely one-off behavior.
 */

const SERVER_SESSION_STALE_TIME_MS = 60 * 60_000;
const FOCUS_OWNED_LIVE_STALE_TIME_MS = 30_000;
const TYPEAHEAD_STALE_TIME_MS = 15_000;

export const SESSION_STATIC_QUERY_POLICY = {
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  staleTime: Infinity,
} as const;

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

export const RESUME_REFETCH_QUERY_POLICY = {
  refetchOnReconnect: true,
  refetchOnWindowFocus: true,
} as const;

export const TYPEAHEAD_QUERY_POLICY = {
  refetchOnWindowFocus: false,
  retry: false,
  staleTime: TYPEAHEAD_STALE_TIME_MS,
} as const;

export const EXPENSIVE_MANUAL_QUERY_POLICY = {
  refetchOnWindowFocus: false,
} as const;

export const REALTIME_OWNED_NO_FOCUS_QUERY_POLICY = {
  refetchOnWindowFocus: false,
} as const;

export const REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY = {
  staleTime: Infinity,
} as const;

export const REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY = {
  refetchOnMount: "always",
  refetchOnWindowFocus: false,
} as const;

/**
 * Heavy per-thread payloads (turn-summary details, file previews, diff
 * patches) are read once and then only useful while their consumer is on
 * screen. The default five-minute `gcTime` kept several such payloads per
 * visited thread resident, which on phones is memory the timeline and the
 * next thread need. One minute after the last observer leaves is enough for a
 * quick back-and-forth and short enough that a browsing session stays bounded.
 * Timeline windows are deliberately NOT on this tier: delta refetch depends on
 * the cached window surviving a thread leave.
 */
export const HEAVY_PAYLOAD_GC_TIME_MS = 60_000;

export const HEAVY_PAYLOAD_QUERY_POLICY = {
  gcTime: HEAVY_PAYLOAD_GC_TIME_MS,
} as const;
