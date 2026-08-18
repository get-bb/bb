import { useCallback, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import type { AvailableModel, ProviderInfo } from "@bb/domain";
import { SYSTEM_EXECUTION_OPTIONS_QUERY_KEY } from "@/hooks/queries/query-keys";
import {
  HIGH_REASONING_EFFORT,
  LOW_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  ULTRACODE_REASONING_EFFORT,
  XHIGH_REASONING_EFFORT,
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
  claudeModelCatalogCacheKey,
  readCachedClaudeModelCatalog,
  writeCachedClaudeModelCatalog,
} from "@/lib/claude-model-catalog-cache";
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

// Seed only the stable identities from the same built-in placeholder catalog
// used by the server. This keeps the picker branded while model discovery runs;
// the authoritative response still replaces it and adds configured providers.
function builtInProviderPlaceholderExecutionOptions(): SystemExecutionOptionsResponse {
  return {
    providers: PLACEHOLDER_PROVIDER_INFOS,
    models: [],
    selectedOnlyModels: [],
    permissionCeiling: "full",
    modelLoadError: null,
  };
}

// Claude's account-scoped model probe spawns a CLI process on the host, so
// waiting for it leaves the composer with no model list for seconds. Render a
// provisional catalog immediately and let the authoritative rows replace it when
// the probe lands.
//
// Prefer the last catalog this account actually reported: its ids match what the
// fresh probe will return, so a selection made during the preload window
// survives instead of snapping back to a default. The curated aliases are only
// for a cold cache, where no account-scoped ids are known yet.
//
// Callers must gate model recovery on `isPlaceholderData` either way: a cached
// catalog can be stale, so absence from this list is not evidence that a stored
// model was retired.
function claudeCodePlaceholderExecutionOptions(
  cacheKey: string,
): SystemExecutionOptionsResponse {
  const cached = readCachedClaudeModelCatalog(cacheKey);
  return {
    providers: cached?.providers ?? PLACEHOLDER_PROVIDER_INFOS,
    models: cached?.models ?? CLAUDE_CODE_PLACEHOLDER_MODELS,
    selectedOnlyModels: cached?.selectedOnlyModels ?? [],
    permissionCeiling: "full",
    modelLoadError: null,
  };
}

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
  isClaudeCode,
  canPreloadBuiltInProviders,
  catalogCacheKey,
}: {
  previousData: SystemExecutionOptionsResponse | undefined;
  previousQueryKey: QueryKey | undefined;
  environmentId: string | null;
  hostId: string | null;
  isClaudeCode: boolean;
  canPreloadBuiltInProviders: boolean;
  catalogCacheKey: string;
}): SystemExecutionOptionsResponse | undefined {
  const previousProviders = isSameExecutionOptionsRoute(
    previousQueryKey,
    environmentId,
    hostId,
  )
    ? previousData?.providers
    : undefined;
  const builtInPlaceholder = canPreloadBuiltInProviders
    ? isClaudeCode
      ? claudeCodePlaceholderExecutionOptions(catalogCacheKey)
      : builtInProviderPlaceholderExecutionOptions()
    : undefined;

  if (previousProviders === undefined && builtInPlaceholder === undefined) {
    return undefined;
  }

  return {
    providers: previousProviders ?? builtInPlaceholder?.providers ?? [],
    // A prior response's models belong to the prior provider. Keep only the
    // provider-independent roster while the newly selected provider loads.
    models: builtInPlaceholder?.models ?? [],
    selectedOnlyModels: builtInPlaceholder?.selectedOnlyModels ?? [],
    permissionCeiling: builtInPlaceholder?.permissionCeiling ?? "full",
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
  const isClaudeCode = providerId === CLAUDE_CODE_PROVIDER_ID;
  const canPreloadBuiltInProviders =
    providerId === null ||
    PLACEHOLDER_PROVIDER_INFOS.some((provider) => provider.id === providerId);
  const catalogCacheKey = claudeModelCatalogCacheKey({
    environmentId,
    hostId,
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
      // Only a verified catalog is worth remembering. Caching a provisional list
      // would let the server's probe-failure fallback masquerade as this
      // account's real models on the next cold load.
      if (isClaudeCode && response.modelLoadError === null) {
        writeCachedClaudeModelCatalog(catalogCacheKey, {
          models: response.models,
          selectedOnlyModels: response.selectedOnlyModels,
          providers: response.providers,
        });
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
        isClaudeCode,
        canPreloadBuiltInProviders,
        catalogCacheKey,
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
