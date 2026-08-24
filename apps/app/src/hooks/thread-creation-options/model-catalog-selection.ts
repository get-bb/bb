import {
  reconcileReasoningLevel,
  type AvailableModel,
  type ReasoningLevel,
} from "@bb/domain";
import type { ModelPickerOption } from "@/components/pickers/model-picker-option";
import type { PickerOption } from "@/components/pickers/OptionPicker";
import {
  reasoningLevelLabel,
  type ReasoningLabelSource,
} from "@/lib/reasoning-labels";

interface ResolveModelCatalogSelectionArgs {
  models: readonly AvailableModel[];
  selectedOnlyModels: readonly AvailableModel[];
  selectedModel: string;
  preferredReasoningLevel?: ReasoningLevel;
  /**
   * The provider whose catalog this is, for its declared reasoning-level
   * labels (docs/provider-plugin-api.md §1; the model catalog carries only
   * ids). `undefined` when the provider is unknown: the fallback table labels
   * the ladder.
   */
  provider: ReasoningLabelSource | undefined;
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

function toModelPickerOption(
  model: AvailableModel,
  formatModelLabel: (displayName: string) => string,
): ModelPickerOption {
  return {
    value: model.model,
    label: formatModelLabel(model.displayName || model.model),
    ...(model.routeProviderId
      ? { routeProviderId: model.routeProviderId }
      : {}),
  };
}

/**
 * Applies the composer's canonical catalog policy to both committed and
 * previewed provider catalogs. A caller supplies query authority separately so
 * provisional rows can render without replacing an existing controlled value.
 */
export function resolveModelCatalogSelection({
  models,
  selectedOnlyModels,
  selectedModel: rawSelectedModel,
  preferredReasoningLevel,
  provider,
  catalogIsVerified,
  formatModelLabel,
}: ResolveModelCatalogSelectionArgs): ResolvedModelCatalogSelection {
  // Pi model ids gained a provider prefix. Recover a prefix-free stored id only
  // when exactly one catalog row ends in that id; multiple routes are
  // ambiguous and must not silently move the selection to another vendor.
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

  // Preserve a selected retired model by promoting it from the collapsed pool.
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

  // Only an authoritative catalog can prove that an existing model is gone.
  // A new selection with no explicit model can still display the provisional
  // default, but callers must not commit it until `catalogIsVerified` is true.
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
      toModelPickerOption(model, formatModelLabel),
    ),
    moreModelOptions: selectedOnlyModels
      .filter(
        (model) =>
          !availableModels.some((active) => active.model === model.model),
      )
      .map((model) => toModelPickerOption(model, formatModelLabel)),
    reasoningLevel,
    reasoningOptions,
    isUnavailableModelRecovery:
      catalogIsVerified &&
      rawSelectedModel.length > 0 &&
      selectedModel !== rawSelectedModel,
  };
}
