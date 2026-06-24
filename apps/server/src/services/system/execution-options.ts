import type {
  SystemExecutionOptionsModelLoadErrorCode,
  SystemExecutionOptionsModelLoadError,
  SystemExecutionOptionsResponse,
} from "@bb/server-contract";
import {
  buildAcpProviderInfo,
  listBuiltInAgentProviderInfos,
} from "@bb/agent-providers";
import {
  formatCustomAcpAgentProviderId,
  type CustomAcpAgent,
  type CustomProviderModel,
} from "@bb/config/bb-app-managed-config";
import {
  reasoningEffortsForLevels,
  type AvailableModel,
  type ProviderInfo,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { buildAcpLaunchSpec } from "../threads/thread-commands.js";
import { getSupportedReasoningLevelsForProvider } from "../threads/thread-reasoning-policy.js";
import { resolveSystemLookupHostId } from "./host-lookup.js";
import {
  buildKnownAcpProviderInfo,
  findKnownAcpAgentForProviderId,
  listKnownAcpAgentExecutableQueries,
  type KnownAcpAgent,
} from "./known-acp-agents.js";

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

interface ListSystemProviderInfosRequest {
  environmentId?: string;
  hostId?: string;
}

interface ListSystemProviderInfosResult {
  hostId: string | null;
  hostLookupError: ApiError | null;
  providers: ProviderInfo[];
}

interface ResolveSystemProviderInfosPlanResult
  extends Omit<ListSystemProviderInfosResult, "providers"> {
  providersPromise: Promise<ProviderInfo[]>;
}

function buildCustomAcpProviderInfo(agent: CustomAcpAgent): ProviderInfo {
  return buildAcpProviderInfo({
    id: formatCustomAcpAgentProviderId(agent.id),
    displayName: agent.displayName,
  });
}

function listConfiguredSystemProviderInfos(
  customAcpAgents: CustomAcpAgent[],
  installedKnownAcpAgents: readonly KnownAcpAgent[],
): ProviderInfo[] {
  const providers = [
    ...listBuiltInAgentProviderInfos(),
    ...customAcpAgents.map(buildCustomAcpProviderInfo),
  ];
  const seenProviderIds = new Set(providers.map((provider) => provider.id));
  for (const agent of installedKnownAcpAgents) {
    if (seenProviderIds.has(agent.id)) {
      continue;
    }
    seenProviderIds.add(agent.id);
    providers.push(buildKnownAcpProviderInfo(agent));
  }
  return providers;
}

function canOmitKnownAcpAgentsForError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError && (error.status === 502 || error.status === 504)
  );
}

async function listInstalledKnownAcpAgents(
  deps: AppDeps,
  hostId: string,
): Promise<KnownAcpAgent[]> {
  const customProviderIds = new Set(
    deps.config.customAcpAgents.map((agent) =>
      formatCustomAcpAgentProviderId(agent.id),
    ),
  );
  const knownAgents = listKnownAcpAgentExecutableQueries().filter(
    (agent) => !customProviderIds.has(agent.id),
  );
  if (knownAgents.length === 0) {
    return [];
  }

  try {
    const status = await callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "known_acp_agents.status",
        agents: knownAgents,
      },
    });
    const installedAgentIds = new Set(
      status.agents.filter((agent) => agent.installed).map((agent) => agent.id),
    );
    return knownAgents
      .map((query) => findKnownAcpAgentForProviderId(query.id))
      .filter(
        (agent): agent is KnownAcpAgent =>
          agent !== undefined && installedAgentIds.has(agent.id),
      );
  } catch (error) {
    if (!canOmitKnownAcpAgentsForError(error)) {
      throw error;
    }
    deps.logger.warn(
      {
        err: error,
        hostId,
      },
      "Failed to resolve known ACP agent status",
    );
    return [];
  }
}

async function listSystemProviderInfosForHost(
  deps: AppDeps,
  hostId: string,
): Promise<ProviderInfo[]> {
  return listConfiguredSystemProviderInfos(
    deps.config.customAcpAgents,
    await listInstalledKnownAcpAgents(deps, hostId),
  );
}

