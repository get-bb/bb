import { useQuery, type QueryKey } from "@tanstack/react-query";
import { z } from "zod";
import { promptInputSchema, type PromptInput } from "@bb/domain";
import { useSystemConfig } from "./system-queries";

/**
 * Host-rendered plugin contributions (plugin design §4.9), served by
 * GET /api/v1/plugins/contributions. Not in the typed server contract — the
 * plugin routes are server-policy glue — so fetched directly and typed
 * locally. One query covers every contribution kind; later kinds (slash
 * commands, mention providers) extend {@link PluginContributions}.
 */
export interface PluginThreadActionContribution {
  pluginId: string;
  id: string;
  title: string;
  /** Icon hint from the plugin; the app falls back to a generic icon. */
  icon: string | null;
  /** Confirmation prompt to show before running; null runs immediately. */
  confirm: string | null;
}

/** One composer slash command contributed by a plugin (design §4.9). */
export interface PluginSlashCommandContribution {
  pluginId: string;
  name: string;
  description: string;
}

/** One `@`-mention provider contributed by a plugin (design §4.9). */
export interface PluginMentionProviderContribution {
  pluginId: string;
  id: string;
  label: string;
}

export interface PluginContributions {
  threadActions: PluginThreadActionContribution[];
  slashCommands: PluginSlashCommandContribution[];
  mentionProviders: PluginMentionProviderContribution[];
}

export interface PluginThreadActionToast {
  kind: "success" | "error" | "info";
  message: string;
}

const EMPTY_CONTRIBUTIONS: PluginContributions = {
  threadActions: [],
  slashCommands: [],
  mentionProviders: [],
};

function isMentionProviderContribution(
  value: unknown,
): value is PluginMentionProviderContribution {
  if (typeof value !== "object" || value === null) return false;
  const provider = value as Record<string, unknown>;
  return (
    typeof provider.pluginId === "string" &&
    typeof provider.id === "string" &&
    typeof provider.label === "string"
  );
}

function isSlashCommandContribution(
  value: unknown,
): value is PluginSlashCommandContribution {
  if (typeof value !== "object" || value === null) return false;
  const command = value as Record<string, unknown>;
  return (
    typeof command.pluginId === "string" &&
    typeof command.name === "string" &&
    typeof command.description === "string"
  );
}

function isThreadActionContribution(
  value: unknown,
): value is PluginThreadActionContribution {
  if (typeof value !== "object" || value === null) return false;
  const action = value as Record<string, unknown>;
  return (
    typeof action.pluginId === "string" &&
    typeof action.id === "string" &&
    typeof action.title === "string" &&
    (action.icon === null || typeof action.icon === "string") &&
    (action.confirm === null || typeof action.confirm === "string")
  );
}

async function fetchPluginContributions(
  signal: AbortSignal,
): Promise<PluginContributions> {
  const response = await fetch("/api/v1/plugins/contributions", { signal });
  // Nothing to surface rather than an error: an older server (no plugin
  // routes) or a disabled experiment both mean "no contributions".
  if (!response.ok) return EMPTY_CONTRIBUTIONS;
  const body = (await response.json()) as {
    threadActions?: unknown;
    slashCommands?: unknown;
    mentionProviders?: unknown;
  };
  return {
    threadActions: Array.isArray(body.threadActions)
      ? body.threadActions.filter(isThreadActionContribution)
      : [],
    slashCommands: Array.isArray(body.slashCommands)
      ? body.slashCommands.filter(isSlashCommandContribution)
      : [],
    mentionProviders: Array.isArray(body.mentionProviders)
      ? body.mentionProviders.filter(isMentionProviderContribution)
      : [],
  };
}

export function pluginContributionsQueryKey(pluginsEnabled: boolean): QueryKey {
  return ["plugin-contributions", pluginsEnabled];
}

/**
 * Prefix covering every contributions cache entry (both experiment-flag
 * variants). The realtime `plugins-changed` broadcast invalidates it so
 * `bb plugin reload/enable/disable` reaches open pages without waiting out
 * the stale time.
 */
export function allPluginContributionsQueryKeyPrefix(): QueryKey {
  return ["plugin-contributions"];
}

/**
 * All host-rendered plugin contributions, fetched only while the `plugins`
 * experiment is on (per system config). Consumers read their kind from the
 * shared result so the app makes one contributions request total. The
 * experiment flag rides the query key: flipping it off moves consumers to a
 * never-fetched (undefined) entry instead of a stale cached one.
 */
