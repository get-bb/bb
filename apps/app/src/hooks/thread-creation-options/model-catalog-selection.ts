import {
  reconcileReasoningLevel,
  type AvailableModel,
  type ProviderInfo,
  type ReasoningLevel,
} from "@bb/domain";
import type { ModelPickerOption } from "@/components/pickers/model-picker-option";
import type { PickerOption } from "@/components/pickers/OptionPicker";
import { reasoningLevelLabel } from "@/lib/reasoning-labels";

type ModelCatalogProvider = Pick<ProviderInfo, "id" | "reasoningLevels">;

interface ResolveModelCatalogSelectionArgs {
  models: readonly AvailableModel[];
  selectedOnlyModels: readonly AvailableModel[];
  selectedModel: string;
  preferredReasoningLevel?: ReasoningLevel;
  provider: ModelCatalogProvider | undefined;
  catalogIsVerified: boolean;
  formatModelLabel: (displayName: string) => string;
}

interface ResolvedModelCatalogSelection {
  selectedModel: string;
  activeModel: AvailableModel | undefined;
  modelOptions: ModelPickerOption[];
  moreModelOptions: ModelPickerOption[];
  reasoningLevel: ReasoningLevel;
  reasoningOptions: PickerOption<ReasoningLevel>[];
  isUnavailableModelRecovery: boolean;
}

const OMP_MODEL_SOURCE_LABELS: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  cursor: "Cursor",
  "kimi-code": "Kimi Code",
  ollama: "Ollama",
  "openai-codex": "OpenAI Codex",
  openrouter: "OpenRouter",
  "xai-oauth": "xAI OAuth",
};

function modelSourceQualifier(
  provider: ModelCatalogProvider | undefined,
  model: AvailableModel,
): string | undefined {
  if (provider?.id !== "acp-omp") {
    return undefined;
  }
  const separator = model.model.indexOf("/");
  if (separator <= 0) {
    return undefined;
  }
  const source = model.model.slice(0, separator);
  return OMP_MODEL_SOURCE_LABELS[source] ?? source;
}

function toModelPickerOption(
  model: AvailableModel,
  formatModelLabel: (displayName: string) => string,
  provider: ModelCatalogProvider | undefined,
): ModelPickerOption {
  const qualifier = modelSourceQualifier(provider, model);
  return {
    value: model.model,
    label: formatModelLabel(model.displayName || model.model),
    ...(qualifier ? { qualifier } : {}),
    ...(model.routeProviderId
      ? { routeProviderId: model.routeProviderId }
      : {}),
  };
}

export function resolveModelCatalogSelection({
  models,
  selectedOnlyModels,
  selectedModel: rawSelectedModel,
  preferredReasoningLevel,
  provider,
  catalogIsVerified,
  formatModelLabel,
}: ResolveModelCatalogSelectionArgs): ResolvedModelCatalogSelection {
  const fullCatalog = [...models, ...selectedOnlyModels];
  const selectedModelSelection = (() => {
    if (!rawSelectedModel) return rawSelectedModel;
    if (fullCatalog.some((model) => model.model === rawSelectedModel)) {
      return rawSelectedModel;
    }
    const prefixed = fullCatalog.filter((model) =>
      model.model.endsWith(`/${rawSelectedModel}`),
    );
    return prefixed.length === 1 ? prefixed[0].model : rawSelectedModel;
  })();

  const availableModels = [...models];
  if (
    selectedModelSelection &&
    !availableModels.some((model) => model.model === selectedModelSelection)
  ) {
    const selectedOnlyModel = selectedOnlyModels.find(
      (model) => model.model === selectedModelSelection,
    );
    if (selectedOnlyModel) {
      availableModels.unshift(selectedOnlyModel);
    }
  }

  const selectedModel = (() => {
    if (!catalogIsVerified && selectedModelSelection) {
      return selectedModelSelection;
    }
    if (availableModels.length === 0) {
      return selectedModelSelection;
    }
    if (
      availableModels.some((model) => model.model === selectedModelSelection)
    ) {
      return selectedModelSelection;
    }
    return (
      availableModels.find((model) => model.isDefault)?.model ??
      availableModels[0].model
    );
  })();

  const activeModel =
    availableModels.find((model) => model.model === selectedModel) ??
    availableModels.find((model) => model.isDefault) ??
    availableModels[0];

  const reasoningOptions: PickerOption<ReasoningLevel>[] = [];
  const seenReasoningLevels = new Set<ReasoningLevel>();
  for (const effort of activeModel?.supportedReasoningEfforts ?? []) {
    if (seenReasoningLevels.has(effort.reasoningEffort)) continue;
    seenReasoningLevels.add(effort.reasoningEffort);
    reasoningOptions.push({
      value: effort.reasoningEffort,
      label: reasoningLevelLabel(effort.reasoningEffort, provider),
    });
  }

  const preferredLevel = preferredReasoningLevel ?? "medium";
  const reasoningLevel =
    reasoningOptions.length === 0
      ? preferredLevel
      : reconcileReasoningLevel(
          preferredLevel,
          reasoningOptions.map((option) => option.value),
        );

  return {
    selectedModel,
    activeModel,
    modelOptions: availableModels.map((model) =>
      toModelPickerOption(model, formatModelLabel, provider),
    ),
    moreModelOptions: selectedOnlyModels
      .filter(
        (model) =>
          !availableModels.some((active) => active.model === model.model),
      )
      .map((model) => toModelPickerOption(model, formatModelLabel, provider)),
    reasoningLevel,
    reasoningOptions,
    isUnavailableModelRecovery:
      catalogIsVerified &&
      rawSelectedModel.length > 0 &&
      selectedModel !== rawSelectedModel,
  };
}
