import { useQuery, type QueryKey } from "@tanstack/react-query";
import { useSystemConfig } from "./system-queries";

/**
 * Host-rendered plugin management data for the Settings "Plugins" section
 * (plugin design §5.2 settingsSection): the installed-plugin list plus each
 * running plugin's declarative settings view, backed by GET /api/v1/plugins
 * and GET/PUT /api/v1/plugins/:id/settings. Like the contributions queries,
 * these routes are server-policy glue outside the typed contract, so they
 * are fetched directly and validated locally. Fetchers take an injected
 * fetch so tests can exercise the response mapping.
 */

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export interface PluginListItem {
  id: string;
  version: string;
  enabled: boolean;
  status: string;
  statusDetail: string | null;
  /** Hash-busted logo asset URL; null when the plugin ships no logo. */
  logoUrl: string | null;
  /** Dark-theme logo variant URL; null when the plugin ships none. */
  logoDarkUrl: string | null;
}

function parsePluginListItem(value: unknown): PluginListItem | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.version !== "string" ||
    typeof item.enabled !== "boolean" ||
    typeof item.status !== "string" ||
    !(item.statusDetail === null || typeof item.statusDetail === "string")
  ) {
    return null;
  }
  return {
    id: item.id,
    version: item.version,
    enabled: item.enabled,
    status: item.status,
    statusDetail: item.statusDetail,
    // Absent on older servers → no logo, never a dropped row.
    logoUrl: typeof item.logoUrl === "string" ? item.logoUrl : null,
    logoDarkUrl:
      typeof item.logoDarkUrl === "string" ? item.logoDarkUrl : null,
  };
}

export async function fetchPluginList(
  fetchImpl: FetchLike,
): Promise<PluginListItem[]> {
  const response = await fetchImpl("/api/v1/plugins");
  // Nothing to list rather than an error: an older server or a disabled
  // experiment both mean "no plugins".
  if (!response.ok) return [];
  const body = (await response.json().catch(() => null)) as {
    plugins?: unknown;
  } | null;
  return Array.isArray(body?.plugins)
    ? body.plugins
        .map(parsePluginListItem)
        .filter((item): item is PluginListItem => item !== null)
    : [];
}

/** Client mirror of the server's plain-data setting descriptors. */
export type PluginSettingFieldDescriptor =
  | { type: "string"; label: string; description?: string; secret?: true }
  | { type: "boolean"; label: string; description?: string }
  | { type: "select"; label: string; description?: string; options: string[] }
  | { type: "project"; label: string; description?: string };

export interface PluginSettingsView {
  schema: Record<string, PluginSettingFieldDescriptor>;
  /** Non-secret effective values; secret keys map to `{ set: boolean }`. */
  values: Record<string, unknown>;
}

function isSettingDescriptor(
  value: unknown,
): value is PluginSettingFieldDescriptor {
  if (typeof value !== "object" || value === null) return false;
  const descriptor = value as Record<string, unknown>;
  if (typeof descriptor.label !== "string") return false;
  switch (descriptor.type) {
    case "string":
    case "boolean":
    case "project":
      return true;
    case "select":
      return (
        Array.isArray(descriptor.options) &&
        descriptor.options.every((option) => typeof option === "string")
      );
    default:
      return false;
  }
}

function parseSettingsView(body: unknown): PluginSettingsView | null {
  const typed = body as {
    ok?: unknown;
    schema?: unknown;
    values?: unknown;
  } | null;
  if (
    typed?.ok !== true ||
    typeof typed.schema !== "object" ||
    typed.schema === null ||
    typeof typed.values !== "object" ||
    typed.values === null
  ) {
    return null;
  }
  const schema: Record<string, PluginSettingFieldDescriptor> = {};
  for (const [key, descriptor] of Object.entries(typed.schema)) {
    if (isSettingDescriptor(descriptor)) schema[key] = descriptor;
  }
  return { schema, values: typed.values as Record<string, unknown> };
}

/** Null when the plugin is unknown/not running (settings need a loaded factory). */
export async function fetchPluginSettingsView(
  fetchImpl: FetchLike,
  pluginId: string,
): Promise<PluginSettingsView | null> {
  const response = await fetchImpl(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/settings`,
  );
  if (!response.ok) return null;
  return parseSettingsView(await response.json().catch(() => null));
}

/**
 * PUT /api/v1/plugins/:id/settings with `{ values }` (`null` unsets a key).
 * Resolves with the refreshed view; throws with the server's validation
 * message on rejection.
 */
export async function updatePluginSettings(
  fetchImpl: FetchLike,
  pluginId: string,
  values: Record<string, unknown>,
): Promise<PluginSettingsView> {
  const response = await fetchImpl(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/settings`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values }),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  const view = response.ok ? parseSettingsView(body) : null;
  if (view === null) {
    const error = (body as { error?: unknown } | null)?.error;
    throw new Error(
      typeof error === "string"
        ? error
        : `saving settings failed (HTTP ${response.status})`,
    );
  }
  return view;
}

export function pluginListQueryKey(pluginsEnabled: boolean): QueryKey {
  return ["plugin-list", pluginsEnabled];
}

/** Prefix the realtime `plugins-changed` broadcast invalidates. */
export function allPluginListQueryKeyPrefix(): QueryKey {
  return ["plugin-list"];
}

export function pluginSettingsViewQueryKey(pluginId: string): QueryKey {
  return ["plugin-settings-view", pluginId];
}

/** Prefix the realtime `plugins-changed` broadcast invalidates. */
export function allPluginSettingsViewQueryKeyPrefix(): QueryKey {
  return ["plugin-settings-view"];
}

/** Installed plugins, fetched only while the `plugins` experiment is on. */
export function usePluginList() {
  const systemConfig = useSystemConfig();
  const pluginsEnabled = systemConfig.data?.experiments.plugins === true;
  return useQuery({
    queryKey: pluginListQueryKey(pluginsEnabled),
    queryFn: () => fetchPluginList(fetch),
    enabled: pluginsEnabled,
    staleTime: 30_000,
  });
}

export function usePluginSettingsView(
  pluginId: string,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: pluginSettingsViewQueryKey(pluginId),
    queryFn: () => fetchPluginSettingsView(fetch, pluginId),
    enabled: options.enabled,
    staleTime: 30_000,
  });
}
