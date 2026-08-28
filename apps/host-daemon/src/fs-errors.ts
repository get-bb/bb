export function isFsErrorWithCode<ErrorInput>(
  error: ErrorInput,
  code: string,
): error is ErrorInput & NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
