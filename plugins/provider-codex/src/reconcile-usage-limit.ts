import type { ProviderRateLimitState } from "@get-bb/plugin-sdk/provider-bridge";

export function reconcileFreshCodexUsageLimit(
  rateLimits: ProviderRateLimitState,
  terminalUsageLimit: boolean,
  now: number,
): ProviderRateLimitState {
  if (
    !terminalUsageLimit ||
    rateLimits.status !== "warning" ||
    rateLimits.kind !== "subscription-window"
  )
    return rateLimits;
  const warnings = rateLimits.windows.filter(
    (window) => window.status === "warning",
  );
  if (
    warnings.length === 0 ||
    warnings.some(
      (window) =>
        window.resetsAtMs === null ||
        !Number.isFinite(window.resetsAtMs) ||
        window.resetsAtMs <= now,
    )
  )
    return rateLimits;
  return {
    ...rateLimits,
    status: "blocked",
    windows: rateLimits.windows.map((window) =>
      window.status === "warning" ? { ...window, status: "blocked" } : window,
    ),
  };
}
