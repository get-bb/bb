import { isAgentProviderId } from "@bb/agent-providers";
import type { ReasoningLevel } from "@bb/domain";

type ReasoningPolicyProviderId = "claude-code" | "codex" | "pi";

const SUPPORTED_REASONING_LEVELS_BY_PROVIDER: Record<
  ReasoningPolicyProviderId,
  readonly ReasoningLevel[]
> = {
  "claude-code": ["low", "medium", "high", "xhigh", "ultracode", "max"],
  codex: ["low", "medium", "high", "xhigh"],
  pi: ["low", "medium", "high", "xhigh"],
};

/**
 * The coarse, per-provider reasoning levels. Used as a fallback when a precise
 * per-model `supportedReasoningEfforts` set is unavailable (e.g. validating a
 * reasoning override against a legacy/selected-only model not in the active
 * catalog). Returns an empty list for unknown providers.
 */
export function getSupportedReasoningLevelsForProvider(
  providerId: string,
): readonly ReasoningLevel[] {
  if (!isAgentProviderId(providerId)) {
    return [];
  }
  return SUPPORTED_REASONING_LEVELS_BY_PROVIDER[providerId];
}
