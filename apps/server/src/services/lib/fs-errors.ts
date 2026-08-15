/**
 * Type guard for Node fs errors. Takes `unknown` so callers don't need their
 * own `instanceof Error` pre-check, and narrows to ErrnoException on success.
 */
export function isFsErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