export function usePluginContributions() {
  const systemConfig = useSystemConfig();
  const pluginsEnabled = systemConfig.data?.experiments.plugins === true;
  return useQuery({
    queryKey: pluginContributionsQueryKey(pluginsEnabled),
    queryFn: ({ signal }) => fetchPluginContributions(signal),
    enabled: pluginsEnabled,
    staleTime: 30_000,
  });
}

/**
 * Invoke one plugin thread action server-side. Resolves with the returned
 * toast (or null); throws with the server's error message for handler
 * failures so mutation callers surface it as an error toast.
 */
export async function runPluginThreadAction(args: {
  pluginId: string;
  actionId: string;
  threadId: string;
}): Promise<PluginThreadActionToast | null> {
  const response = await fetch(
    `/api/v1/plugins/${encodeURIComponent(args.pluginId)}/actions/${encodeURIComponent(args.actionId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: args.threadId }),
    },
  );
  const body = (await response.json().catch(() => null)) as {
    ok?: unknown;
    toast?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `thread action failed (HTTP ${response.status})`,
    );
  }
  const toast = body.toast;
  if (typeof toast !== "object" || toast === null) return null;
  const { kind, message } = toast as { kind?: unknown; message?: unknown };
  if (
    (kind === "success" || kind === "error" || kind === "info") &&
    typeof message === "string"
  ) {
    return { kind, message };
  }
  return null;
}

/**
 * The composer-facing shape of a slash command's server-side result
 * (design §4.9 return contract: void | { insertText } | { send }).
 */
export type PluginSlashCommandAction =
  | { kind: "none" }
  | { kind: "insertText"; text: string }
  | { kind: "send"; inputs: PromptInput[] };

const slashCommandSendSchema = z.array(promptInputSchema).min(1);

/**
 * Parse the POST /plugins/:id/slash/:name success envelope into a
 * {@link PluginSlashCommandAction}. Exported for tests; throws on malformed
 * envelopes so callers surface them as command failures.
 */
export function parsePluginSlashCommandAction(
  body: unknown,
): PluginSlashCommandAction {
  const envelope = body as {
    action?: unknown;
    insertText?: unknown;
    send?: unknown;
  } | null;
  if (envelope?.action === "none") return { kind: "none" };
  if (
    envelope?.action === "insertText" &&
    typeof envelope.insertText === "string" &&
    envelope.insertText.length > 0
  ) {
    return { kind: "insertText", text: envelope.insertText };
  }
  if (envelope?.action === "send") {
    const parsed = slashCommandSendSchema.safeParse(envelope.send);
    if (parsed.success) return { kind: "send", inputs: parsed.data };
  }
  throw new Error("plugin returned a malformed slash command result");
}

/** One row from GET /plugins/mentions/search (plugin design §4.9). */
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
  query: string;
  projectId: string | null;
  threadId: string | null;
}

async function fetchPluginMentionSearch(
  args: PluginMentionSearchArgs,
  signal: AbortSignal,
): Promise<PluginMentionSearchGroup[]> {
  const params = new URLSearchParams({ q: args.query });
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
      args.query,
      args.projectId,
      args.threadId,
    ],
    queryFn: ({ signal }) => fetchPluginMentionSearch(args, signal),
    enabled: options.enabled,
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
}

/**
 * Invoke one plugin slash command server-side. `threadId`/`projectId` are
 * null on the homepage (new-thread) composer. Throws with the server's error
 * message on handler failures so callers surface it as an error toast.
 */
export async function runPluginSlashCommand(args: {
  pluginId: string;
  name: string;
  args: string;
  threadId: string | null;
  projectId: string | null;
}): Promise<PluginSlashCommandAction> {
  const response = await fetch(
    `/api/v1/plugins/${encodeURIComponent(args.pluginId)}/slash/${encodeURIComponent(args.name)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        args: args.args,
        ...(args.threadId !== null ? { threadId: args.threadId } : {}),
        ...(args.projectId !== null ? { projectId: args.projectId } : {}),
      }),
    },
  );
  const body = (await response.json().catch(() => null)) as {
    ok?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `slash command failed (HTTP ${response.status})`,
    );
  }
  return parsePluginSlashCommandAction(body);
}
