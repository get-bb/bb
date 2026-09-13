import type {
  SystemExecutionOptionsModelLoadErrorCode,
  SystemExecutionOptionsModelLoadError,
  SystemExecutionOptionsQuery,
  SystemExecutionOptionsResponse,
  SystemProvidersQuery,
} from "@bb/server-contract";
import { type CustomProviderModel } from "@bb/config/bb-app-managed-config";
import {
  reasoningEffortsForLevels,
  type AvailableModel,
  type ProviderInfo,
} from "@bb/domain";
import { getAppSettings } from "@bb/db";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { getHostPermissionCeiling } from "../hosts/permission-ceiling.js";
import {
  requireConnectedHostSession,
  requireEnvironment,
} from "../lib/entity-lookup.js";
import { expectedFallbackErrorLogFields } from "../lib/error-log-fields.js";
import { isSuspendedHostUnavailableError } from "../lib/lifecycle-api-errors.js";
import {
  createProviderListingBudget,
  type ProviderListingBudget,
} from "../providers/native-roots.js";
import {
  toProviderModelCatalogFailureCode,
  type ProviderModelCatalogAccess,
} from "../providers/provider-model-catalog-store.js";
import type {
  ProviderHealthCacheKey,
  ProviderRegistryService,
} from "../providers/provider-registry.js";
import { getSupportedReasoningLevelsForProvider } from "../threads/thread-reasoning-policy.js";
import { resolveSystemLookupHostId } from "./host-lookup.js";
import { resolveBridgeLaunchForProviderId } from "./provider-bridge-launch.js";
import { mapProviderMaintenanceRequests } from "./provider-maintenance-concurrency.js";

type SystemExecutionOptionsRequest = SystemExecutionOptionsQuery;

interface BuildModelLoadErrorArgs {
  error: ApiError;
  provider: ProviderInfo;
}

interface ResolveSystemProviderModelsArgs {
  cwd?: string;
  hostId: string;
  providerId: string;
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

type ProviderCapabilityFilter =
  | NonNullable<SystemProvidersQuery["capability"]>
  | "installation";
type ListSystemProviderInfosRequest = Omit<
  SystemProvidersQuery,
  "capability"
> & {
  capability?: ProviderCapabilityFilter;
};

interface ResolveSystemProviderInfosPlanResult {
  hostId: string | null;
  hostLookupError: ApiError | null;
  providersPromise: Promise<ProviderInfo[]>;
}

function providerMatchesCapability(
  provider: ProviderInfo,
  capability: ProviderCapabilityFilter | undefined,
): boolean {
  switch (capability) {
    case "installation":
      return provider.maintenance.installation;
    case "usage":
      return provider.maintenance.usage;
    case undefined:
      return true;
  }
}

function listConfiguredSystemProviderInfos(
  deps: Pick<LoggedWorkSessionDeps, "providerRegistry">,
  capability?: ProviderCapabilityFilter,
): ProviderInfo[] {
  return deps.providerRegistry
    .list()
    .filter(
      (entry) =>
        entry.visibility === "always" &&
        providerMatchesCapability(entry.info, capability),
    )
    .map((entry) => entry.info);
}

function includeRequestedRegisteredProvider(
  deps: Pick<LoggedWorkSessionDeps, "providerRegistry">,
  providers: ProviderInfo[],
  providerId: string | undefined,
): ProviderInfo[] {
  if (
    providerId === undefined ||
    providers.some((provider) => provider.id === providerId)
  ) {
    return providers;
  }
  const registration = deps.providerRegistry.get(providerId);
  return registration === null ? providers : [...providers, registration.info];
}

function canOmitProviderDiscoveryForError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError && (error.status === 502 || error.status === 504)
  );
}

