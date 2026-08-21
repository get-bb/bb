import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import type { PermissionMode, ProviderInfo } from "@bb/domain";
import { SYSTEM_EXECUTION_OPTIONS_QUERY_KEY } from "@/hooks/queries/query-keys";
import { permissionModeValues } from "@bb/domain";
import { toRecord } from "@bb/core-ui";
import type {
  SystemCliSkillsStatusResponse,
  SystemConfigResponse,
  SystemExecutionOptionsResponse,
  SystemProvidersQuery,
  SystemProviderStatesResponse,
  SystemVersionResponse,
} from "@bb/server-contract";
import type {
  ProviderCliStatusResponse,
  ProviderUsage,
  ProviderUsageResponse,
} from "@bb/host-daemon-contract";
import { BbHttpError, sdk } from "@/lib/sdk";
import {
  modelCatalogCacheKey,
  readCachedModelCatalog,
  writeCachedModelCatalog,
} from "@/lib/model-catalog-cache";
import {
  providerListCacheKey,
  readCachedProviderList,
  writeCachedProviderList,
} from "@/lib/provider-list-cache";
import { useSystemRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import {
  hostProviderCliStatusQueryKey,
  systemCliSkillsQueryKey,
  systemConfigQueryKey,
  systemExecutionOptionsQueryKey,
  systemProvidersQueryKey,
  systemProviderStatesQueryKey,
  systemUsageLimitsQueryKey,
  systemVersionQueryKey,
} from "./query-keys";
import { requireEnabledQueryArg, type QueryOptions } from "./query-helpers";
import {
  FOCUS_OWNED_LIVE_QUERY_POLICY,
  SERVER_SESSION_QUERY_POLICY,
  SESSION_STATIC_QUERY_POLICY,
} from "./query-policies";

interface UseSystemExecutionOptionsArgs {
  enabled?: boolean;
  environmentId?: string;
  hostId?: string;
  providerId?: string;
}

interface UseSystemProviderStatesOptions extends QueryOptions {
  environmentId?: string;
  hostId?: string;
  poll?: boolean;
}

type SystemProviderRoutingArgs =
  | { environmentId: string; hostId?: never }
  | { environmentId?: never; hostId: string }
  | { environmentId?: never; hostId?: never };

type UseSystemProvidersArgs = QueryOptions &
  SystemProviderRoutingArgs &
  Pick<SystemProvidersQuery, "capability">;

type UseSystemProviderInfoArgs = UseSystemProvidersArgs & {
  providerId?: string;
};

const SYSTEM_EXECUTION_OPTIONS_RETRY_DELAY_MS = 250;
const SYSTEM_EXECUTION_OPTIONS_RETRY_COUNT = 1;
// Model probes run on the host (Claude's spawns a CLI process; every provider
// pays a round trip), so waiting for one leaves the composer with no model list
// for seconds on each full load. Render the last catalog this routing actually
// reported immediately and let the authoritative rows replace it when the probe
// lands: its ids match what the fresh probe will return, so a selection made
// during the preload window survives instead of snapping back to a default.
//
// On a cold cache there is nothing to replay: the app vendors no provider
// roster and no model catalog of its own (a provider's declared cold-cache
// fallback is served by the server when a probe fails), so the composer waits
// for the first probe, and a provider that no replayable list can vouch for
// waits too.
//
// The provider list rides along from its own last-known cache: the live list
// carries the host's custom and installed ACP agents. If the remembered
// provider is not in the list we can replay, there is no honest provisional
// frame and the composer waits.
//
// Callers must gate model recovery on `isPlaceholderData` either way: a cached
// catalog can be stale, so absence from this list is not evidence that a stored
// model was retired.
//
// The placeholder's permission ceiling is the most restrictive mode. Consumers
// ignore the ceiling while data is provisional, so the value is never used —
// but a replay must fail safe if a future reader forgets that gate.
const PLACEHOLDER_PERMISSION_CEILING: PermissionMode = permissionModeValues[0];

function isSameExecutionOptionsRoute(
  previousQueryKey: QueryKey | undefined,
  environmentId: string | null,
  hostId: string | null,
): boolean {
  return (
    previousQueryKey?.[0] === SYSTEM_EXECUTION_OPTIONS_QUERY_KEY &&
    previousQueryKey[1] === environmentId &&
    previousQueryKey[2] === hostId
  );
}

function resolveExecutionOptionsPlaceholder({
  previousData,
  previousQueryKey,
  environmentId,
  hostId,
  providerId,
  catalogCacheKey,
  providersCacheKey,
}: {
  previousData: SystemExecutionOptionsResponse | undefined;
  previousQueryKey: QueryKey | undefined;
  environmentId: string | null;
  hostId: string | null;
  providerId: string | null;
  catalogCacheKey: string;
  providersCacheKey: string;
}): SystemExecutionOptionsResponse | undefined {
  // Same-route provider roster from the prior response: dynamic (ACP) tabs
  // stay visible while the newly selected provider's models load.
  const previousProviders = isSameExecutionOptionsRoute(
    previousQueryKey,
    environmentId,
    hostId,
  )
    ? previousData?.providers
    : undefined;
  // Only the exact routing key replays. The model endpoint resolves the
  // environment's path as its working directory and a host's account decides
  // its entitlements, so a catalog observed on one environment or host says
  // nothing about another — and a placeholder is enough for a composer to
  // offer a model, so a cross-route replay could let it submit one the current
  // route never returned. A routing that was never fetched to completion (a
  // composer mounted before its environment is known) gets no rows and waits
  // for its own probe.
  const cached = readCachedModelCatalog(catalogCacheKey);
  const remembered = readCachedProviderList(providersCacheKey);
  const providers =
    previousProviders ??
    (remembered !== null && remembered.length > 0 ? remembered : null);
  if (
    providers === null ||
    (providerId !== null &&
      !providers.some((provider) => provider.id === providerId))
  ) {
    return undefined;
  }
  return {
    providers,
    // A prior response's models belong to the prior provider. Only this
    // provider's own remembered catalog may stand in while its probe runs.
    models: cached?.models ?? [],
    selectedOnlyModels: cached?.selectedOnlyModels ?? [],
    permissionCeiling: PLACEHOLDER_PERMISSION_CEILING,
    modelLoadError: null,
  };
}

/**
 * The freshest ProviderInfo the client already has for a provider id, scanned
 * across every cached execution-options response (any environment/host).
 * Null when no cached response mentions the id — callers treat that as the
 * capability being absent (graceful absence for unknown providers).
 */
export function findCachedProviderInfo(
  queryClient: import("@tanstack/react-query").QueryClient,
  providerId: string,
): ProviderInfo | null {
  const entries = queryClient.getQueriesData<SystemExecutionOptionsResponse>({
    queryKey: [SYSTEM_EXECUTION_OPTIONS_QUERY_KEY],
  });
  for (const [, data] of entries) {
    const match = data?.providers.find((info) => info.id === providerId);
    if (match !== undefined) {
      return match;
    }
  }
  return null;
}

function isAbortLikeError(error: unknown): boolean {
  return toRecord(error)?.name === "AbortError";
}

function shouldRetrySystemExecutionOptions(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= SYSTEM_EXECUTION_OPTIONS_RETRY_COUNT) {
    return false;
  }

  if (isAbortLikeError(error)) {
    return false;
  }

  if (error instanceof BbHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }

  return true;
}

