import {
  normalizePluginMentionTriggers,
  type PluginMentionTrigger,
} from "@bb/client-core";
import type {
  CommandListResponse,
  ThreadStoragePathListResponse,
  WorkspacePathListResponse,
} from "@bb/server-contract";
import { useQuery } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import type { PluginMentionSearchGroup } from "@/composer/model";
import {
  environmentPathsQueryKey,
  pluginContributionsQueryKey,
  pluginMentionSearchQueryKey,
  projectCommandsQueryKey,
  threadStoragePathsQueryKey,
} from "@/lib/query/query-keys";
import { createMobileFetch } from "@/lib/sdk/mobile-fetch";
import { requireEnabledQueryArg } from "../shared/query-helpers";
import { TYPEAHEAD_QUERY_POLICY } from "../shared/query-policies";
import {
  useProjectDetailRealtimeSubscription,
  useThreadDetailRealtimeSubscription,
} from "../shared/use-realtime-subscription";

/**
 * Data sources behind the composer typeahead (mirrors
 * apps/app/src/hooks/queries/{plugin-contribution,environment,thread,project}-queries.ts).
 * Thread candidates come from `useThreadsList` and project/section names from
 * the sidebar bootstrap; these are the remaining, composer-only queries.
 */

interface QueryOptions {
  enabled?: boolean;
}

const PLUGIN_QUERY_STALE_TIME_MS = 30_000;
const PLUGIN_SEARCH_STALE_TIME_MS = 15_000;

// --- Plugin contributions (not in the typed SDK; server-policy glue) ---------

export interface PluginMentionProviderContribution {
  pluginId: string;
  id: string;
  label: string;
  triggers: readonly PluginMentionTrigger[];
}

export interface PluginContributions {
  mentionProviders: PluginMentionProviderContribution[];
}

const EMPTY_CONTRIBUTIONS: PluginContributions = { mentionProviders: [] };

function toMentionProviderContribution(
  value: unknown,
): PluginMentionProviderContribution | null {
  if (typeof value !== "object" || value === null) return null;
  const provider = value as Record<string, unknown>;
  const triggers = normalizePluginMentionTriggers(provider.triggers);
  if (triggers === null) return null;
  if (
    typeof provider.pluginId !== "string" ||
    typeof provider.id !== "string" ||
    typeof provider.label !== "string"
  ) {
    return null;
  }
  return {
    pluginId: provider.pluginId,
    id: provider.id,
    label: provider.label,
    triggers,
  };
}

function apiUrl(serverUrl: string, path: string): string {
  return `${serverUrl.replace(/\/+$/u, "")}/api/v1${path}`;
}

async function fetchPluginContributions(
  serverUrl: string,
  signal: AbortSignal,
): Promise<PluginContributions> {
  const response = await createMobileFetch(fetch)(
    apiUrl(serverUrl, "/plugins/contributions"),
    { signal },
  );
  // An older server (no plugin routes) means "no contributions", not an error.
  if (!response.ok) return EMPTY_CONTRIBUTIONS;
  const body = (await response.json()) as { mentionProviders?: unknown };
  return {
    mentionProviders: Array.isArray(body.mentionProviders)
      ? body.mentionProviders
          .map(toMentionProviderContribution)
          .filter(
            (provider): provider is PluginMentionProviderContribution =>
              provider !== null,
          )
      : [],
  };
}

export function usePluginContributions(options?: QueryOptions) {
  const { serverUrl } = useProfileClient();
  return useQuery({
    queryKey: pluginContributionsQueryKey(),
    queryFn: ({ signal }) => fetchPluginContributions(serverUrl, signal),
    enabled: options?.enabled ?? true,
    staleTime: PLUGIN_QUERY_STALE_TIME_MS,
  });
}

// --- Plugin mention search ----------------------------------------------------

export interface PluginMentionSearchArgs {
  trigger: PluginMentionTrigger;
  query: string;
  projectId: string | null;
  threadId: string | null;
}

function isMentionSearchGroup(
  value: unknown,
): value is PluginMentionSearchGroup {
  if (typeof value !== "object" || value === null) return false;
  const group = value as Record<string, unknown>;
  return (
    typeof group.pluginId === "string" &&
    typeof group.providerId === "string" &&
    typeof group.label === "string" &&
    Array.isArray(group.items) &&
    group.items.every((item) => {
      if (typeof item !== "object" || item === null) return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record.itemId === "string" &&
        typeof record.title === "string" &&
        (record.subtitle === null || typeof record.subtitle === "string") &&
        (record.icon === null || typeof record.icon === "string")
      );
    })
  );
}

