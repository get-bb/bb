import { resolvePiDefaultModelId } from "@bb/agent-providers";
import {
  HIGH_REASONING_EFFORT,
  LOW_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  XHIGH_REASONING_EFFORT,
  type AvailableModel,
  type ModelReasoningEffort,
} from "@bb/domain";

export interface PiCatalogModel {
  id: string;
  input: string[];
  name: string;
  provider: string;
  reasoning: boolean;
  supportedThinkingLevels: readonly string[];
}

export interface BuildPiAvailableModelsArgs {
  agentDisplayName?: string;
  models: readonly PiCatalogModel[];
}

export interface BuildPiAvailableModelsResult {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}

/**
 * Model IDs ending with a `-YYYYMMDD` date suffix are pinned versions; we
 * exclude them from the picker and surface aliases only. Dated versions are
 * returned in the selected-only bucket so a previously stored selection can
 * still render with its catalog metadata. Pi uses this heuristic for resolution
 * preference (preferring aliases over dated versions when multiple models
 * match a pattern); we go further and exclude dated versions from the active
 * picker since our UI is a picker not a fuzzy resolver.
 * See `isAlias` in Pi's model-resolver.ts:
 * https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/model-resolver.ts
 */
const DATE_SUFFIX_PATTERN = /-\d{8}$/;

function isModelAlias(id: string): boolean {
  if (id.endsWith("-latest")) return true;
  return !DATE_SUFFIX_PATTERN.test(id);
}

function buildPiAvailableModel(
  model: PiCatalogModel,
  agentDisplayName: string,
): AvailableModel {
  const canonicalId = toCanonicalPiModelId(model.provider, model.id);
  const supportedReasoningEfforts = getPiReasoningEfforts(model);
  const defaultReasoningEffort =
    supportedReasoningEfforts.find(
      ({ reasoningEffort }) => reasoningEffort === "medium",
    )?.reasoningEffort ??
    supportedReasoningEfforts[0]?.reasoningEffort ??
    "low";
  return {
    id: canonicalId,
    model: canonicalId,
    displayName: model.name,
    // Pi is the selected agent provider; this is the nested model route that
    // determines authentication, billing, and where workspace content is sent.
    routeProviderId: model.provider,
    description: describePiModel(model, agentDisplayName),
    supportedReasoningEfforts,
    defaultReasoningEffort,
    isDefault: false,
  };
}

export function buildPiAvailableModels(
  args: BuildPiAvailableModelsArgs,
): BuildPiAvailableModelsResult {
  const models: AvailableModel[] = [];
  const selectedOnlyModels: AvailableModel[] = [];
  for (const model of args.models) {
    const built = buildPiAvailableModel(model, args.agentDisplayName ?? "Pi");
    if (isModelAlias(model.id)) {
      models.push(built);
    } else {
      selectedOnlyModels.push(built);
    }
  }

  const defaultId = resolveDefaultPiModelId(models);
  return {
    models: models.map((model) =>
      model.id === defaultId ? { ...model, isDefault: true } : model,
    ),
    selectedOnlyModels,
  };
}

/**
 * bb identifies a Pi model by `<provider>/<model id>`.
 *
 * Aggregator providers such as OpenRouter and the Vercel AI Gateway use model
 * ids that already contain a slash (`deepseek/deepseek-v4-flash`), so the
 * provider prefix is always added. Without it,
 * `openrouter/deepseek/deepseek-v4-flash` collapses to
 * `deepseek/deepseek-v4-flash`, which names a different provider's model.
 *
 * The model id keeps its own slashes, so consumers must split on the FIRST
 * slash only.
 */
export function toCanonicalPiModelId(
  provider: string,
  modelId: string,
): string {
  return `${provider}/${modelId}`;
}

function getPiReasoningEfforts(model: PiCatalogModel): ModelReasoningEffort[] {
  if (!model.reasoning) {
    return [LOW_REASONING_EFFORT];
  }

  const supportedLevels = new Set(model.supportedThinkingLevels);
  const efforts: ModelReasoningEffort[] = [];
  if (supportedLevels.has("low")) efforts.push(LOW_REASONING_EFFORT);
  if (supportedLevels.has("medium")) efforts.push(MEDIUM_REASONING_EFFORT);
  if (supportedLevels.has("high")) efforts.push(HIGH_REASONING_EFFORT);
  if (supportedLevels.has("xhigh")) efforts.push(XHIGH_REASONING_EFFORT);
  if (supportedLevels.has("max")) efforts.push(MAX_REASONING_EFFORT);
  return efforts.length > 0 ? efforts : [LOW_REASONING_EFFORT];
}

function describePiModel(
  model: PiCatalogModel,
  agentDisplayName: string,
): string {
  const capabilities: string[] = [];
  capabilities.push(model.reasoning ? "reasoning" : "non-reasoning");
  if (model.input.includes("image")) {
    capabilities.push("multimodal");
  }

  const provider =
    model.provider.length > 0
      ? model.provider[0].toUpperCase() + model.provider.slice(1)
      : model.provider;
  return `${provider} ${capabilities.join(", ")} model via ${agentDisplayName}`;
}

function resolveDefaultPiModelId(models: AvailableModel[]): string | undefined {
  // Try the per-provider default for each provider represented in the list
  for (const model of models) {
    const provider = model.id.split("/")[0];
    const defaultId = resolvePiDefaultModelId(provider);
    if (defaultId && model.id === toCanonicalPiModelId(provider, defaultId)) {
      return model.id;
    }
  }
  return models[0]?.id;
}
