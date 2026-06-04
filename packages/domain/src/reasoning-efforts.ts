import type { ModelReasoningEffort } from "./provider-types.js";

export const LOW_REASONING_EFFORT: ModelReasoningEffort = {
  reasoningEffort: "low",
  description: "Low reasoning effort",
};
export const MEDIUM_REASONING_EFFORT: ModelReasoningEffort = {
  reasoningEffort: "medium",
  description: "Medium reasoning effort",
};
export const HIGH_REASONING_EFFORT: ModelReasoningEffort = {
  reasoningEffort: "high",
  description: "High reasoning effort",
};
export const XHIGH_REASONING_EFFORT: ModelReasoningEffort = {
  reasoningEffort: "xhigh",
  description: "Extra high reasoning effort",
};
export const MAX_REASONING_EFFORT: ModelReasoningEffort = {
  reasoningEffort: "max",
  description: "Maximum reasoning effort",
};

export const ALL_REASONING_EFFORTS: readonly ModelReasoningEffort[] = [
  LOW_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  HIGH_REASONING_EFFORT,
  XHIGH_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
];

// Defensive copy so callers can hand out reasoning efforts in mutable API
// responses without aliasing the module-level constants above.
export function cloneReasoningEfforts(
  efforts: readonly ModelReasoningEffort[],
): ModelReasoningEffort[] {
  return efforts.map((effort) => ({ ...effort }));
}
