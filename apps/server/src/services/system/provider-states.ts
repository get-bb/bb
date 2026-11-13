import type {
  SystemProviderState,
  SystemProviderStatesResponse,
  SystemProviderStatesQuery,
} from "@bb/server-contract";
import type { ProviderInfo } from "@bb/domain";
import type { HostDaemonBridgeLaunch } from "@bb/host-daemon-contract";
import type { LoggedWorkSessionDeps } from "../../types.js";
import type { ProviderRegistryService } from "../providers/provider-registry.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { isHostUnavailableApiError } from "../hosts/online-rpc.js";
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
import {
  findProviderHealthRequest,
  requestProviderHealth,
  type ProviderHealthResult,
} from "./provider-health-requests.js";
import { resolveSystemLookupHostId } from "./host-lookup.js";
import { resolveBridgeLaunchForProviderId } from "./provider-bridge-launch.js";
import { mapProviderMaintenanceRequests } from "./provider-maintenance-concurrency.js";
import { resolvePluginProviderEnvHealth } from "../plugins/plugin-agent-contributions.js";
import { isSuspendedHostUnavailableError } from "../lib/lifecycle-api-errors.js";

function guidedSignIn(
  deps: LoggedWorkSessionDeps,
  providerId: string,
): boolean {
  return deps.providerRegistry.get(providerId)?.guidedSignIn ?? false;
}

