interface RequireEnabledQueryArgArgs<T> {
  value: T | null | undefined;
  hookName: string;
  argName: string;
}

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
