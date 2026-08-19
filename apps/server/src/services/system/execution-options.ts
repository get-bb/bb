import type {
  SystemExecutionOptionsModelLoadErrorCode,
  SystemExecutionOptionsModelLoadError,
  SystemExecutionOptionsQuery,
  SystemExecutionOptionsResponse,
  SystemProvidersQuery,
} from "@bb/server-contract";
import { buildAcpProviderInfo } from "../providers/acp-provider-tier.js";
import { listClaudeCodeFallbackModels } from "./claude-code-fallback-models.js";
import {
  formatCustomAcpAgentProviderId,
  type CustomAcpAgent,
  type CustomProviderModel,
} from "@bb/config/bb-app-managed-config";
import {
  providerModelCatalogDependsOnWorkspace,
  reasoningEffortsForLevels,
  type AvailableModel,
  type ProviderInfo,
} from "@bb/domain";
import {
  normalizeHostDaemonAcpLaunchSpec,
  type HostDaemonRetryableOnlineRpcCommand,
} from "@bb/host-daemon-contract";
import type { ProviderModelListMemoValue } from "../../lifecycle-dedupers.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { getHostPermissionCeiling } from "../hosts/permission-ceiling.js";
import { requireEnvironment } from "../lib/entity-lookup.js";
import type { ProviderRegistryService } from "../providers/provider-registry.js";
import { getSupportedReasoningLevelsForProvider } from "../threads/thread-reasoning-policy.js";
import { resolveSystemLookupHostId } from "./host-lookup.js";
import {
  isAcpProviderTierRegistered,
  requireBridgeLaunchForProviderId,
} from "./provider-bridge-launch.js";
import {
  buildKnownAcpProviderInfo,
  findKnownAcpAgentForProviderId,
  listKnownAcpAgentExecutableQueries,
  type KnownAcpAgent,
} from "./known-acp-agents.js";

export type SystemExecutionOptionsRequest = SystemExecutionOptionsQuery;

interface BuildModelLoadErrorArgs {
  error: ApiError;
  provider: ProviderInfo;
}

export interface ResolveSystemProviderModelsArgs {
  cwd?: string;
  hostId: string;
  providerId: string;
}

interface ExpectedFallbackErrorLogFields {
  errorCode: string;
  errorDetails?: unknown;
  errorMessage: string;
  errorRetryable?: boolean;
  errorStatus: number;
}

type ModelListResult = Pick<
  SystemExecutionOptionsResponse,
  "modelLoadError" | "models" | "selectedOnlyModels"
>;

function unavailableProviderModelResult(providerId: string): ModelListResult {
  return {
    models: [],
    selectedOnlyModels: [],
    modelLoadError: { providerId, code: "provider_unavailable" },
  };
}

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

type ListSystemProviderInfosRequest = SystemProvidersQuery;

interface ListSystemProviderInfosResult {
  hostId: string | null;
  hostLookupError: ApiError | null;
  providers: ProviderInfo[];
}

interface ResolveSystemProviderInfosPlanResult extends Omit<
  ListSystemProviderInfosResult,
  "providers"
> {
  providersPromise: Promise<ProviderInfo[]>;
}

function buildCustomAcpProviderInfo(agent: CustomAcpAgent): ProviderInfo {
  const providerId = formatCustomAcpAgentProviderId(agent.id);
  return buildAcpProviderInfo({
    id: providerId,
    displayName: agent.displayName,
    logoUrl:
      agent.logo === undefined
        ? null
        : `/api/v1/system/providers/${encodeURIComponent(providerId)}/logo`,
  });
}

