import type {
  SystemProviderState,
  SystemProviderStatesResponse,
  SystemProvidersQuery,
} from "@bb/server-contract";
import type { ProviderInfo } from "@bb/domain";
import type {
  HostDaemonBridgeLaunch,
  HostDaemonOnlineRpcResult,
} from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import {
  callHostRetryableOnlineRpc,
  isHostUnavailableApiError,
} from "../hosts/online-rpc.js";
import {
  requireConnectedHostSession,
  requireEnvironment,
} from "../lib/entity-lookup.js";
import {
  isInstalledProviderHealth,
  listConfiguredSystemProviderInfos,
  listInstalledOnlyProviderRegistrations,
  listSystemProviderInfos,
  omitInstalledProviderAfterError,
  probeInstalledProvider,
} from "./execution-options.js";
import { createProviderListingBudget } from "../providers/native-roots.js";
import { resolveSystemLookupHostId } from "./host-lookup.js";
import { resolveBridgeLaunchForProviderId } from "./provider-bridge-launch.js";
import { mapProviderMaintenanceRequests } from "./provider-maintenance-concurrency.js";
import { resolvePluginProviderEnvHealth } from "../plugins/plugin-agent-contributions.js";
import { isSuspendedHostUnavailableError } from "../lib/lifecycle-api-errors.js";

function guidedSignIn(deps: AppDeps, providerId: string): boolean {
  return deps.providerRegistry.get(providerId)?.guidedSignIn ?? false;
}

function unknownProviderState(
  deps: AppDeps,
  provider: ProviderInfo,
  statusMessage: string,
): SystemProviderState {
  return {
    providerId: provider.id,
    displayName: provider.displayName,
    status: "unknown",
    statusMessage,
    accountEmail: null,
    planLabel: null,
    installedVersion: null,
    minimumSupportedVersion: null,
    canInstall: false,
    canUpdate: false,
    loginCommand: null,
    localLoginCommand: null,
    internal_DO_NOT_USE_guidedSignIn: guidedSignIn(deps, provider.id),
    internal_DO_NOT_USE_setupGuidePlanLabel: null,
  };
}

type ProviderHealthResult = HostDaemonOnlineRpcResult<"provider.health">;

interface InstalledClaim {
  promise: Promise<boolean>;
  resolve(installed: boolean): void;
  reject(error: unknown): void;
}

function createInstalledClaim(): InstalledClaim {
  const handlers: Pick<InstalledClaim, "resolve" | "reject"> = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  const promise = new Promise<boolean>((resolve, reject) => {
    handlers.resolve = resolve;
    handlers.reject = reject;
  });
  promise.catch(() => undefined);
  return { promise, ...handlers };
}

function checkProviderHealth(
  deps: AppDeps,
  args: {
    cwd?: string;
    hostId: string;
    providerId: string;
    bridgeLaunch: HostDaemonBridgeLaunch;
  },
): Promise<ProviderHealthResult> {
  return callHostRetryableOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "provider.health",
      providerId: args.providerId,
      bridgeLaunch: args.bridgeLaunch,
      ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
    },
  });
}

async function toProviderState(
  deps: AppDeps,
  args: {
    hostId: string;
    provider: ProviderInfo;
    result: ProviderHealthResult;
  },
): Promise<SystemProviderState> {
  const { provider, result } = args;
  if (!provider.maintenance.health) {
    return unknownProviderState(
      deps,
      provider,
      "This provider does not report readiness.",
    );
  }
  if (!result.supported) {
    return unknownProviderState(
      deps,
      provider,
      "Provider readiness was not reported.",
    );
  }
  const health = {
    providerId: provider.id,
    displayName: provider.displayName,
    ...result.health,
    localLoginCommand: result.health.localLoginCommand ?? null,
    internal_DO_NOT_USE_guidedSignIn: guidedSignIn(deps, provider.id),
    internal_DO_NOT_USE_setupGuidePlanLabel:
      result.health.internal_DO_NOT_USE_setupGuidePlanLabel ?? null,
  };
  if (health.status !== "unauthenticated" && health.status !== "expired") {
    return health;
  }
  const contributed = await resolvePluginProviderEnvHealth({
    providerId: provider.id,
    hostId: args.hostId,
  });
  if (contributed === null) return health;
  return {
    ...health,
    status: "ready",
    statusMessage: contributed.statusMessage,
    accountEmail: null,
    planLabel: contributed.label,
    loginCommand: null,
    localLoginCommand: null,
    internal_DO_NOT_USE_setupGuidePlanLabel: null,
  };
}

async function getProviderState(
  deps: AppDeps,
  args: { cwd?: string; hostId: string; provider: ProviderInfo },
): Promise<SystemProviderState> {
  if (!args.provider.maintenance.health) {
    return unknownProviderState(
      deps,
      args.provider,
      "This provider does not report readiness.",
    );
  }
  const bridgeLaunch = resolveBridgeLaunchForProviderId(deps, args.provider.id);
  if (bridgeLaunch === null) {
    return unknownProviderState(
      deps,
      args.provider,
      "The provider bridge is unavailable.",
    );
  }
  try {
    const result = await checkProviderHealth(deps, {
      hostId: args.hostId,
      providerId: args.provider.id,
      bridgeLaunch,
      ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
    });
    return await toProviderState(deps, {
      hostId: args.hostId,
      provider: args.provider,
      result,
    });
  } catch {
    return unknownProviderState(
      deps,
      args.provider,
      "Provider readiness could not be checked.",
    );
  }
}