async function listInstalledPluginProviderInfos(
  deps: LoggedWorkSessionDeps,
  hostId: string,
  capability?: ProviderCapabilityFilter,
): Promise<ProviderInfo[]> {
  const registrations = deps.providerRegistry
    .list()
    .filter(
      (registration) =>
        registration.visibility === "installed" &&
        providerMatchesCapability(registration.info, capability),
    );
  const budget = createProviderListingBudget();
  const results = await mapProviderMaintenanceRequests(
    registrations,
    async (registration) => {
      const bridgeLaunch = resolveBridgeLaunchForProviderId(
        deps,
        registration.info.id,
      );
      if (bridgeLaunch === null) return null;
      const cacheKey: ProviderHealthCacheKey = {
        hostId,
        providerId: registration.info.id,
      };
      const probe = async (probeBudget: ProviderListingBudget) => {
        const result = await callHostRetryableOnlineRpc(deps, {
          hostId,
          timeoutMs: probeBudget.remainingMs(),
          command: {
            type: "provider.health",
            providerId: registration.info.id,
            bridgeLaunch,
          },
        });
        return result.supported && result.health.status !== "not_installed";
      };
      const cached = deps.providerRegistry.lookupInstalled(cacheKey);
      try {
        const installed = cached ?? probe(budget);
        if (cached === undefined) {
          deps.providerRegistry.rememberInstalled(cacheKey, installed);
        } else {
          void deps.providerRegistry.revalidateInstalled(cacheKey, () =>
            probe(createProviderListingBudget()),
          );
        }
        return (await installed) ? registration.info : null;
      } catch (error) {
        deps.providerRegistry.forgetInstalledKey(cacheKey);
        if (!canOmitProviderDiscoveryForError(error)) {
          throw error;
        }
        if (!isSuspendedHostUnavailableError(error)) {
          deps.logger.warn(
            {
              ...expectedFallbackErrorLogFields(error),
              hostId,
              providerId: registration.info.id,
            },
            "Failed to resolve installed-only provider status",
          );
        }
        return null;
      }
    },
  );
  return results.filter(
    (provider): provider is ProviderInfo => provider !== null,
  );
}

export async function listSystemProviderInfosForHost(
  deps: LoggedWorkSessionDeps,
  hostId: string,
  capability?: ProviderCapabilityFilter,
): Promise<ProviderInfo[]> {
  const configured = listConfiguredSystemProviderInfos(deps, capability);
  const installed = await listInstalledPluginProviderInfos(
    deps,
    hostId,
    capability,
  );
  const visibleIds = new Set([
    ...configured.map((provider) => provider.id),
    ...installed.map((provider) => provider.id),
  ]);
  return deps.providerRegistry
    .list()
    .filter((registration) => visibleIds.has(registration.info.id))
    .map((registration) => registration.info);
}

function resolveSystemProviderInfosPlan(
  deps: LoggedWorkSessionDeps,
  query: ListSystemProviderInfosRequest = {},
): ResolveSystemProviderInfosPlanResult {
  try {
    const hostId = resolveSystemLookupHostId(deps, query);
    requireConnectedHostSession(deps, hostId);
    return {
      hostId,
      hostLookupError: null,
      providersPromise: listSystemProviderInfosForHost(
        deps,
        hostId,
        query.capability,
      ),
    };
  } catch (error) {
    if (!canOmitProviderDiscoveryForError(error)) {
      throw error;
    }
    if (!isSuspendedHostUnavailableError(error)) {
      deps.logger.warn(
        expectedFallbackErrorLogFields(error),
        "Failed to resolve host for provider discovery",
      );
    }
    return {
      hostId: null,
      hostLookupError: error,
      providersPromise: Promise.resolve(
        listConfiguredSystemProviderInfos(deps, query.capability),
      ),
    };
  }
}

export async function listSystemProviderInfos(
  deps: LoggedWorkSessionDeps,
  query: ListSystemProviderInfosRequest = {},
): Promise<ProviderInfo[]> {
  await deps.providerRegistry.whenRegistrationsSettled();
  return await resolveSystemProviderInfosPlan(deps, query).providersPromise;
}