async function fetchPluginMentionSearch(
  serverUrl: string,
  args: PluginMentionSearchArgs,
  signal: AbortSignal,
): Promise<PluginMentionSearchGroup[]> {
  const params = new URLSearchParams({ q: args.query, trigger: args.trigger });
  if (args.projectId !== null) params.set("projectId", args.projectId);
  if (args.threadId !== null) params.set("threadId", args.threadId);
  const response = await createMobileFetch(fetch)(
    apiUrl(serverUrl, `/plugins/mentions/search?${params.toString()}`),
    { signal },
  );
  if (!response.ok) return [];
  const body = (await response.json()) as { groups?: unknown };
  return Array.isArray(body.groups)
    ? body.groups.filter(isMentionSearchGroup)
    : [];
}

export function usePluginMentionSearch(
  args: PluginMentionSearchArgs,
  options: { enabled: boolean },
) {
  const { serverUrl } = useProfileClient();
  return useQuery({
    queryKey: pluginMentionSearchQueryKey(
      args.trigger,
      args.query,
      args.projectId,
      args.threadId,
    ),
    queryFn: ({ signal }) => fetchPluginMentionSearch(serverUrl, args, signal),
    enabled: options.enabled,
    staleTime: PLUGIN_SEARCH_STALE_TIME_MS,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === args.trigger ? previous : undefined,
  });
}

// --- Paths -------------------------------------------------------------------

export interface PathListArgs {
  query: string | null;
  limit: number;
  includeFiles: boolean;
  includeDirectories: boolean;
}

/** Fuzzy paths inside an environment's workspace (`GET /environments/:id/paths`). */
export function useEnvironmentPaths(
  environmentId: string | null,
  args: PathListArgs,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const query = args.query?.trim() ?? "";
  const enabled =
    (options?.enabled ?? true) && environmentId !== null && query.length > 0;
  return useQuery<WorkspacePathListResponse>({
    queryKey: environmentPathsQueryKey(
      environmentId ?? "",
      query,
      args.limit,
      args.includeFiles,
      args.includeDirectories,
    ),
    queryFn: ({ signal }) =>
      sdk.environments.paths({
        environmentId: requireEnabledQueryArg({
          value: environmentId ?? undefined,
          hookName: "useEnvironmentPaths",
          argName: "environmentId",
        }),
        query,
        limit: String(args.limit),
        includeFiles: args.includeFiles ? "true" : "false",
        includeDirectories: args.includeDirectories ? "true" : "false",
        signal,
      }),
    enabled,
    ...TYPEAHEAD_QUERY_POLICY,
    placeholderData: (previous) => previous,
  });
}

/** Files under the thread's storage directory (`GET /threads/:id/storage/paths`). */
export function useThreadStoragePaths(
  threadId: string | null,
  args: PathListArgs,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const query = args.query?.trim() ?? "";
  const enabled =
    (options?.enabled ?? true) && threadId !== null && query.length > 0;
  useThreadDetailRealtimeSubscription(threadId ?? undefined, { enabled });
  return useQuery<ThreadStoragePathListResponse>({
    queryKey: threadStoragePathsQueryKey(
      threadId ?? "",
      query,
      args.limit,
      args.includeFiles,
      args.includeDirectories,
    ),
    queryFn: ({ signal }) =>
      sdk.threads.storagePaths({
        threadId: requireEnabledQueryArg({
          value: threadId ?? undefined,
          hookName: "useThreadStoragePaths",
          argName: "threadId",
        }),
        query,
        limit: String(args.limit),
        includeFiles: args.includeFiles ? "true" : "false",
        includeDirectories: args.includeDirectories ? "true" : "false",
        signal,
      }),
    enabled,
    ...TYPEAHEAD_QUERY_POLICY,
    placeholderData: (previous) => previous,
  });
}

// --- Commands ----------------------------------------------------------------

export interface UseProjectCommandsArgs {
  projectId: string | null;
  providerId: string | null;
  environmentId: string | null;
  hostId: string | null;
}

/**
 * The provider's skill / command catalog for a project
 * (`GET /projects/:id/commands?provider=`). Always refetched when the slash
 * menu opens (provider-native files change on disk); typing filters locally.
 */
export function useProjectCommands(
  args: UseProjectCommandsArgs,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const enabled =
    (options?.enabled ?? true) &&
    args.projectId !== null &&
    args.providerId !== null;
  useProjectDetailRealtimeSubscription(args.projectId ?? undefined, {
    enabled,
  });
  return useQuery<CommandListResponse>({
    queryKey: projectCommandsQueryKey(
      args.projectId ?? "",
      args.providerId ?? "",
      args.environmentId,
      args.hostId,
    ),
    queryFn: ({ signal }) =>
      sdk.projects.commands({
        projectId: requireEnabledQueryArg({
          value: args.projectId ?? undefined,
          hookName: "useProjectCommands",
          argName: "projectId",
        }),
        provider: requireEnabledQueryArg({
          value: args.providerId ?? undefined,
          hookName: "useProjectCommands",
          argName: "providerId",
        }),
        signal,
        ...(args.environmentId !== null
          ? { environmentId: args.environmentId }
          : args.hostId !== null
            ? { hostId: args.hostId }
            : {}),
      }),
    enabled,
    ...TYPEAHEAD_QUERY_POLICY,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}
