import type { PluginTurnFailedEvent } from "@get-bb/plugin-sdk";

export const RESET_BUFFER_MS = 15_000;

export const RESET_JITTER_MS = 30_000;

export const DEFAULT_MAXIMUM_WAIT_MS = 6 * 60 * 60 * 1_000;

export const OVERLOAD_RETRY_BASE_MS = 5_000;

export const MAX_RETRY_ATTEMPTS = 5;

export type RetryDeclineReason =
  | "not-retryable"
  | "no-rate-limit-state"
  | "not-resettable"
  | "beyond-maximum-wait"
  | "attempts-exhausted";

export type RetryDecision =
  | { kind: "decline"; reason: RetryDeclineReason }
  | {
      kind: "retry";
      sendAt: number;
      reason: "Rate limited" | "Provider overloaded";
    };

export interface RetryPolicyInput {
  failure: PluginTurnFailedEvent;
  maximumWaitMs: number | null;
  now: number;
  random: number;
}

export function blockedWindowResetAtMs(
  rateLimits: NonNullable<PluginTurnFailedEvent["rateLimits"]>,
): number | null {
  const blocked = rateLimits.windows.filter(
    (window) => window.status === "blocked",
  );
  const relevant = blocked.length > 0 ? blocked : rateLimits.windows;
  const resets = relevant.flatMap((window) =>
    window.resetsAtMs === null ? [] : [window.resetsAtMs],
  );
  return resets.length === 0 ? null : Math.max(...resets);
}

export function sendAtMs(args: {
  resetsAtMs: number;
  now: number;
  random: number;
}): number {
  const base = Math.max(args.resetsAtMs, args.now);
  return base + RESET_BUFFER_MS + Math.floor(args.random * RESET_JITTER_MS);
}

export function overloadedSendAtMs(args: {
  attemptNumber: number;
  now: number;
  random: number;
}): number {
  const delay = OVERLOAD_RETRY_BASE_MS * 2 ** (args.attemptNumber - 1);
  return args.now + delay + Math.floor(args.random * delay);
}

export function decideRetry(input: RetryPolicyInput): RetryDecision {
  const { failure } = input;
  if (failure.attemptNumber >= MAX_RETRY_ATTEMPTS) {
    return { kind: "decline", reason: "attempts-exhausted" };
  }
  if (failure.errorInfo?.category === "overloaded") {
    return {
      kind: "retry",
      sendAt: overloadedSendAtMs({
        attemptNumber: failure.attemptNumber,
        now: input.now,
        random: input.random,
      }),
      reason: "Provider overloaded",
    };
  }
  if (failure.errorInfo?.category !== "rate-limit") {
    return { kind: "decline", reason: "not-retryable" };
  }
  const rateLimits = failure.rateLimits;
  if (rateLimits === null || rateLimits.status !== "blocked") {
    return { kind: "decline", reason: "no-rate-limit-state" };
  }
  const resetsAtMs = blockedWindowResetAtMs(rateLimits);
  if (rateLimits.kind !== "subscription-window" || resetsAtMs === null) {
    return { kind: "decline", reason: "not-resettable" };
  }
  if (
    input.maximumWaitMs !== null &&
    resetsAtMs - input.now > input.maximumWaitMs
  ) {
    return { kind: "decline", reason: "beyond-maximum-wait" };
  }
  return {
    kind: "retry",
    sendAt: sendAtMs({
      resetsAtMs,
      now: input.now,
      random: input.random,
    }),
    reason: "Rate limited",
  };
}