async function getInstalledOnlyProviderState(
  deps: AppDeps,
  args: {
    claim: InstalledClaim | undefined;
    cwd?: string;
    hostId: string;
    provider: ProviderInfo;
    bridgeLaunch: HostDaemonBridgeLaunch;
  },
): Promise<SystemProviderState | null> {
  const { claim, provider } = args;
  const key = { hostId: args.hostId, providerId: provider.id };
  const cached =
    claim === undefined
      ? deps.providerRegistry.lookupInstalled(key)
      : undefined;
  if (cached !== undefined) {
    try {
      if (!(await cached)) {
        void deps.providerRegistry.revalidateInstalled(key, () =>
          probeInstalledProvider(deps, {
            ...args,
            providerId: provider.id,
            budget: createProviderListingBudget(),
          }),
        );
        return null;
      }
    } catch (error) {
      omitInstalledProviderAfterError(deps, key, error);
      return null;
    }
  }
  let result: ProviderHealthResult;
  try {
    result = await checkProviderHealth(deps, {
      ...args,
      providerId: provider.id,
    });
  } catch (error) {
    if (cached !== undefined) {
      return unknownProviderState(
        deps,
        provider,
        "Provider readiness could not be checked.",
      );
    }
    claim?.reject(error);
    omitInstalledProviderAfterError(deps, key, error);
    return null;
  }
  const installed = isInstalledProviderHealth(result);
  claim?.resolve(installed);
  if (!installed) return null;
  return await toProviderState(deps, {
    hostId: args.hostId,
    provider,
    result,
  }).catch(() =>
    unknownProviderState(
      deps,
      provider,
      "Provider readiness could not be checked.",
    ),
  );
}

async function getConnectedProviderStates(
  deps: AppDeps,
  args: { cwd?: string; hostId: string },
): Promise<SystemProviderState[]> {
  await deps.providerRegistry.whenRegistrationsSettled();
  const configuredIds = new Set(
    listConfiguredSystemProviderInfos(deps).map((provider) => provider.id),
  );
  const installedOnly = new Map<string, HostDaemonBridgeLaunch>();
  for (const registration of listInstalledOnlyProviderRegistrations(deps)) {
    const bridgeLaunch = resolveBridgeLaunchForProviderId(
      deps,
      registration.info.id,
    );
    if (bridgeLaunch !== null) {
      installedOnly.set(registration.info.id, bridgeLaunch);
    }
  }
  const claims = new Map<string, InstalledClaim>();
  for (const providerId of installedOnly.keys()) {
    const key = { hostId: args.hostId, providerId };
    if (deps.providerRegistry.lookupInstalled(key) !== undefined) continue;
    const claim = createInstalledClaim();
    deps.providerRegistry.rememberInstalled(key, claim.promise);
    claims.set(providerId, claim);
  }
  const providers = deps.providerRegistry
    .list()
    .map((registration) => registration.info)
    .filter(
      (provider) =>
        configuredIds.has(provider.id) || installedOnly.has(provider.id),
    );
  try {
    const states = await mapProviderMaintenanceRequests(
      providers,
      (provider) => {
        const bridgeLaunch = installedOnly.get(provider.id);
        return bridgeLaunch === undefined
          ? getProviderState(deps, { ...args, provider })
          : getInstalledOnlyProviderState(deps, {
              ...args,
              provider,
              bridgeLaunch,
              claim: claims.get(provider.id),
            });
      },
    );
    return states.filter(
      (state): state is SystemProviderState => state !== null,
    );
  } catch (error) {
    for (const claim of claims.values()) claim.reject(error);
    throw error;
  }
}

export async function getProviderStates(
  deps: AppDeps,
  query: SystemProvidersQuery,
): Promise<SystemProviderStatesResponse> {
  const hostId = resolveSystemLookupHostId(deps, query);
  const cwd =
    query.environmentId === undefined
      ? undefined
      : (requireEnvironment(deps.db, query.environmentId).path ?? undefined);
  try {
    requireConnectedHostSession(deps, hostId);
  } catch (error) {
    if (!isHostUnavailableApiError(error)) {
      throw error;
    }
    const providers = await listSystemProviderInfos(deps, { hostId });
    const statusMessage = isSuspendedHostUnavailableError(error)
      ? "Machine is paused."
      : "Provider readiness could not be checked.";
    return {
      providers: providers.map((provider) =>
        unknownProviderState(deps, provider, statusMessage),
      ),
    };
  }
  return {
    providers: await getConnectedProviderStates(deps, {
      hostId,
      ...(cwd === undefined ? {} : { cwd }),
    }),
  };
}
