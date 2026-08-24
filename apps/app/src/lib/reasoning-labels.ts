import type { ProviderInfo, ReasoningLevel } from "@bb/domain";

/**
 * Fallback labels for the coarse reasoning ladder, used only when the
 * provider declared no `reasoningLevels` (a server from before providers
 * declared them, or a dynamic provider that projects none). A registered
 * provider's declaration is the source of truth: the same ids read "Quick"
 * and "Deep" on one provider and "Low" and "High" on another.
 */
const FALLBACK_REASONING_LABELS: Record<ReasoningLevel, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  ultracode: "Ultracode",
  max: "Max",
  ultra: "Ultra",
};

/** Picker options the provider declared for a level, keyed by level id. */
export type ReasoningLabelSource = Pick<ProviderInfo, "reasoningLevels">;

/**
 * The picker label for a reasoning level on a provider: the provider's
 * declared label, else the fallback table, else the id itself (an id the
 * ladder schema gained after this client shipped).
 */
export function reasoningLevelLabel(
  level: ReasoningLevel,
  provider: ReasoningLabelSource | undefined,
): string {
  const declared = provider?.reasoningLevels?.find(
    (option) => option.id === level,
  );
  return declared?.label ?? FALLBACK_REASONING_LABELS[level] ?? level;
}

/** The tier id bb's execution options send when fast mode is on. */
const FAST_SERVICE_TIER_ID = "fast";

/**
 * The label the provider declared for its fast service tier ("Fast" on the
 * first-party providers; a third party may say "Priority"). The toggle reads
 * `<label> mode`. Falls back to "Fast" for providers that declared no tiers.
 */
export function fastServiceTierLabel(
  provider: Pick<ProviderInfo, "serviceTiers"> | undefined,
): string {
  return (
    provider?.serviceTiers?.find((tier) => tier.id === FAST_SERVICE_TIER_ID)
      ?.label ?? "Fast"
  );
}
