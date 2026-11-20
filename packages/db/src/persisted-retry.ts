export function nextPersistedRetryAt(
  retryDelaysMs: readonly number[],
  attempts: number,
  now: number,
): number | null {
  const delayMs = retryDelaysMs[Math.max(1, attempts) - 1];
  return delayMs === undefined ? null : now + delayMs;
}

export function persistedRetryExhausted(
  retryDelaysMs: readonly number[],
  attempts: number,
): boolean {
  return attempts > retryDelaysMs.length;
}
