import type { AvailableModel, ReasoningLevel } from "@bb/domain";

export interface AvailableModelFixtureArgs {
  model: string;
  reasoningLevels?: readonly ReasoningLevel[];
  defaultReasoningLevel?: ReasoningLevel;
  isDefault?: boolean;
}

export function availableModelFixture({
  model,
  reasoningLevels = ["low"],
  defaultReasoningLevel = reasoningLevels[0] ?? "low",
  isDefault = false,
}: AvailableModelFixtureArgs): AvailableModel {
  return {
    id: model,
    model,
    displayName: model,
    description: "",
    supportedReasoningEfforts: reasoningLevels.map((reasoningEffort) => ({
      reasoningEffort,
      description: "",
    })),
    defaultReasoningEffort: defaultReasoningLevel,
    isDefault,
  };
}