/**
 * The provider roster with the server's display names. Cheaper than the full
 * execution-options query (no model probe), which is what surfaces that only
 * need provider metadata or capabilities should use.
 */
export function useSystemProviders(args: UseSystemProvidersArgs = {}) {
  const capability = args.capability ?? null;
  const environmentId = args.environmentId ?? null;
  const hostId = args.hostId ?? null;
  const enabled = args.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });
  return useQuery<ProviderInfo[]>({
    queryKey: systemProvidersQueryKey({ capability, environmentId, hostId }),
    queryFn: ({ signal }) => {
      if (args.environmentId !== undefined) {
        return sdk.providers.list({
          ...(args.capability === undefined
            ? {}
            : { capability: args.capability }),
          environmentId: args.environmentId,
          signal,
        });
      }
      if (args.hostId !== undefined) {
        return sdk.providers.list({
          ...(args.capability === undefined
            ? {}
            : { capability: args.capability }),
          hostId: args.hostId,
          signal,
        });
      }
      return sdk.providers.list({
        ...(args.capability === undefined
          ? {}
          : { capability: args.capability }),
        signal,
      });
    },
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Resolve one provider from the lightweight provider roster. Unlike the full
 * execution-options request, this does not wait for model discovery, so
 * capability-gated controls can render as soon as provider metadata arrives.
 * A just-submitted composer has already loaded the same provider facts through
 * execution options, so reuse that warm cache synchronously during navigation
 * while the lightweight roster fills its own route-scoped cache.
 */
export function useSystemProviderInfo({
  providerId,
  ...args
}: UseSystemProviderInfoArgs): ProviderInfo | null {
  const queryClient = useQueryClient();
  const providersQuery = useSystemProviders({
    ...args,
    enabled: (args.enabled ?? true) && providerId !== undefined,
  });
  return (
    providersQuery.data?.find((provider) => provider.id === providerId) ??
    (providerId === undefined
      ? null
      : findCachedProviderInfo(queryClient, providerId))
  );
}

export function useSystemExecutionOptions(
  args: UseSystemExecutionOptionsArgs = {},
) {
  const environmentId = args.environmentId ?? null;
  const hostId = args.hostId ?? null;
  const providerId = args.providerId ?? null;
  const enabled = args.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });
  const providersCacheKey = providerListCacheKey({ environmentId, hostId });
  const catalogCacheKey = modelCatalogCacheKey({
    environmentId,
    hostId,
    providerId,
  });
  return useQuery<SystemExecutionOptionsResponse>({
    queryKey: systemExecutionOptionsQueryKey({
      environmentId,
      hostId,
      providerId,
    }),
    queryFn: async ({ signal }) => {
      const response = await sdk.system.executionOptions({
        environmentId: args.environmentId,
        hostId: args.hostId,
        providerId: args.providerId,
        signal,
      });
      // The provider list is authoritative whether or not the model probe
      // succeeded. Only a verified catalog is worth remembering, though:
      // caching a provisional list would let the server's probe-failure
      // fallback masquerade as this routing's real models on the next cold
      // load.
      writeCachedProviderList(providersCacheKey, response.providers);
      if (response.modelLoadError === null) {
        const catalog = {
          models: response.models,
          selectedOnlyModels: response.selectedOnlyModels,
        };
        writeCachedModelCatalog(catalogCacheKey, catalog);
      }
      return response;
    },
    enabled,
    staleTime: 60_000,
    retry: shouldRetrySystemExecutionOptions,
    retryDelay: SYSTEM_EXECUTION_OPTIONS_RETRY_DELAY_MS,
    placeholderData: (previousData, previousQuery) =>
      resolveExecutionOptionsPlaceholder({
        previousData,
        previousQueryKey: previousQuery?.queryKey,
        environmentId,
        hostId,
        providerId,
        catalogCacheKey,
        providersCacheKey,
      }),
  });
}

