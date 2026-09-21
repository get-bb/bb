import {
  useQueries,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  normalizePluginMentionTriggers,
  type PluginMentionTrigger,
} from "@bb/client-core";
import { pluginContributionsQueryKey } from "./query-keys";

interface PluginMentionProviderContribution {
  pluginId: string;
  id: string;
  label: string;
  triggers: readonly PluginMentionTrigger[];
}

interface PluginContributions {
  mentionProviders: PluginMentionProviderContribution[];
}

const EMPTY_CONTRIBUTIONS: PluginContributions = {
  mentionProviders: [],
};

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

async function fetchPluginContributions(
  signal: AbortSignal,
): Promise<PluginContributions> {
  const response = await fetch("/api/v1/plugins/contributions", { signal });
  if (!response.ok) return EMPTY_CONTRIBUTIONS;
  const body = (await response.json()) as {
    mentionProviders?: unknown;
  };
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

export function usePluginContributions() {
  return useQuery({
    queryKey: pluginContributionsQueryKey(),
    queryFn: ({ signal }) => fetchPluginContributions(signal),
    staleTime: 30_000,
  });
}
interface PluginMentionSearchItem {
  itemId: string;
  title: string;
  subtitle: string | null;
  icon: string | null;
}

export interface PluginMentionSearchGroup {
  pluginId: string;
  providerId: string;
  label: string;
  items: PluginMentionSearchItem[];
}

function isMentionSearchItem(value: unknown): value is PluginMentionSearchItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.itemId === "string" &&
    typeof item.title === "string" &&
    (item.subtitle === null || typeof item.subtitle === "string") &&
    (item.icon === null || typeof item.icon === "string")
  );
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
    group.items.every(isMentionSearchItem)
  );
}

interface PluginMentionSearchArgs {
  trigger: PluginMentionTrigger;
  query: string;
  projectId: string | null;
  threadId: string | null;
}

async function fetchPluginMentionSearch(
  args: PluginMentionSearchArgs,
  signal: AbortSignal,
  provider: PluginMentionProviderContribution,
): Promise<PluginMentionSearchGroup[]> {
  const params = new URLSearchParams({
    q: args.query,
    trigger: args.trigger,
    pluginId: provider.pluginId,
    providerId: provider.id,
  });
  if (args.projectId !== null) params.set("projectId", args.projectId);
  if (args.threadId !== null) params.set("threadId", args.threadId);
  const response = await fetch(
    `/api/v1/plugins/mentions/search?${params.toString()}`,
    { signal },
  );
  if (!response.ok) return [];
  const body = (await response.json()) as { groups?: unknown };
  return Array.isArray(body.groups)
    ? body.groups.filter(isMentionSearchGroup)
    : [];
}

function combineMentionSearches(
  results: UseQueryResult<PluginMentionSearchGroup[]>[],
) {
  return {
    data: results.flatMap((result) => result.data ?? []),
    isLoading: results.some((result) => result.isLoading),
    isFetching: results.some((result) => result.isFetching),
  };
}

export function usePluginMentionSearch(
  args: PluginMentionSearchArgs,
  options: {
    enabled: boolean;
    providers: readonly PluginMentionProviderContribution[];
  },
) {
  return useQueries({
    queries: options.providers
      .filter((provider) => provider.triggers.includes(args.trigger))
      .map((provider) => ({
        queryKey: [
          "plugin-mention-search",
          args.trigger,
          args.query,
          args.projectId,
          args.threadId,
          provider.pluginId,
          provider.id,
        ],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          fetchPluginMentionSearch(args, signal, provider),
        enabled: options.enabled,
        staleTime: 15_000,
      })),
    combine: combineMentionSearches,
  });
}
