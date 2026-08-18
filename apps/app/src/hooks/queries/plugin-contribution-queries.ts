import { useQuery } from "@tanstack/react-query";
import {
  normalizePluginMentionTriggers,
  type PluginMentionTrigger,
} from "@/lib/plugin-mention-triggers";
import { pluginContributionsQueryKey } from "./query-keys";

/**
 * Host-rendered plugin contributions (plugin design §4.9), served by
 * GET /api/v1/plugins/contributions. Not in the typed server contract — the
 * plugin routes are server-policy glue — so fetched directly and typed
 * locally. One query covers every contribution kind; later kinds extend
 * {@link PluginContributions}.
 */
/** One mention provider contributed by a plugin (design §4.9). */
export interface PluginMentionProviderContribution {
  pluginId: string;
  id: string;
  label: string;
  triggers: readonly PluginMentionTrigger[];
}

export interface PluginContributions {
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
  // Nothing to surface rather than an error: an older server (no plugin
  // routes) or a disabled experiment both mean "no contributions".
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

/**
 * All host-rendered plugin contributions. Consumers read their kind from the
 * shared result so the app makes one contributions request total.
 */
export function usePluginContributions() {
  return useQuery({
    queryKey: pluginContributionsQueryKey(),
    queryFn: ({ signal }) => fetchPluginContributions(signal),
    staleTime: 30_000,
  });
}
export interface PluginMentionSearchItem {
  /** Opaque server-composed item reference; rides the mention resource. */
  itemId: string;
  title: string;
  subtitle: string | null;
  icon: string | null;
}

/** One provider's mention search results, grouped under its label. */
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

export interface PluginMentionSearchArgs {
  trigger: PluginMentionTrigger;
  query: string;
  projectId: string | null;
  threadId: string | null;
}

async function fetchPluginMentionSearch(
  args: PluginMentionSearchArgs,
  signal: AbortSignal,
): Promise<PluginMentionSearchGroup[]> {
  const params = new URLSearchParams({
    q: args.query,
    trigger: args.trigger,
  });
  if (args.projectId !== null) params.set("projectId", args.projectId);
  if (args.threadId !== null) params.set("threadId", args.threadId);
  const response = await fetch(
    `/api/v1/plugins/mentions/search?${params.toString()}`,
    { signal },
  );
  // Nothing to surface rather than an error: a disabled experiment or an
  // older server both mean "no plugin mention results".
  if (!response.ok) return [];
  const body = (await response.json()) as { groups?: unknown };
  return Array.isArray(body.groups)
    ? body.groups.filter(isMentionSearchGroup)
    : [];
}

/**
 * Plugin mention-provider search for the composer's `@` menu (design §4.9).
 * Callers gate `enabled` on a non-empty (debounced) query plus at least one
 * registered mention provider so idle composers never poll the server.
 */
export function usePluginMentionSearch(
  args: PluginMentionSearchArgs,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: [
      "plugin-mention-search",
      args.trigger,
      args.query,
      args.projectId,
      args.threadId,
    ],
    queryFn: ({ signal }) => fetchPluginMentionSearch(args, signal),
    enabled: options.enabled,
    staleTime: 15_000,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === args.trigger ? previous : undefined,
  });
}