function resolveSystemProviderInfosPlan(
  deps: AppDeps,
  query: ListSystemProviderInfosRequest = {},
): ResolveSystemProviderInfosPlanResult {
  try {
    const hostId = resolveSystemLookupHostId(deps, query);
    return {
      hostId,
      hostLookupError: null,
      providersPromise: listSystemProviderInfosForHost(deps, hostId),
    };
  } catch (error) {
    if (!canOmitKnownAcpAgentsForError(error)) {
      throw error;
    }
    deps.logger.warn(
      { err: error },
      "Failed to resolve host for known ACP agent status",
    );
    return {
      hostId: null,
      hostLookupError: error,
      providersPromise: Promise.resolve(
        listConfiguredSystemProviderInfos(deps.config.customAcpAgents, []),
      ),
    };
  }
}

async function resolveSystemProviderInfos(
  deps: AppDeps,
  query: ListSystemProviderInfosRequest = {},
): Promise<ListSystemProviderInfosResult> {
  const { hostId, hostLookupError, providersPromise } =
    resolveSystemProviderInfosPlan(deps, query);
  return {
    hostId,
    hostLookupError,
    providers: await providersPromise,
  };
}

export async function listSystemProviderInfos(
  deps: AppDeps,
  query: ListSystemProviderInfosRequest = {},
): Promise<ProviderInfo[]> {
  return (await resolveSystemProviderInfos(deps, query)).providers;
}

function findCustomAcpAgentForProviderId(
  customAcpAgents: CustomAcpAgent[],
  providerId: string,
): CustomAcpAgent | undefined {
  return customAcpAgents.find(
    (agent) => formatCustomAcpAgentProviderId(agent.id) === providerId,
  );
}

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
  const { hostId, hostLookupError, providersPromise } =
    resolveSystemProviderInfosPlan(deps, query);
  const configuredRequestedProvider = query.providerId
    ? listConfiguredSystemProviderInfos(deps.config.customAcpAgents, []).find(
        (provider) => provider.id === query.providerId,
      )
    : undefined;
  const earlyModelResultPromise =
    hostId !== null && configuredRequestedProvider
      ? loadSystemProviderModels(deps, {
          hostId,
          provider: configuredRequestedProvider,
        })
      : null;
  let providers: ProviderInfo[];
  try {
    providers = await providersPromise;
  } catch (error) {
    await earlyModelResultPromise?.catch(() => undefined);
    throw error;
  }
  const requestedProvider = query.providerId
    ? providers.find((provider) => provider.id === query.providerId)
    : undefined;
  const modelsProvider =
    earlyModelResultPromise !== null
      ? configuredRequestedProvider
      : (requestedProvider ?? providers[0]);

  if (!modelsProvider) {
    return {
      providers,
      models: [],
      selectedOnlyModels: [],
      modelLoadError: null,
    };
  }

  if (hostId === null) {
    const { models, selectedOnlyModels } = appendCustomModels({
      customModels: deps.config.customModels,
      models: [],
      providerId: modelsProvider.id,
      selectedOnlyModels: [],
    });
    return {
      providers,
      models,
      selectedOnlyModels,
      modelLoadError:
        hostLookupError === null
          ? null
          : buildModelLoadError({
              error: hostLookupError,
              provider: modelsProvider,
            }),
    };
  }

  const modelResult =
    earlyModelResultPromise !== null
      ? await earlyModelResultPromise
      : await loadSystemProviderModels(deps, {
          hostId,
          provider: modelsProvider,
        });

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

async function loadSystemProviderModels(
  deps: AppDeps,
  {
    hostId,
    provider,
  }: {
    hostId: string;
    provider: ProviderInfo;
  },
): Promise<ModelListResult> {
  const customAcpAgent = findCustomAcpAgentForProviderId(
    deps.config.customAcpAgents,
    provider.id,
  );
  const knownAcpAgent =
    customAcpAgent === undefined
      ? findKnownAcpAgentForProviderId(provider.id)
      : undefined;
  try {
    const { models, selectedOnlyModels } = await callHostRetryableOnlineRpc(
      deps,
      {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "provider.list_models",
          providerId: provider.id,
          ...(customAcpAgent !== undefined
            ? { acpLaunchSpec: buildAcpLaunchSpec(customAcpAgent) }
            : knownAcpAgent !== undefined
              ? { acpLaunchSpec: buildAcpLaunchSpec(knownAcpAgent) }
              : {}),
        },
      },
    );
    return {
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
        providerId: provider.id,
      },
      "Failed to resolve provider models",
    );
    return {
      models: [],
      selectedOnlyModels: [],
      modelLoadError: buildModelLoadError({
        error,
        provider,
      }),
    };
  }
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

  if (error.body.code === "auth_required") {
    return "auth_required";
  }

  return "failed";
}