function unknownProviderState(
  deps: LoggedWorkSessionDeps,
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

async function toProviderState(
  deps: LoggedWorkSessionDeps,
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
  deps: LoggedWorkSessionDeps,
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
    const result = await requestProviderHealth(deps, {
      ...args,
      providerId: args.provider.id,
      bridgeLaunch,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    return await toProviderState(deps, { ...args, result });
  } catch {
    return unknownProviderState(
      deps,
      args.provider,
      "Provider readiness could not be checked.",
    );
  }
}

async function getInstalledOnlyProviderState(
  deps: LoggedWorkSessionDeps,
  args: {
    cwd?: string;
    hostId: string;
    provider: ProviderInfo;
    bridgeLaunch: HostDaemonBridgeLaunch;
  },
): Promise<SystemProviderState | null> {
  const { provider } = args;
  const key = { hostId: args.hostId, providerId: provider.id };
  const healthArgs = { ...args, providerId: provider.id };
  const cached = deps.providerRegistry.lookupInstalled(key);
  let request = findProviderHealthRequest(deps, healthArgs);
  if (request === undefined) {
    try {
      if (cached !== undefined && !(await cached)) {
        void deps.providerRegistry.revalidateInstalled(key, () =>
          probeInstalledProvider(deps, {
            ...healthArgs,
            budget: createProviderListingBudget(),
          }),
        );
        return null;
      }
    } catch (error) {
      omitInstalledProviderAfterError(deps, key, error);
      return null;
    }
    request = requestProviderHealth(deps, {
      ...healthArgs,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    if (cached === undefined) {
      const installed = request.then(isInstalledProviderHealth);
      installed.catch(() => undefined);
      deps.providerRegistry.rememberInstalled(key, installed);
    }
  }
  let result: ProviderHealthResult;
  try {
    result = await request;
  } catch (error) {
    const knownInstalled =
      cached === undefined ? false : await cached.catch(() => false);
    if (knownInstalled) {
      return unknownProviderState(
        deps,
        provider,
        "Provider readiness could not be checked.",
      );
    }
    omitInstalledProviderAfterError(deps, key, error);
    return null;
  }
  if (!isInstalledProviderHealth(result)) return null;
  return await toProviderState(deps, { ...args, result }).catch(() =>
    unknownProviderState(
      deps,
      provider,
      "Provider readiness could not be checked.",
    ),
  );
}

async function getConnectedProviderStates(
  deps: LoggedWorkSessionDeps,
  args: { cwd?: string; hostId: string },
): Promise<SystemProviderState[]> {
  await deps.providerRegistry.whenRegistrationsSettled();
  return await checkProviderStates(deps, args, listCheckedProviders(deps));
}

interface CheckedProvider {
  provider: ProviderInfo;
  installedOnlyBridgeLaunch: HostDaemonBridgeLaunch | null;
}

function listCheckedProviders(deps: LoggedWorkSessionDeps): CheckedProvider[] {
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
  const providers = deps.providerRegistry
    .list()
    .map((registration) => registration.info)
    .filter(
      (provider) =>
        configuredIds.has(provider.id) || installedOnly.has(provider.id),
    );
  return providers.map((provider) => ({
    provider,
    installedOnlyBridgeLaunch: installedOnly.get(provider.id) ?? null,
  }));
}

async function checkProviderStates(
  deps: LoggedWorkSessionDeps,
  args: { cwd?: string; hostId: string },
  providers: readonly CheckedProvider[],
  onChecked?: (providerId: string, state: SystemProviderState | null) => void,
): Promise<SystemProviderState[]> {
  const states = await mapProviderMaintenanceRequests(
    providers,
    async ({ provider, installedOnlyBridgeLaunch }) => {
      const state =
        installedOnlyBridgeLaunch === null
          ? await getProviderState(deps, { ...args, provider })
          : await getInstalledOnlyProviderState(deps, {
              ...args,
              provider,
              bridgeLaunch: installedOnlyBridgeLaunch,
            });
      onChecked?.(provider.id, state);
      return state;
    },
  );
  return states.filter((state): state is SystemProviderState => state !== null);
}

interface HeldProviderStateChecks {
  sessionId: string;
  expiresAt: number;
  taken: boolean;
  states: Promise<SystemProviderState[]>;
  byProviderId: Map<string, Promise<SystemProviderState | null>>;
}

const heldChecksByRegistry = new WeakMap<
  ProviderRegistryService,
  Map<string, HeldProviderStateChecks>
>();

function heldChecks(
  deps: Pick<LoggedWorkSessionDeps, "providerRegistry">,
): Map<string, HeldProviderStateChecks> {
  let held = heldChecksByRegistry.get(deps.providerRegistry);
  if (held === undefined) {
    held = new Map();
    heldChecksByRegistry.set(deps.providerRegistry, held);
  }
  return held;
}

export async function checkProviderStatesForNextRead(
  deps: LoggedWorkSessionDeps,
  args: { hostId: string; sessionId: string; holdMs: number },
): Promise<SystemProviderState[]> {
  await deps.providerRegistry.whenRegistrationsSettled();
  const providers = listCheckedProviders(deps);
  const settle = new Map<
    string,
    {
      resolve: (state: SystemProviderState | null) => void;
      reject: (error: unknown) => void;
    }
  >();
  const byProviderId = new Map(
    providers.map(({ provider }) => [
      provider.id,
      new Promise<SystemProviderState | null>((resolve, reject) => {
        settle.set(provider.id, { resolve, reject });
      }),
    ]),
  );
  for (const state of byProviderId.values()) state.catch(() => undefined);
  const states = checkProviderStates(
    deps,
    { hostId: args.hostId },
    providers,
    (providerId, state) => settle.get(providerId)?.resolve(state),
  );
  const held = heldChecks(deps);
  const entry: HeldProviderStateChecks = {
    sessionId: args.sessionId,
    expiresAt: Date.now() + args.holdMs,
    taken: false,
    states,
    byProviderId,
  };
  held.set(args.hostId, entry);
  states.catch((error: unknown) => {
    for (const { reject } of settle.values()) reject(error);
    if (held.get(args.hostId) === entry) held.delete(args.hostId);
  });
  return await states;
}

function findHeldChecks(
  deps: LoggedWorkSessionDeps,
  hostId: string,
): HeldProviderStateChecks | null {
  const held = heldChecks(deps);
  const entry = held.get(hostId);
  if (entry === undefined) return null;
  if (
    entry.expiresAt > Date.now() &&
    deps.hub.getDaemonSessionIdForHost(hostId) === entry.sessionId
  ) {
    return entry;
  }
  held.delete(hostId);
  return null;
}

function takeHeldProviderStates(
  deps: LoggedWorkSessionDeps,
  hostId: string,
): Promise<SystemProviderState[]> | null {
  const entry = findHeldChecks(deps, hostId);
  if (entry === null || entry.taken) return null;
  entry.taken = true;
  return entry.states;
}

async function getOneProviderState(
  deps: LoggedWorkSessionDeps,
  args: { cwd?: string; hostId: string; providerId: string },
): Promise<SystemProviderState[]> {
  const held =
    args.cwd === undefined
      ? findHeldChecks(deps, args.hostId)?.byProviderId.get(args.providerId)
      : undefined;
  if (held !== undefined) {
    const state = await held;
    return state === null ? [] : [state];
  }
  await deps.providerRegistry.whenRegistrationsSettled();
  return await checkProviderStates(
    deps,
    args,
    listCheckedProviders(deps).filter(
      ({ provider }) => provider.id === args.providerId,
    ),
  );
}

export async function getProviderStates(
  deps: LoggedWorkSessionDeps,
  query: SystemProviderStatesQuery,
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
      providers: providers
        .filter(
          (provider) =>
            query.providerId === undefined || provider.id === query.providerId,
        )
        .map((provider) => unknownProviderState(deps, provider, statusMessage)),
    };
  }
  const args = { hostId, ...(cwd === undefined ? {} : { cwd }) };
  if (query.providerId !== undefined) {
    return {
      providers: await getOneProviderState(deps, {
        ...args,
        providerId: query.providerId,
      }),
    };
  }
  const held = cwd === undefined ? takeHeldProviderStates(deps, hostId) : null;
  return {
    providers: await (held ?? getConnectedProviderStates(deps, args)),
  };
}
