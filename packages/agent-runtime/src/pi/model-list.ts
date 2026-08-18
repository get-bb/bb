import {
  HIGH_REASONING_EFFORT,
  LOW_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  NONE_REASONING_EFFORT,
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

function buildPiAvailableModel(model: PiCatalogModel): AvailableModel {
  const canonicalId = toCanonicalPiModelId(model.provider, model.id);
  const supportedReasoningEfforts = getPiReasoningEfforts(model);
  const defaultReasoningEffort =
    supportedReasoningEfforts.find(
      ({ reasoningEffort }) => reasoningEffort === "medium",
    )?.reasoningEffort ??
    supportedReasoningEfforts.find(
      ({ reasoningEffort }) => reasoningEffort !== "none",
    )?.reasoningEffort ??
    supportedReasoningEfforts[0]?.reasoningEffort ??
    "none";
  return {
    id: canonicalId,
    model: canonicalId,
    displayName: model.name,
    // Pi is the selected agent provider; this is the nested model route that
    // determines authentication, billing, and where workspace content is sent.
    routeProviderId: model.provider,
    description: describePiModel(model),
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
    const built = buildPiAvailableModel(model);
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
  // Derive the picker ladder from the model's supported thinking levels rather
  // than treating non-reasoning models specially: a non-reasoning model reports
  // only "off", so it surfaces a single "No extended thinking" entry, and a
  // reasoning model that can disable thinking (e.g. Ollama Cloud's
  // `kimi-k2.7-code` with `off: "none"`) gets "none" at the bottom of its
  // ladder. Pi's `getSupportedThinkingLevels` is the source of truth for which
  // levels are usable, so honor "off" here instead of silently dropping it.
  const supportedLevels = new Set(model.supportedThinkingLevels);
  const efforts: ModelReasoningEffort[] = [];
  if (supportedLevels.has("off")) efforts.push(NONE_REASONING_EFFORT);
  if (supportedLevels.has("low")) efforts.push(LOW_REASONING_EFFORT);
  if (supportedLevels.has("medium")) efforts.push(MEDIUM_REASONING_EFFORT);
  if (supportedLevels.has("high")) efforts.push(HIGH_REASONING_EFFORT);
  if (supportedLevels.has("xhigh")) efforts.push(XHIGH_REASONING_EFFORT);
  if (supportedLevels.has("max")) efforts.push(MAX_REASONING_EFFORT);
  return efforts.length > 0 ? efforts : [NONE_REASONING_EFFORT];
}

function describePiModel(model: PiCatalogModel): string {
  const capabilities: string[] = [];
  capabilities.push(model.reasoning ? "reasoning" : "non-reasoning");
  if (model.input.includes("image")) {
    capabilities.push("multimodal");
  }

  const provider =
    model.provider.length > 0
      ? model.provider[0].toUpperCase() + model.provider.slice(1)
      : model.provider;
  return `${provider} ${capabilities.join(", ")} model via Pi`;
}

/**
 * Best default model per upstream provider. Subset of Pi's
 * `defaultModelPerProvider`:
 * https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/model-resolver.ts
 */
const PI_DEFAULT_MODEL_PER_PROVIDER: Partial<Record<string, string>> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-5.4",
  "openai-codex": "gpt-5.6-sol",
  "amazon-bedrock": "us.anthropic.claude-opus-4-8",
  google: "gemini-2.5-pro",
  "google-gemini-cli": "gemini-2.5-pro",
  "google-vertex": "gemini-3-pro-preview",
  openrouter: "openai/gpt-5.1-codex",
  "vercel-ai-gateway": "anthropic/claude-opus-4.8",
  xai: "grok-4-fast-non-reasoning",
  mistral: "devstral-medium-latest",
};

function resolvePiDefaultModelId(providerId: string): string | undefined {
  return PI_DEFAULT_MODEL_PER_PROVIDER[providerId];
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
