import { useQuery } from "@tanstack/react-query";
import {
  normalizePluginMentionTriggers,
  type PluginMentionTrigger,
} from "@bb/client-core";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import { z } from "zod";
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

const pluginMentionProviderSchema = z.object({
  pluginId: z.string(),
  id: z.string(),
  label: z.string(),
  triggers: z.array(z.string()).optional(),
});

function toMentionProviderContribution(
  value: JsonValue,
): PluginMentionProviderContribution | null {
  const parsed = pluginMentionProviderSchema.safeParse(value);
  if (!parsed.success) return null;
  const triggers = normalizePluginMentionTriggers(parsed.data.triggers);
  if (triggers === null) return null;
  return {
    pluginId: parsed.data.pluginId,
    id: parsed.data.id,
    label: parsed.data.label,
    triggers,
  };
}

const pluginContributionsResponseSchema = z.object({
  mentionProviders: z.array(jsonValueSchema).optional(),
});

async function fetchPluginContributions(
  signal: AbortSignal,
): Promise<PluginContributions> {
  const response = await fetch("/api/v1/plugins/contributions", { signal });
  if (!response.ok) return EMPTY_CONTRIBUTIONS;
  const parsed = pluginContributionsResponseSchema.safeParse(
    await response.json(),
  );
  if (!parsed.success) return EMPTY_CONTRIBUTIONS;
  return {
    mentionProviders: parsed.data.mentionProviders
      ? parsed.data.mentionProviders
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

const pluginMentionSearchItemSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  icon: z.string().nullable(),
});

const pluginMentionSearchGroupSchema = z.object({
  pluginId: z.string(),
  providerId: z.string(),
  label: z.string(),
  items: z.array(pluginMentionSearchItemSchema),
});

function parseMentionSearchGroup(
  value: JsonValue,
): PluginMentionSearchGroup | null {
  const parsed = pluginMentionSearchGroupSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const pluginMentionSearchResponseSchema = z.object({
  groups: z.array(jsonValueSchema).optional(),
});

interface PluginMentionSearchArgs {
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
  if (!response.ok) return [];
  const parsed = pluginMentionSearchResponseSchema.safeParse(
    await response.json(),
  );
  return parsed.success && parsed.data.groups
    ? parsed.data.groups
        .map(parseMentionSearchGroup)
        .filter((group): group is PluginMentionSearchGroup => group !== null)
    : [];
}

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
