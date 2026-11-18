import { nextPersistedRetryAt, persistedRetryExhausted } from "@bb/db";

const MINUTE_MS = 60_000;

export const TEARDOWN_RETRY_DELAYS_MS: readonly number[] = [
  MINUTE_MS,
  2 * MINUTE_MS,
  4 * MINUTE_MS,
  8 * MINUTE_MS,
];

export const NEEDS_RECOVERY_RETRY_INTERVAL_MS = 60 * MINUTE_MS;

export const SWEEP_ITEM_RETRY_DELAYS_MS: readonly number[] = [
  MINUTE_MS,
  2 * MINUTE_MS,
  4 * MINUTE_MS,
  8 * MINUTE_MS,
  16 * MINUTE_MS,
  32 * MINUTE_MS,
  60 * MINUTE_MS,
];

export const QUEUED_MESSAGE_RETRY_DELAYS_MS: readonly number[] = [
  15_000,
  MINUTE_MS,
  5 * MINUTE_MS,
];

export function nextSlowPersistedRetryAt(
  retryDelaysMs: readonly number[],
  attempts: number,
  now: number,
): number {
  return (
    nextPersistedRetryAt(retryDelaysMs, attempts, now) ??
    now + NEEDS_RECOVERY_RETRY_INTERVAL_MS
  );
}

const NEEDS_RECOVERY_PREFIX = "Needs recovery:";

export function needsRecoveryMessage(
  failure: string,
  recovery: string | null,
): string {
  const sentence = /[.!?]$/u.test(failure) ? failure : `${failure}.`;
  return recovery === null
    ? `${NEEDS_RECOVERY_PREFIX} ${sentence}`
    : `${NEEDS_RECOVERY_PREFIX} ${sentence} ${recovery}`;
}

export function teardownNeedsRecovery(teardown: {
  teardownAttempt: number;
  teardownStatus: string | null;
}): boolean {
  return (
    teardown.teardownStatus === "failed" &&
    persistedRetryExhausted(TEARDOWN_RETRY_DELAYS_MS, teardown.teardownAttempt)
  );
}
