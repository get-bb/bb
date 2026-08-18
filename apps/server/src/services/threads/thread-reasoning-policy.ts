import type { ReasoningLevel } from "@bb/domain";
import type { ProviderRegistryService } from "../providers/provider-registry.js";

/**
 * The coarse, per-provider reasoning levels. Used as a fallback when a precise
 * per-model `supportedReasoningEfforts` set is unavailable (e.g. validating a
 * reasoning override against a legacy/selected-only model not in the active
 * catalog). Returns an empty list for unknown providers. The per-provider
 * ladder itself is declared in the provider registry.
 */
export function getSupportedReasoningLevelsForProvider(
  registry: ProviderRegistryService,
  providerId: string,
): readonly ReasoningLevel[] {
  return registry.getServerCapabilities(providerId)?.reasoningLevels ?? [];
}
