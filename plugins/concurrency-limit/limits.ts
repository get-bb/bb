// Settings parsing.
//
// Plugin settings descriptors are plain data with four types — string,
// boolean, select and project. There is no numeric type, so each limit here
// is a *string* the plugin parses itself. That makes the parse the plugin's
// job and a bad value the plugin's problem: an unparseable limit is reported
// through `bb.status.needsConfiguration` and the gate proceeds unlimited
// rather than silently clamping to some invented number.

/** A parsed limit setting. `unlimited` is what an empty string means. */
export type LimitSetting =
  | { kind: "unlimited" }
  | { kind: "limit"; value: number }
  | { kind: "invalid"; message: string };

/**
 * The largest limit worth accepting. Anything above this is indistinguishable
 * from "no limit" in practice and is far more likely to be a typo (a pasted
 * timestamp, an extra digit) than an intent, so it is rejected loudly instead
 * of accepted as a limit that can never bind.
 */
const MAX_LIMIT_VALUE = 10_000;

const WHOLE_NUMBER = /^\d+$/;

/**
 * Parse a thread-count limit. Empty (or whitespace-only) is unlimited, which
 * is the default for both limits — installing this plugin must not change how
 * anything dispatches until the user sets a number.
 *
 * `0` is deliberately accepted: "hold everything" is a real, useful setting
 * (an org-wide pause), and rejecting it would force the user to uninstall the
 * plugin to express it.
 */
export function parseLimitSetting(raw: string, label: string): LimitSetting {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "unlimited" };
  if (!WHOLE_NUMBER.test(trimmed)) {
    return {
      kind: "invalid",
      message: `${label} must be a whole number of threads (for example 4), or empty for no limit. Got "${raw}".`,
    };
  }
  const value = Number(trimmed);
  if (value > MAX_LIMIT_VALUE) {
    return {
      kind: "invalid",
      message: `${label} must be ${MAX_LIMIT_VALUE} or fewer threads, or empty for no limit. Got "${raw}".`,
    };
  }
  return { kind: "limit", value };
}

/** Both knobs this plugin reads, already parsed. */
export interface ResolvedLimits {
  /** Across every host. */
  global: number | null;
  /** Per host, applied to the host a dispatch would run on. */
  perHost: number | null;
}

export interface ResolveLimitsResult {
  limits: ResolvedLimits;
  /** One message per unparseable setting, for `status.needsConfiguration`. */
  problems: string[];
}

/** The labels users see, reused verbatim in validation messages. */
export const SETTING_LABELS = {
  maxConcurrentThreads: "Max concurrent threads",
  maxConcurrentThreadsPerHost: "Max concurrent threads per host",
} as const;

export interface RawLimitSettings {
  maxConcurrentThreads: string;
  maxConcurrentThreadsPerHost: string;
}

/**
 * Parse the whole settings record. An invalid setting resolves to `null` (that
 * limit is not enforced) *and* contributes a problem message — the plugin
 * refuses to guess, and the user is told exactly which field to fix. This is
 * the safe direction to fail: gates are fail-closed on throw, so a limiter
 * that threw on a typo would block every dispatch in the server until someone
 * found the setting.
 */
export function resolveLimits(raw: RawLimitSettings): ResolveLimitsResult {
  const problems: string[] = [];

  const take = (setting: LimitSetting): number | null => {
    if (setting.kind === "invalid") {
      problems.push(setting.message);
      return null;
    }
    return setting.kind === "limit" ? setting.value : null;
  };

  const limits: ResolvedLimits = {
    global: take(
      parseLimitSetting(
        raw.maxConcurrentThreads,
        SETTING_LABELS.maxConcurrentThreads,
      ),
    ),
    perHost: take(
      parseLimitSetting(
        raw.maxConcurrentThreadsPerHost,
        SETTING_LABELS.maxConcurrentThreadsPerHost,
      ),
    ),
  };

  return { limits, problems };
}

/** True when neither setting asks this plugin to do anything at all. */
export function isFullyUnlimited(limits: ResolvedLimits): boolean {
  return limits.global === null && limits.perHost === null;
}
