import type {
  SystemExecutionOptionsModelLoadErrorCode,
  SystemExecutionOptionsModelLoadError,
  SystemExecutionOptionsResponse,
} from "@bb/server-contract";
import type { CustomProviderModel } from "@bb/config/bb-app-managed-config";
import {
  reasoningEffortsForLevels,
  type AvailableModel,
  type ProviderInfo,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { getSupportedReasoningLevelsForProvider } from "../threads/thread-reasoning-policy.js";
import { resolveSystemLookupHostId } from "./host-lookup.js";

export interface SystemExecutionOptionsRequest {
  environmentId?: string;
  hostId?: string;
  providerId?: string;
}

interface BuildModelLoadErrorArgs {
  error: ApiError;
  provider: ProviderInfo;
}

type ModelListResult = Pick<
  SystemExecutionOptionsResponse,
  "modelLoadError" | "models" | "selectedOnlyModels"
>;

interface AppendCustomModelsArgs {
  customModels: CustomProviderModel[];
  models: AvailableModel[];
  providerId: string;
  selectedOnlyModels: AvailableModel[];
}

type AppendCustomModelsResult = Pick<
  SystemExecutionOptionsResponse,
  "models" | "selectedOnlyModels"
>;

function buildCustomModel(customModel: CustomProviderModel): AvailableModel {
  return {
    id: customModel.model,
    model: customModel.model,
    displayName: customModel.displayName ?? customModel.model,
    description: "Custom model from config.json",
    // Custom models advertise the provider's full reasoning ladder: per-model
    // support is unknowable server-side and the picker reconciles the user's
    // choice per model (see reconcileReasoningLevel in @bb/domain). The
    // ladder comes from the same per-provider policy table that validates
    // reasoning overrides, so the picker and validation cannot drift apart.
    supportedReasoningEfforts: reasoningEffortsForLevels(
      getSupportedReasoningLevelsForProvider(customModel.providerId),
    ),
    defaultReasoningEffort: "medium",
    isDefault: false,
  };
}

// Appends the user's configured custom models for the provider to the
// provider-reported catalog. Catalog metadata wins on model-id collision so
// the picker never shows duplicate or conflicting rows: active entries are
// kept as-is, and selected-only entries (retired/pinned models the catalog
// describes accurately but no longer offers) are promoted into the active
// list instead of being shadowed by a synthesized entry. This also runs when
// the provider model list failed to load so custom models stay selectable.
export function appendCustomModels({
  customModels,
  models,
  providerId,
  selectedOnlyModels,
}: AppendCustomModelsArgs): AppendCustomModelsResult {
  const providerCustomModels = customModels.filter(
    (customModel) => customModel.providerId === providerId,
  );
  if (providerCustomModels.length === 0) {
    return { models, selectedOnlyModels };
  }

  const seenModelIds = new Set(models.map((model) => model.model));
  const promotedModelIds = new Set<string>();
  const appendedModels: AvailableModel[] = [];

  for (const customModel of providerCustomModels) {
    if (seenModelIds.has(customModel.model)) {
      continue;
    }
    seenModelIds.add(customModel.model);
    const selectedOnlyMatch = selectedOnlyModels.find(
      (model) => model.model === customModel.model,
    );
    if (selectedOnlyMatch !== undefined) {
      promotedModelIds.add(selectedOnlyMatch.model);
      appendedModels.push(selectedOnlyMatch);
      continue;
    }
    appendedModels.push(buildCustomModel(customModel));
  }

  return {
    models: [...models, ...appendedModels],
    selectedOnlyModels:
      promotedModelIds.size === 0
        ? selectedOnlyModels
        : selectedOnlyModels.filter(
            (model) => !promotedModelIds.has(model.model),
          ),
  };
}

export async function resolveSystemExecutionOptions(
  deps: AppDeps,
  query: SystemExecutionOptionsRequest,
): Promise<SystemExecutionOptionsResponse> {
  const hostId = resolveSystemLookupHostId(deps, query);
  const { providers } = await callHostRetryableOnlineRpc(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "provider.list" },
  });
  const requestedProvider = query.providerId
    ? providers.find((provider) => provider.id === query.providerId)
    : undefined;
  const modelsProvider = requestedProvider ?? providers[0];

  if (!modelsProvider) {
    return {
      providers,
      models: [],
      selectedOnlyModels: [],
      modelLoadError: null,
    };
  }

  let modelResult: ModelListResult;
  try {
    const { models, selectedOnlyModels } = await callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "provider.list_models",
        providerId: modelsProvider.id,
      },
    });
    modelResult = {
      models,
      selectedOnlyModels,
      modelLoadError: null,
    };
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      (error.status !== 502 && error.status !== 504)
    ) {
      throw error;
    }
    deps.logger.warn(
      {
        err: error,
        hostId,
        providerId: modelsProvider.id,
      },
      "Failed to resolve provider models",
    );
    modelResult = {
      models: [],
      selectedOnlyModels: [],
      modelLoadError: buildModelLoadError({
        error,
        provider: modelsProvider,
      }),
    };
  }

  const { models, selectedOnlyModels } = appendCustomModels({
    customModels: deps.config.customModels,
    models: modelResult.models,
    providerId: modelsProvider.id,
    selectedOnlyModels: modelResult.selectedOnlyModels,
  });

  return {
    providers,
    models,
    selectedOnlyModels,
    modelLoadError: modelResult.modelLoadError,
  };
}

function buildModelLoadError({
  error,
  provider,
}: BuildModelLoadErrorArgs): SystemExecutionOptionsModelLoadError {
  return {
    providerId: provider.id,
    code: toModelLoadErrorCode(error),
  };
}

function toModelLoadErrorCode(
  error: ApiError,
): SystemExecutionOptionsModelLoadErrorCode {
  if (error.body.code === "command_timeout") {
    return "timeout";
  }

  if (error.body.code === "missing_executable") {
    return "missing_executable";
  }

  return "failed";
}
