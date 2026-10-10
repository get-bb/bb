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

const SHARED_LABEL_PREFIX_SEPARATOR = ": ";

export function reasoningLadderLabels(
  efforts: readonly Pick<ModelReasoningEffort, "reasoningEffort" | "label">[],
  provider: ReasoningLabelSource | undefined,
): string[] {
  const labels = efforts.map((effort) =>
    reasoningLevelLabel(effort.reasoningEffort, provider, effort),
  );
  const first = labels[0];
  if (first === undefined || labels.length < 2) {
    return labels;
  }
  const separatorIndex = first.indexOf(SHARED_LABEL_PREFIX_SEPARATOR);
  if (separatorIndex <= 0) {
    return labels;
  }
  const prefix = first.slice(
    0,
    separatorIndex + SHARED_LABEL_PREFIX_SEPARATOR.length,
  );
  const stripped = labels.map((label, index) => {
    if (!label.startsWith(prefix)) {
      return "";
    }
    const rest = label.slice(prefix.length).trim();
    const level = efforts[index]?.reasoningEffort;
    if (
      level !== undefined &&
      isStandardReasoningLevel(level) &&
      rest.toLowerCase() === level
    ) {
      return STANDARD_REASONING_LABELS[level];
    }
    return `${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
  });
  return stripped.includes("") || new Set(stripped).size !== stripped.length
    ? labels
    : stripped;
}
