/**
 * Staleness window for prompt-history queries. Shared by the thread- and
 * project-scoped variants so they age out their cached suggestions together.
 */
export const PROMPT_HISTORY_STALE_TIME_MS = 10_000;

interface RequireEnabledQueryArgArgs<T> {
  value: T | null | undefined;
  hookName: string;
  argName: string;
}

/**
 * Asserts a query argument is present once its query is enabled. Query hooks
 * gate `enabled` on their id/arg being set, so the queryFn only runs with a
 * real value — this turns that invariant into a typed non-null at the call
 * site, and throws (rather than firing a request with a missing arg) if the
 * invariant is ever violated. Treats empty string as missing so a blank id is
 * rejected the same as null/undefined; a numeric `0` is kept.
 */
export function requireEnabledQueryArg<T>({
  value,
  hookName,
  argName,
}: RequireEnabledQueryArgArgs<T>): T {
  if (value == null || value === "") {
    throw new Error(`${hookName}: ${argName} is required when query is enabled`);
  }
  return value;
}