export function useSystemConfig(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });

  return useQuery<SystemConfigResponse>({
    queryKey: systemConfigQueryKey(),
    queryFn: ({ signal }) => sdk.system.config({ signal }),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Per-machine install state of bb's built-in CLI skills. Each read asks every
 * enrolled machine's daemon, so it is fetched on demand (the settings section)
 * rather than kept fresh in the background.
 */
export function useCliSkillsStatus(options?: QueryOptions) {
  return useQuery<SystemCliSkillsStatusResponse>({
    queryKey: systemCliSkillsQueryKey(),
    queryFn: ({ signal }) => sdk.system.cliSkillsStatus({ signal }),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useSystemVersion(options?: QueryOptions) {
  return useQuery<SystemVersionResponse>({
    queryKey: systemVersionQueryKey(),
    queryFn: ({ signal }) => sdk.system.version({ signal }),
    enabled: options?.enabled ?? true,
    ...SERVER_SESSION_QUERY_POLICY,
  });
}

interface UseHostProviderCliStatusArgs {
  hostId: string | null;
  enabled?: boolean;
}

export function useHostProviderCliStatus({
  hostId,
  enabled,
}: UseHostProviderCliStatusArgs) {
  return useQuery<ProviderCliStatusResponse>({
    queryKey: hostProviderCliStatusQueryKey(hostId),
    queryFn: ({ signal }) =>
      sdk.hosts.providerCliStatus({
        hostId: requireEnabledQueryArg({
          value: hostId,
          hookName: "useHostProviderCliStatus",
          argName: "hostId",
        }),
        signal,
      }),
    enabled: (enabled ?? true) && hostId !== null,
    ...SESSION_STATIC_QUERY_POLICY,
  });
}

/** Live provider readiness for unset composer selection. */
export function useSystemProviderStates(
  options: UseSystemProviderStatesOptions = {},
) {
  const environmentId = options.environmentId ?? null;
  const hostId = options.hostId ?? null;
  return useQuery<SystemProviderStatesResponse>({
    queryKey: systemProviderStatesQueryKey({ environmentId, hostId }),
    queryFn: ({ signal }) =>
      sdk.system.providerStates({
        environmentId: options.environmentId,
        hostId: options.hostId,
        signal,
      }),
    enabled: options.enabled ?? true,
    // Each read starts sessionless bridge health checks. The root composer's
    // provider default wants one answer rather than a polling query.
    ...(options.poll === false
      ? { staleTime: 60_000 }
      : { refetchInterval: 15_000 }),
  });
}

export interface ProviderUsageQueryState {
  isError: boolean;
  isLoading: boolean;
}

interface UseSystemProviderUsageLimitsArgs extends QueryOptions {
  hostId?: string;
  providerIds: readonly string[];
}

/** Loads each provider independently so one slow bridge cannot block peers. */
export function useSystemProviderUsageLimits(
  args: UseSystemProviderUsageLimitsArgs,
) {
  const hostId = args.hostId ?? null;
  const enabled = args.enabled ?? true;
  const queries = useQueries({
    queries: args.providerIds.map((providerId) => ({
      queryKey: systemUsageLimitsQueryKey(hostId, providerId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        sdk.system.usageLimits({
          ...(args.hostId === undefined ? {} : { hostId: args.hostId }),
          providerId,
          signal,
        }),
      enabled,
      ...FOCUS_OWNED_LIVE_QUERY_POLICY,
    })),
  });
  const usage: ProviderUsageResponse = {};
  const providerStates: Record<string, ProviderUsageQueryState> = {};

  args.providerIds.forEach((providerId, index) => {
    const query = queries[index];
    if (query === undefined) return;
    const providerUsage: ProviderUsage | undefined = query.data?.[providerId];
    if (providerUsage !== undefined) {
      usage[providerId] = providerUsage;
    }
    providerStates[providerId] = {
      isError: query.isError,
      isLoading: query.isLoading,
    };
  });

  return {
    isError: queries.some((query) => query.isError),
    isFetching: queries.some((query) => query.isFetching),
    isLoading: queries.some((query) => query.isLoading),
    providerStates,
    refetch: async () => {
      await Promise.all(queries.map((query) => query.refetch()));
    },
    usage,
  };
}
