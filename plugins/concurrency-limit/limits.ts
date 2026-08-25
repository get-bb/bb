// Settings parsing.
//
// Plugin settings descriptors are plain data with four types — string,
// boolean, select and project. There is no numeric type, so every limit here
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
export const MAX_LIMIT_VALUE = 10_000;

const WHOLE_NUMBER = /^\d+$/;

/**
 * Parse a thread-count limit. Empty (or whitespace-only) is unlimited, which
 * is the default for all three limits — installing this plugin must not change
 * how anything dispatches until the user sets a number.
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

/**
 * Parse a percentage threshold (CPU or memory). Empty is off. `0` is rejected
 * here even though it is accepted for thread counts: a 0% threshold means
 * "hold whenever the machine has any load at all", which is never what someone
 * types on purpose, and unlike a 0 thread limit it is not expressible any
 * other way to mean something useful.
 */
export function parsePercentSetting(raw: string, label: string): LimitSetting {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "unlimited" };
  if (!WHOLE_NUMBER.test(trimmed)) {
    return {
      kind: "invalid",
      message: `${label} must be a whole percentage between 1 and 100 (for example 85), or empty to turn it off. Got "${raw}".`,
    };
  }
  const value = Number(trimmed);
  if (value < 1 || value > 100) {
    return {
      kind: "invalid",
      message: `${label} must be between 1 and 100, or empty to turn it off. Got "${raw}".`,
    };
  }
  return { kind: "limit", value };
}

/** Every knob this plugin reads, already parsed. */
export interface ResolvedLimits {
  /** Across every host and provider. */
  global: number | null;
  /** Per host, applied to the host a dispatch would run on. */
  perHost: number | null;
  /** Per provider, applied to the dispatch's provider. */
  perProvider: number | null;
  /** Hold when the target host's CPU is at or above this percentage. */
  maxCpuPercent: number | null;
  /** Hold when the target host's memory use is at or above this percentage. */
  maxMemoryPercent: number | null;
  /**
   * When false (the default) a child thread is neither counted nor limited.
   * See `isExemptDispatch` for why that default is not negotiable.
   */
  includeChildThreads: boolean;
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
  maxConcurrentThreadsPerProvider: "Max concurrent threads per provider",
  maxHostCpuPercent: "Hold above host CPU %",
  maxHostMemoryPercent: "Hold above host memory %",
} as const;

export interface RawLimitSettings {
  maxConcurrentThreads: string;
  maxConcurrentThreadsPerHost: string;
  maxConcurrentThreadsPerProvider: string;
  maxHostCpuPercent: string;
  maxHostMemoryPercent: string;
  includeChildThreads: boolean;
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

  const take = (
    setting: LimitSetting,
  ): number | null => {
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
    perProvider: take(
      parseLimitSetting(
        raw.maxConcurrentThreadsPerProvider,
        SETTING_LABELS.maxConcurrentThreadsPerProvider,
      ),
    ),
    maxCpuPercent: take(
      parsePercentSetting(
        raw.maxHostCpuPercent,
        SETTING_LABELS.maxHostCpuPercent,
      ),
    ),
    maxMemoryPercent: take(
      parsePercentSetting(
        raw.maxHostMemoryPercent,
        SETTING_LABELS.maxHostMemoryPercent,
      ),
    ),
    includeChildThreads: raw.includeChildThreads,
  };

  return { limits, problems };
}

/** True when no setting asks this plugin to do anything at all. */
export function isFullyUnlimited(limits: ResolvedLimits): boolean {
  return (
    limits.global === null &&
    limits.perHost === null &&
    limits.perProvider === null &&
    limits.maxCpuPercent === null &&
    limits.maxMemoryPercent === null
  );
}

/** True when either load threshold is set, which is what makes host polling worth doing. */
export function needsLoadSampling(limits: ResolvedLimits): boolean {
  return limits.maxCpuPercent !== null || limits.maxMemoryPercent !== null;
}
