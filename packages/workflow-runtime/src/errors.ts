// Retry policy for provider-level agent failures, ported from omegacode/src/worker/errors.ts.
// Classification lives on AgentError itself (`retryable`): workers mark transient provider
// failures (429/overload/process exit) retryable; everything else is terminal.

import { AgentError, AgentInterrupted } from "./worker-contract.js";

export interface WithRetryOptions {
  signal: AbortSignal;
  /** Total attempts, including the first call (default 4). */
  attempts?: number;
  /** Delay before the first retry, in milliseconds (default 1000); doubles per retry. */
  baseMs?: number;
  /** Ceiling on a single backoff delay, in milliseconds (default 30000). */
  maxMs?: number;
}

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BASE_MS = 1_000;
const DEFAULT_MAX_MS = 30_000;

/**
 * Run `fn`, retrying retryable `AgentError`s with exponential backoff. Anything else — a terminal
 * `AgentError`, `AgentInterrupted`, a plain error — rethrows immediately, and the last attempt's
 * error rethrows once attempts are exhausted. An aborted signal (observed before an attempt or
 * during a backoff sleep) raises `AgentInterrupted`.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions,
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const baseMs = options.baseMs ?? DEFAULT_BASE_MS;
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  const { signal } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal.aborted) throw new AgentInterrupted();
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof AgentError) ||
        !error.retryable ||
        attempt === attempts - 1
      ) {
        throw error;
      }
      await sleep(Math.min(maxMs, baseMs * 2 ** attempt), signal);
    }
  }
  throw lastError;
}

/**
 * Abort-aware sleep; rejects with AgentInterrupted when the signal fires (or already fired).
 * Implemented over the global `setTimeout` (not node:timers/promises) so fake timers apply.
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AgentInterrupted());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AgentInterrupted());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