function listConfiguredSystemProviderInfos(
  deps: Pick<LoggedWorkSessionDeps, "config" | "providerRegistry">,
  installedKnownAcpAgents: readonly KnownAcpAgent[],
): ProviderInfo[] {
  // Dynamic ACP ids are never registered; they run on the ACP tier plugin's
  // bridge, so they exist only while that plugin does.
  const acpTierAvailable = isAcpProviderTierRegistered(deps);
  const providers = [
    // The registry is the single provider-metadata source: the core seed plus
    // live plugin registrations (bb.agents.experimental_registerProvider).
    ...deps.providerRegistry.list().map((entry) => entry.info),
    ...(acpTierAvailable
      ? deps.config.customAcpAgents.map(buildCustomAcpProviderInfo)
      : []),
  ];
  const seenProviderIds = new Set(providers.map((provider) => provider.id));
  for (const agent of installedKnownAcpAgents) {
    if (seenProviderIds.has(agent.id) || !acpTierAvailable) {
      continue;
    }
    seenProviderIds.add(agent.id);
    providers.push(buildKnownAcpProviderInfo(agent));
  }
  return providers;
}

function includeRequestedKnownAcpProvider(
  deps: Pick<LoggedWorkSessionDeps, "providerRegistry">,
  providers: ProviderInfo[],
  providerId: string | undefined,
): ProviderInfo[] {
  if (
    providerId === undefined ||
    providers.some((provider) => provider.id === providerId) ||
    !isAcpProviderTierRegistered(deps)
  ) {
    return providers;
  }
  const knownAgent = findKnownAcpAgentForProviderId(providerId);
  return knownAgent === undefined
    ? providers
    : [...providers, buildKnownAcpProviderInfo(knownAgent)];
}

function canOmitKnownAcpAgentsForError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError && (error.status === 502 || error.status === 504)
  );
}

function expectedFallbackErrorLogFields(
  error: ApiError,
): ExpectedFallbackErrorLogFields {
  const fields: ExpectedFallbackErrorLogFields = {
    errorCode: error.body.code,
    errorMessage: error.body.message,
    errorStatus: error.status,
  };
  if (error.body.details !== undefined) {
    fields.errorDetails = error.body.details;
  }
  if (error.body.retryable !== undefined) {
    fields.errorRetryable = error.body.retryable;
  }
  return fields;
}

async function listInstalledKnownAcpAgents(
  deps: LoggedWorkSessionDeps,
  hostId: string,
): Promise<KnownAcpAgent[]> {
  // No ACP bridge, no ACP agents to offer — skip the host probe entirely.
  if (!isAcpProviderTierRegistered(deps)) {
    return [];
  }
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
        ...expectedFallbackErrorLogFields(error),
        hostId,
      },
      "Failed to resolve known ACP agent status",
    );
    return [];
  }
}

async function listSystemProviderInfosForHost(
  deps: LoggedWorkSessionDeps,
  hostId: string,
): Promise<ProviderInfo[]> {
  return listConfiguredSystemProviderInfos(
    deps,
    await listInstalledKnownAcpAgents(deps, hostId),
  );
}

function resolveSystemProviderInfosPlan(
  deps: LoggedWorkSessionDeps,
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
      expectedFallbackErrorLogFields(error),
      "Failed to resolve host for known ACP agent status",
    );
    return {
      hostId: null,
      hostLookupError: error,
      providersPromise: Promise.resolve(
        listConfiguredSystemProviderInfos(deps, []),
      ),
    };
  }
}

