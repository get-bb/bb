import { useCallback, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import type { AvailableModel, PermissionMode, ProviderInfo } from "@bb/domain";
import { SYSTEM_EXECUTION_OPTIONS_QUERY_KEY } from "@/hooks/queries/query-keys";
import {
  HIGH_REASONING_EFFORT,
  LOW_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  ULTRACODE_REASONING_EFFORT,
  XHIGH_REASONING_EFFORT,
  permissionModeValues,
} from "@bb/domain";
import { toRecord } from "@bb/core-ui";
import type {
  SystemCliSkillsStatusResponse,
  SystemConfigResponse,
  SystemExecutionOptionsResponse,
  OnboardingAgentOverview,
  SystemVersionResponse,
} from "@bb/server-contract";
import type {
  DiscoverReposResult,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import type { ProviderUsageResponse } from "@bb/host-daemon-contract";
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
  onboardingAgentsQueryKey,
  onboardingReposQueryKey,
  systemConfigQueryKey,
  systemExecutionOptionsQueryKey,
  systemProvidersQueryKey,
  systemUsageLimitsQueryKey,
  systemVersionQueryKey,
} from "./query-keys";
import { requireEnabledQueryArg } from "./query-helpers";
import {
  FOCUS_OWNED_LIVE_QUERY_POLICY,
  SERVER_SESSION_QUERY_POLICY,
  SESSION_STATIC_QUERY_POLICY,
} from "./query-policies";

export interface UseSystemExecutionOptionsArgs {
  enabled?: boolean;
  environmentId?: string;
  hostId?: string;
  providerId?: string;
}

export interface UseOnboardingAgentsOptions extends QueryOptions {
  environmentId?: string;
  hostId?: string;
  poll?: boolean;
}

interface QueryOptions {
  enabled?: boolean;
}

const SYSTEM_EXECUTION_OPTIONS_RETRY_DELAY_MS = 250;
const SYSTEM_EXECUTION_OPTIONS_RETRY_COUNT = 1;
const CLAUDE_CODE_PROVIDER_ID = "claude-code";

// ---------------------------------------------------------------------------
// Cold-cache placeholder data. Rendered only as react-query placeholderData
// while the first execution-options probe is in flight on an install that has
// never cached a probe result; every later render uses last-seen real data.
// Values are copied verbatim from the retired app-side catalog import so the
// preload window looks identical; graduation moves this server-side and
// deletes it (plans/agent-provider-plugin-surface.md, phase 6).
// ---------------------------------------------------------------------------

const XHIGH_LADDER = [
  LOW_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  HIGH_REASONING_EFFORT,
  XHIGH_REASONING_EFFORT,
  ULTRACODE_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
] as const;

const CLAUDE_CODE_PLACEHOLDER_MODELS: AvailableModel[] = [
  {
    id: "claude-fable-5",
    model: "claude-fable-5",
    displayName: "Fable 5",
    description:
      "Fable 5 for demanding reasoning; requires Claude Code v2.1.170+",
    supportedReasoningEfforts: [...XHIGH_LADDER],
    defaultReasoningEffort: "high",
    isDefault: false,
  },
  {
    id: "claude-opus-5[1m]",
    model: "claude-opus-5[1m]",
    displayName: "Opus 5 (1M)",
    description: "Opus 5 with 1M context for complex long coding sessions",
    supportedReasoningEfforts: [...XHIGH_LADDER],
    defaultReasoningEffort: "high",
    isDefault: true,
  },
  {
    id: "claude-opus-4-8[1m]",
    model: "claude-opus-4-8[1m]",
    displayName: "Opus 4.8 (1M)",
    description: "Opus 4.8 with 1M context for complex long coding sessions",
    supportedReasoningEfforts: [...XHIGH_LADDER],
    defaultReasoningEffort: "high",
    isDefault: false,
  },
  {
    id: "claude-opus-4-7[1m]",
    model: "claude-opus-4-7[1m]",
    displayName: "Opus 4.7 (1M)",
    description: "Opus 4.7 with 1M context for complex long coding sessions",
    supportedReasoningEfforts: [...XHIGH_LADDER],
    defaultReasoningEffort: "medium",
    isDefault: false,
  },
  {
    id: "claude-sonnet-5",
    model: "claude-sonnet-5",
    displayName: "Sonnet 5",
    description: "Sonnet 5 for everyday coding tasks with deeper reasoning",
    supportedReasoningEfforts: [...XHIGH_LADDER],
    defaultReasoningEffort: "medium",
    isDefault: false,
  },
];

const PLACEHOLDER_PROVIDER_INFOS: ProviderInfo[] = [
  {
    available: true,
    id: "codex",
    displayName: "Codex",
    logoUrl: null,
    capabilities: {
      supportsThreadArchive: true,
      supportsThreadRename: true,
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      supportsFork: true,
      supportsSessionRewind: true,
      permissionModes: ["accept-edits", "auto", "full"],
    },
    composerActions: [
      { kind: "skills", trigger: "/" },
      {
        kind: "plan",
        command: { trigger: "/", name: "plan", trailingText: " " },
      },
      {
        kind: "goal",
        command: { trigger: "/", name: "goal", trailingText: " " },
      },
    ],
  },
  {
    available: true,
    id: "claude-code",
    displayName: "Claude Code",
    logoUrl: null,
    capabilities: {
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsServiceTier: false,
      supportsNativeUserQuestion: true,
      supportsFork: true,
      supportsSessionRewind: true,
      permissionModes: ["accept-edits", "auto", "full"],
    },
    composerActions: [
      { kind: "skills", trigger: "/" },
      {
        kind: "plan",
        command: { trigger: "/", name: "plan", trailingText: " " },
      },
    ],
  },
  {
    available: true,
    id: "pi",
    displayName: "Pi",
    logoUrl: null,
    capabilities: {
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      supportsFork: true,
      supportsSessionRewind: true,
      permissionModes: ["full"],
    },
    composerActions: [{ kind: "skills", trigger: "/" }],
  },
  {
    available: true,
    id: "acp-cursor",
    displayName: "Cursor",
    logoUrl: null,
    capabilities: {
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      supportsFork: true,
      supportsSessionRewind: false,
      permissionModes: ["accept-edits", "full"],
    },
    composerActions: [{ kind: "skills", trigger: "/" }],
  },
];

// Model probes run on the host (Claude's spawns a CLI process; every provider
// pays a round trip), so waiting for one leaves the composer with no model list
// for seconds on each full load. Render the last catalog this routing actually
// reported immediately and let the authoritative rows replace it when the probe
// lands: its ids match what the fresh probe will return, so a selection made
// during the preload window survives instead of snapping back to a default.
//
// On a cold cache only Claude Code has curated aliases to fall back on; other
// built-in providers keep their branded identity with an empty model list while
// discovery runs, and a provider that no replayable list can vouch for waits
// for the probe, exactly as before.
//
// The provider list rides along from its own last-known cache: the live list
// carries the host's custom and installed ACP agents, so replaying only the
// built-in providers would select the first built-in one for a beat whenever
// the remembered provider is not built in. If the remembered provider is not
// in the list we can replay, there is no honest provisional frame and the
// composer waits, as it did before.
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
    (remembered !== null && remembered.length > 0
      ? remembered
      : PLACEHOLDER_PROVIDER_INFOS);
  if (
    providerId !== null &&
    !providers.some((provider) => provider.id === providerId)
  ) {
    return undefined;
  }
  const isClaudeCode = providerId === CLAUDE_CODE_PROVIDER_ID;
  return {
    providers,
    // A prior response's models belong to the prior provider. Only this
    // provider's own remembered catalog (or Claude's curated aliases) may
    // stand in while its probe runs.
    models:
      cached?.models ?? (isClaudeCode ? CLAUDE_CODE_PLACEHOLDER_MODELS : []),
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

/**
 * Reactive form of {@link findCachedProviderInfo}. The cache read alone is a
 * render-time snapshot, and a component that does not mount the
 * execution-options query itself never re-renders when that query lands — so a
 * capability-gated affordance would stay hidden until some unrelated query
 * happened to re-render the tree. Subscribing to the query cache makes it
 * appear as soon as the data arrives, without mounting a second request.
 */
export function useCachedProviderInfo(
  providerId: string | undefined,
): ProviderInfo | null {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      queryClient.getQueryCache().subscribe(onStoreChange),
    [queryClient],
  );
  const getSnapshot = useCallback(
    () =>
      providerId === undefined
        ? null
        : findCachedProviderInfo(queryClient, providerId),
    [providerId, queryClient],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
 * need to name a provider — the skills library's provider filter — should use.
 */
export function useSystemProviders(args: { enabled?: boolean } = {}) {
  const enabled = args.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });
  return useQuery<ProviderInfo[]>({
    queryKey: systemProvidersQueryKey(),
    queryFn: ({ signal }) => sdk.providers.list({ signal }),
    enabled,
    staleTime: 60_000,
  });
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

export interface UseHostProviderCliStatusArgs {
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

/**
 * Live agent state for onboarding. Polled while the step is open so installing
 * or signing in from a terminal updates the list without a manual refresh.
 */
export function useOnboardingAgents(options: UseOnboardingAgentsOptions = {}) {
  const environmentId = options.environmentId ?? null;
  const hostId = options.hostId ?? null;
  return useQuery<OnboardingAgentOverview>({
    queryKey: onboardingAgentsQueryKey({ environmentId, hostId }),
    queryFn: ({ signal }) =>
      sdk.system.onboardingAgents({
        environmentId: options.environmentId,
        hostId: options.hostId,
        signal,
      }),
    enabled: options.enabled ?? true,
    // Each read runs CLI health checks, known-agent checks, and up to three
    // provider usage requests, so this polls slowly and only while the agents
    // step is actually on screen. An explicit re-check covers the impatient
    // case. Other readers (the composer's provider default) want one answer.
    ...(options.poll === false
      ? { staleTime: 60_000 }
      : { refetchInterval: 15_000 }),
  });
}

/** Candidate projects on the host. Runs once when the projects step opens. */
export function useOnboardingRepos(options: QueryOptions = {}) {
  return useQuery<DiscoverReposResult>({
    queryKey: onboardingReposQueryKey(),
    queryFn: ({ signal }) => sdk.system.onboardingRepos({ signal }),
    enabled: options.enabled ?? true,
    staleTime: Infinity,
  });
}

export interface UseSystemUsageLimitsArgs extends QueryOptions {
  hostId?: string;
}

export function useSystemUsageLimits(args: UseSystemUsageLimitsArgs = {}) {
  const hostId = args.hostId ?? null;
  return useQuery<ProviderUsageResponse>({
    queryKey: systemUsageLimitsQueryKey(hostId),
    queryFn: ({ signal }) =>
      sdk.system.usageLimits({
        ...(args.hostId === undefined ? {} : { hostId: args.hostId }),
        signal,
      }),
    enabled: args.enabled ?? true,
    ...FOCUS_OWNED_LIVE_QUERY_POLICY,
  });
}
