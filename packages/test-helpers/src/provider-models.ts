import type { AvailableModel } from "@bb/domain";

const PREFERRED_TEST_MODELS_BY_PROVIDER: Record<string, readonly string[]> = {
  codex: ["gpt-5.4"],
  "claude-code": ["claude-haiku-4-5"],
  pi: [
    "openai-codex/gpt-5.5",
    "openai-codex/gpt-5.4",
    "openai-codex/gpt-5.4-mini",
    "openai-codex/gpt-5.3-codex",
    "anthropic/claude-haiku-4-5",
    "anthropic/claude-opus-4-8",
    "anthropic/claude-opus-4-7",
  ],
};

interface ResolvePreferredTestModelArgs {
  models: AvailableModel[];
  providerId: string;
}

export function listPreferredTestModels(providerId: string): readonly string[] {
  return PREFERRED_TEST_MODELS_BY_PROVIDER[providerId] ?? [];
}

export function resolvePreferredTestModel(
  args: ResolvePreferredTestModelArgs,
): string | null {
  const preferredModels = listPreferredTestModels(args.providerId);
  for (const preferredModel of preferredModels) {
    const matchingModel = args.models.find(
      (availableModel) => availableModel.model === preferredModel,
    );
    if (matchingModel) {
      return matchingModel.model;
    }
  }

  return (
    args.models.find((availableModel) => availableModel.isDefault)?.model ??
    args.models[0]?.model ??
    null
  );
}