async function resolveSystemProviderInfos(
  deps: LoggedWorkSessionDeps,
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
  deps: LoggedWorkSessionDeps,
  query: ListSystemProviderInfosRequest = {},
): Promise<ProviderInfo[]> {
  // Plugins register their providers after the listener is already serving, so
  // an early request would otherwise report an empty provider list.
  await deps.providerRegistry.whenRegistrationsSettled();
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

/**
 * Load one provider's model catalog on an already-resolved host. Unlike the
 * full execution-options response, this does not probe for other installed ACP
 * agents, so thread creation can resolve an omitted model with one targeted
 * daemon request.
 */
export async function resolveSystemProviderModels(
  deps: LoggedWorkSessionDeps,
  args: ResolveSystemProviderModelsArgs,
): Promise<ModelListResult> {
  await deps.providerRegistry.whenProviderRegistered(args.providerId);
  const configuredProvider = listConfiguredSystemProviderInfos(deps, []).find(
    (provider) => provider.id === args.providerId,
  );
  const knownAcpAgent = isAcpProviderTierRegistered(deps)
    ? findKnownAcpAgentForProviderId(args.providerId)
    : undefined;
  const provider =
    configuredProvider ??
    (knownAcpAgent === undefined
      ? undefined
      : buildKnownAcpProviderInfo(knownAcpAgent));
  if (provider === undefined) {
    throw new ApiError(
      400,
      "invalid_request",
      `Unsupported provider ${args.providerId}`,
    );
  }

  const result = await loadSystemProviderModels(deps, {
    ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
    hostId: args.hostId,
    provider,
  });
  const { models, selectedOnlyModels } = appendCustomModels(
    deps.providerRegistry,
    {
      customModels: deps.config.customModels,
      models: result.models,
      providerId: provider.id,
      selectedOnlyModels: result.selectedOnlyModels,
    },
  );
  return {
    models,
    selectedOnlyModels,
    modelLoadError: result.modelLoadError,
  };
}

function buildCustomModel(
  registry: ProviderRegistryService,
  customModel: CustomProviderModel,
): AvailableModel {
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
      getSupportedReasoningLevelsForProvider(registry, customModel.providerId),
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
export function appendCustomModels(
  registry: ProviderRegistryService,
  {
    customModels,
    models,
    providerId,
    selectedOnlyModels,
  }: AppendCustomModelsArgs,
): AppendCustomModelsResult {
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
    appendedModels.push(buildCustomModel(registry, customModel));
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
  deps: LoggedWorkSessionDeps,
  query: SystemExecutionOptionsRequest,
): Promise<SystemExecutionOptionsResponse> {
  if (query.providerId === undefined) {
    await deps.providerRegistry.whenRegistrationsSettled();
  } else {
    await deps.providerRegistry.whenProviderRegistered(query.providerId);
  }
  const cwd =
    query.environmentId === undefined
      ? undefined
      : (requireEnvironment(deps.db, query.environmentId).path ?? undefined);
  const { hostId, hostLookupError, providersPromise } =
    resolveSystemProviderInfosPlan(deps, query);
  const configuredRequestedProvider = query.providerId
    ? listConfiguredSystemProviderInfos(deps, []).find(
        (provider) => provider.id === query.providerId,
      )
    : undefined;
  const earlyModelResultPromise =
    hostId !== null && configuredRequestedProvider
      ? loadSystemProviderModels(deps, {
          ...(cwd !== undefined ? { cwd } : {}),
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
  providers = includeRequestedKnownAcpProvider(
    deps,
    providers,
    query.providerId,
  );
  const requestedProvider = query.providerId
    ? providers.find((provider) => provider.id === query.providerId)
    : undefined;
  const modelsProvider =
    earlyModelResultPromise !== null
      ? configuredRequestedProvider
      : (requestedProvider ?? providers[0]);

  const permissionCeiling = getHostPermissionCeiling(deps, hostId);

  if (!modelsProvider) {
    return {
      providers,
      permissionCeiling,
      models: [],
      selectedOnlyModels: [],
      modelLoadError: null,
    };
  }

  if (!modelsProvider.available) {
    return {
      providers,
      permissionCeiling,
      ...unavailableProviderModelResult(modelsProvider.id),
    };
  }

  if (hostId === null) {
    const { models, selectedOnlyModels } = appendCustomModels(
      deps.providerRegistry,
      {
        customModels: deps.config.customModels,
        models: [],
        providerId: modelsProvider.id,
        selectedOnlyModels: [],
      },
    );
    return {
      providers,
      permissionCeiling,
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
          ...(cwd !== undefined ? { cwd } : {}),
          hostId,
          provider: modelsProvider,
        });

  const { models, selectedOnlyModels } = appendCustomModels(
    deps.providerRegistry,
    {
      customModels: deps.config.customModels,
      models: modelResult.models,
      providerId: modelsProvider.id,
      selectedOnlyModels: modelResult.selectedOnlyModels,
    },
  );

  return {
    providers,
    permissionCeiling,
    models,
    selectedOnlyModels,
    modelLoadError: modelResult.modelLoadError,
  };
}

async function loadSystemProviderModels(
  deps: LoggedWorkSessionDeps,
  {
    cwd,
    hostId,
    provider,
  }: {
    cwd?: string;
    hostId: string;
    provider: ProviderInfo;
  },
): Promise<ModelListResult> {
  if (!provider.available) {
    return unavailableProviderModelResult(provider.id);
  }
  const customAcpAgent = findCustomAcpAgentForProviderId(
    deps.config.customAcpAgents,
    provider.id,
  );
  const knownAcpAgent =
    customAcpAgent === undefined
      ? findKnownAcpAgentForProviderId(provider.id)
      : undefined;
  const bridgeLaunch = requireBridgeLaunchForProviderId(deps, provider.id);
  const command: ProviderListModelsCommand = {
    type: "provider.list_models",
    providerId: provider.id,
    // Only a workspace-scoped catalog gets the path: the other bridges ignore
    // it, and leaving it out lets every environment on the host share one
    // memo entry.
    ...(cwd !== undefined && providerModelCatalogDependsOnWorkspace(provider.id)
      ? { cwd }
      : {}),
    ...(customAcpAgent !== undefined
      ? {
          acpLaunchSpec: normalizeHostDaemonAcpLaunchSpec(customAcpAgent),
        }
      : knownAcpAgent !== undefined
        ? {
            acpLaunchSpec: normalizeHostDaemonAcpLaunchSpec(knownAcpAgent),
          }
        : {}),
    bridgeLaunch,
  };
  try {
    const { models, selectedOnlyModels } = await listProviderModelsMemoized(
      deps,
      { command, hostId },
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
        ...expectedFallbackErrorLogFields(error),
        hostId,
        providerId: provider.id,
      },
      "Failed to resolve provider models",
    );
    const modelLoadError = buildModelLoadError({
      error,
      provider,
    });
    return {
      models: listFallbackModelsForLoadError({
        code: modelLoadError.code,
        providerId: provider.id,
      }),
      selectedOnlyModels: [],
      modelLoadError,
    };
  }
}

type ProviderListModelsCommand = Extract<
  HostDaemonRetryableOnlineRpcCommand,
  { type: "provider.list_models" }
>;

/**
 * Runs the host model probe through the process-wide memo. The key carries
 * everything the answer depends on: the host, the daemon session serving it
 * (a reconnected daemon may have a new CLI or account, so its first probe is
 * fresh), the provider registration revision (a plugin reload can change the
 * bridge), and the full command (provider, launch spec, bridge launch, and the
 * workspace path when the catalog is workspace-scoped). Concurrent callers for
 * one key share the in-flight probe; failures are not memoized.
 *
 * The probe is skipped only when no daemon session is registered yet: the
 * retryable RPC waits for one, and its answer would then belong to a session
 * this call cannot name.
 */
async function listProviderModelsMemoized(
  deps: LoggedWorkSessionDeps,
  { command, hostId }: { command: ProviderListModelsCommand; hostId: string },
): Promise<ProviderModelListMemoValue> {
  const probe = (): Promise<ProviderModelListMemoValue> =>
    callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command,
    });
  const daemonSessionId = deps.hub.getDaemonSessionIdForHost(hostId);
  if (daemonSessionId === null) {
    return probe();
  }
  const memoKey = JSON.stringify([
    hostId,
    daemonSessionId,
    deps.providerRegistry.getRegistrationRevision(),
    command,
  ]);
  return deps.lifecycleDedupers.providerModelList.run(memoKey, probe);
}

// A transient probe failure is not evidence that a model was retired, so the
// picker gets a provisional list instead of an empty one. `modelLoadError` stays
// set, which is what keeps callers treating this list as unverified: absence
// from it must never trigger thread model recovery. `missing_executable` and
// `auth_required` are excluded on purpose — those are actionable setup states
// the app routes to an install/auth prompt, so offering models there would only
// defer the real failure to submit time.
function listFallbackModelsForLoadError({
  code,
  providerId,
}: {
  code: SystemExecutionOptionsModelLoadErrorCode;
  providerId: string;
}): AvailableModel[] {
  if (providerId !== "claude-code") {
    return [];
  }
  return code === "timeout" || code === "failed"
    ? listClaudeCodeFallbackModels()
    : [];
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
