import { z } from "zod";

const usageWindowSchema = z.object({
  label: z.string(),
  usedPercent: z.number(),
  resetsAt: z.string().nullable(),
  model: z.string().min(1).nullish(),
});

export interface ExhaustedUsageWindow {
  label: string;
  resetsAt: string | null;
}

export function hasFullModelWindow(windows: readonly unknown[]): boolean {
  return windows.some((raw) => {
    const parsed = usageWindowSchema.safeParse(raw);
    return (
      parsed.success &&
      typeof parsed.data.model === "string" &&
      parsed.data.usedPercent >= 100
    );
  });
}

export function findExhaustedUsageWindow(
  windows: readonly unknown[],
  args: { model: string | null; now: number },
): ExhaustedUsageWindow | null {
  for (const raw of windows) {
    const parsed = usageWindowSchema.safeParse(raw);
    if (!parsed.success) continue;
    const window = parsed.data;
    if (window.usedPercent < 100) continue;
    const resetsAtMs =
      window.resetsAt === null ? Number.NaN : Date.parse(window.resetsAt);
    if (Number.isFinite(resetsAtMs) && resetsAtMs <= args.now) continue;
    if (
      typeof window.model === "string" &&
      (args.model === null ||
        !args.model.toLowerCase().includes(window.model.toLowerCase()))
    ) {
      continue;
    }
    return { label: window.label, resetsAt: window.resetsAt };
  }
  return null;
}

const UNUSABLE_FALLBACK_STATUSES: ReadonlySet<string> = new Set([
  "not_installed",
  "unauthenticated",
  "expired",
]);

export interface ProviderFallbackUsage {
  status: string;
  windows?: readonly unknown[];
}

export interface ProviderFallbackDecision {
  providerId: string;
  fromProviderId: string;
  exhausted: ExhaustedUsageWindow;
}

export function decideProviderFallback(args: {
  providerId: string;
  model: string | null;
  fallbackProviderId: string | null;
  fallbackSelectable: boolean;
  providerUsage: ProviderFallbackUsage | null;
  fallbackUsage: ProviderFallbackUsage | null;
  now: number;
}): ProviderFallbackDecision | null {
  if (
    args.fallbackProviderId === null ||
    args.fallbackProviderId === args.providerId ||
    !args.fallbackSelectable ||
    args.providerUsage?.status !== "ok"
  ) {
    return null;
  }
  const exhausted = findExhaustedUsageWindow(args.providerUsage.windows ?? [], {
    model: args.model,
    now: args.now,
  });
  if (exhausted === null) return null;
  if (
    args.fallbackUsage !== null &&
    UNUSABLE_FALLBACK_STATUSES.has(args.fallbackUsage.status)
  ) {
    return null;
  }
  if (
    args.fallbackUsage?.status === "ok" &&
    findExhaustedUsageWindow(args.fallbackUsage.windows ?? [], {
      model: null,
      now: args.now,
    }) !== null
  ) {
    return null;
  }
  return {
    providerId: args.fallbackProviderId,
    fromProviderId: args.providerId,
    exhausted,
  };
}
