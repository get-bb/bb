import type { ProviderInfo } from "@bb/domain";
import type {
  ProviderUsage,
  ProviderUsageResponse,
  ProviderUsageWindow,
} from "@bb/host-daemon-contract";

/**
 * Presentation of `GET /system/usage-limits` (mirror of the pure parts of
 * apps/app/src/components/settings/UsageLimitsSettingsSection.tsx).
 */

export interface UsageProviderConfig {
  providerId: string;
  name: string;
  signInHint: string;
  expiredHint: string;
}

/**
 * Usage rows for the providers that declare usage, in picker order. Copy
 * comes from each provider's declared `strings`; a provider that declares
 * none gets generic copy built from its name.
 */
export function usageProviderConfigs(
  providers: readonly ProviderInfo[],
): UsageProviderConfig[] {
  return providers
    .filter((provider) => provider.experimental_providerUsage)
    .map((provider) => ({
      providerId: provider.id,
      name: provider.displayName,
      signInHint:
        provider.strings?.signInHint ??
        `Sign in to ${provider.displayName} on the machine, then reload usage.`,
      expiredHint:
        provider.strings?.expiredHint ??
        `Your ${provider.displayName} session expired. Sign in again on the machine, then reload usage.`,
    }));
}

/** Providers whose CLI is installed on the machine (the web hides `not_installed`). */
export function visibleUsageProviders(
  configs: readonly UsageProviderConfig[],
  usage: Partial<ProviderUsageResponse>,
): UsageProviderConfig[] {
  return configs.filter(
    (config) => usage[config.providerId]?.status !== "not_installed",
  );
}

export type UsageBarTone = "default" | "warning" | "destructive";

export function usageBarTone(usedPercent: number): UsageBarTone {
  if (usedPercent >= 95) return "destructive";
  if (usedPercent >= 80) return "warning";
  return "default";
}

/** "Resets in 25 min" / "Resets in 3 hr 5 min" / "Resetting now" / null (no date). */
export function formatUsageReset(
  resetsAt: string | null,
  now: number,
): string | null {
  if (!resetsAt) return null;
  const reset = new Date(resetsAt);
  if (Number.isNaN(reset.getTime())) return null;
  const diffMs = reset.getTime() - now;
  if (diffMs <= 0) return "Resetting now";
  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 60) return `Resets in ${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    const minutes = diffMinutes % 60;
    return minutes > 0
      ? `Resets in ${diffHours} hr ${minutes} min`
      : `Resets in ${diffHours} hr`;
  }
  const withinWeek = diffMs < 7 * 24 * 60 * 60_000;
  const formatted = reset.toLocaleString(undefined, {
    weekday: withinWeek ? "short" : undefined,
    month: withinWeek ? undefined : "short",
    day: withinWeek ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Resets ${formatted}`;
}

function formatUsdCents(cents: number, alwaysShowCents: boolean): string {
  const hasFractionalDollar = cents % 100 !== 0;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: alwaysShowCents || hasFractionalDollar ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** "42% used" or "$1.50 / $20" for a cost window. */
export function usageWindowValue(window: ProviderUsageWindow): string {
  if (!window.cost) return `${window.usedPercent}% used`;
  return `${formatUsdCents(window.cost.usedUsdCents, true)} / ${formatUsdCents(window.cost.limitUsdCents, false)}`;
}

export type UsageBody =
  | { kind: "windows"; windows: readonly ProviderUsageWindow[] }
  | { kind: "message"; text: string }
  | { kind: "none" };

/** What to render under a provider heading for its usage state. */
export function describeUsageBody(args: {
  config: UsageProviderConfig;
  usage: ProviderUsage | undefined;
  isLoading: boolean;
  isError: boolean;
}): UsageBody {
  const { config, usage, isLoading, isError } = args;
  if (isError) {
    return {
      kind: "message",
      text: "Couldn't load usage right now. Make sure the selected machine is connected, then reload usage.",
    };
  }
  if (!usage) {
    return {
      kind: "message",
      text: isLoading ? "Loading usage…" : "Usage unavailable.",
    };
  }
  switch (usage.status) {
    case "ok":
      return usage.windows.length === 0
        ? { kind: "message", text: "No usage limits reported for this plan." }
        : { kind: "windows", windows: usage.windows };
    case "not_installed":
      return { kind: "none" };
    case "unauthenticated":
      return { kind: "message", text: config.signInHint };
    case "expired":
      return { kind: "message", text: config.expiredHint };
    case "error":
      return { kind: "message", text: usage.message };
  }
}

/** Plan badge and account line for a provider heading. */
export function usageHeading(usage: ProviderUsage | undefined): {
  planLabel: string | null;
  accountEmail: string | null;
} {
  if (!usage) return { planLabel: null, accountEmail: null };
  if (usage.status === "ok" || usage.status === "error") {
    return {
      planLabel: usage.planLabel,
      accountEmail: usage.accountEmail,
    };
  }
  return { planLabel: null, accountEmail: null };
}