export async function resolveSystemProviderModels(
  deps: LoggedWorkSessionDeps,
  args: ResolveSystemProviderModelsArgs,
): Promise<ModelListResult> {
  await deps.providerRegistry.whenProviderRegistered(args.providerId);
  const provider = includeRequestedRegisteredProvider(
    deps,
    listConfiguredSystemProviderInfos(deps),
    args.providerId,
  ).find((entry) => entry.id === args.providerId);
  if (provider === undefined) {
    throw new ApiError(
      400,
      "invalid_request",
      `Unsupported provider ${args.providerId}`,
    );
  }

  const result = await loadSystemProviderModels(deps, {
    cwd: args.cwd ?? null,
    hostId: args.hostId,
    provider,
    access: { kind: "validation", requiredModel: null },
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

function listVisibleCustomModels(
  deps: Pick<LoggedWorkSessionDeps, "config" | "db">,
): CustomProviderModel[] {
  if (deps.config.customModels.length === 0) {
    return deps.config.customModels;
  }
  return getAppSettings(deps.db).streamerMode ? [] : deps.config.customModels;
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
    supportedReasoningEfforts: reasoningEffortsForLevels(
      getSupportedReasoningLevelsForProvider(registry, customModel.providerId),
    ),
    defaultReasoningEffort: "medium",
    isDefault: false,
  };
}

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

export function resolveSystemExecutionOptions(
  deps: LoggedWorkSessionDeps,
  query: SystemExecutionOptionsRequest,
): Promise<SystemExecutionOptionsResponse> {
  return resolveExecutionOptions(deps, query, { kind: "picker" });
}

export function resolveSystemExecutionOptionsForValidation(
  deps: LoggedWorkSessionDeps,
  query: SystemExecutionOptionsRequest,
  requiredModel: string | null,
): Promise<SystemExecutionOptionsResponse> {
  return resolveExecutionOptions(deps, query, {
    kind: "validation",
    requiredModel,
  });
}

async function resolveExecutionOptions(
  deps: LoggedWorkSessionDeps,
  query: SystemExecutionOptionsRequest,
  access: ProviderModelCatalogAccess,
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
    ? includeRequestedRegisteredProvider(
        deps,
        listConfiguredSystemProviderInfos(deps),
        query.providerId,
      ).find((provider) => provider.id === query.providerId)
    : undefined;
  const earlyModelResultPromise =
    hostId !== null && configuredRequestedProvider
      ? loadSystemProviderModels(deps, {
          cwd: cwd ?? null,
          hostId,
          provider: configuredRequestedProvider,
          access,
        })
      : null;
  let providers: ProviderInfo[];
  try {
    providers = await providersPromise;
  } catch (error) {
    await earlyModelResultPromise?.catch(() => undefined);
    throw error;
  }
  providers = includeRequestedRegisteredProvider(
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
        customModels: listVisibleCustomModels(deps),
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
          cwd: cwd ?? null,
          hostId,
          provider: modelsProvider,
          access,
        });

  const { models, selectedOnlyModels } = appendCustomModels(
    deps.providerRegistry,
    {
      customModels: listVisibleCustomModels(deps),
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
  args: {
    cwd: string | null;
    hostId: string;
    provider: ProviderInfo;
    access: ProviderModelCatalogAccess;
  },
): Promise<ModelListResult> {
  if (!args.provider.available) {
    return unavailableProviderModelResult(args.provider.id);
  }
  const result = await deps.lifecycleDedupers.providerModelCatalogs.read(
    deps,
    args,
  );
  if (result.kind === "catalog") {
    return {
      models: result.models,
      selectedOnlyModels: result.selectedOnlyModels,
      modelLoadError: null,
    };
  }
  return {
    models: listFallbackModelsForLoadError(deps, {
      code: result.code,
      providerId: args.provider.id,
    }),
    selectedOnlyModels: [],
    modelLoadError: { providerId: args.provider.id, code: result.code },
  };
}

function listFallbackModelsForLoadError(
  deps: Pick<LoggedWorkSessionDeps, "providerRegistry">,
  {
    code,
    providerId,
  }: {
    code: SystemExecutionOptionsModelLoadErrorCode;
    providerId: string;
  },
): AvailableModel[] {
  if (code !== "timeout" && code !== "failed") {
    return [];
  }
  const fallback = deps.providerRegistry.get(providerId)?.fallbackModels ?? [];
  return fallback.map((model) => ({
    ...model,
    supportedReasoningEfforts: model.supportedReasoningEfforts.map(
      (effort) => ({ ...effort }),
    ),
  }));
}

function buildModelLoadError({
  error,
  provider,
}: BuildModelLoadErrorArgs): SystemExecutionOptionsModelLoadError {
  return {
    providerId: provider.id,
    code: toProviderModelCatalogFailureCode(error),
  };
}
