interface RequireEnabledQueryArgArgs<T> {
  value: T | null | undefined;
  hookName: string;
  argName: string;
}

/**
 * Asserts a query argument is present once its query is enabled. Hooks gate
 * `enabled` on the arg being set, so the queryFn only runs with a real value;
 * this turns that invariant into a typed non-null at the call site and throws
 * (rather than firing a request with a missing arg) if it is ever violated.
 * Empty string counts as missing.
 */
export function requireEnabledQueryArg<T>({
  value,
  hookName,
  argName,
}: RequireEnabledQueryArgArgs<T>): T {
  if (value == null || value === "") {
    throw new Error(
      `${hookName}: ${argName} is required when query is enabled`,
    );
  }
  return value;
}
