import {
  isStandardReasoningLevel,
  type ModelReasoningEffort,
  type ProviderInfo,
  type ReasoningLevel,
  type StandardReasoningLevel,
} from "@bb/domain";

const STANDARD_REASONING_LABELS: Record<StandardReasoningLevel, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  ultracode: "Ultracode",
  max: "Max",
  ultra: "Ultra",
};

export type ReasoningLabelSource = Pick<ProviderInfo, "reasoningLevels">;

function providerSpecificReasoningLabel(level: ReasoningLevel): string {
  const words = level.split(/[\s_-]+/u).filter((word) => word !== "");
  return words.length === 0
    ? level
    : words
        .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
        .join(" ");
}

export function reasoningLevelLabel(
  level: ReasoningLevel,
  provider: ReasoningLabelSource | undefined,
  effort?: Pick<ModelReasoningEffort, "label">,
): string {
  if (effort?.label !== undefined) {
    return effort.label;
  }
  const declared = provider?.reasoningLevels?.find(
    (option) => option.id === level,
  );
  if (declared?.label !== undefined) {
    return declared.label;
  }
  return isStandardReasoningLevel(level)
    ? STANDARD_REASONING_LABELS[level]
    : providerSpecificReasoningLabel(level);
}
