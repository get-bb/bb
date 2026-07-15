import type {
  InstalledPlugin,
  PluginSettingDescriptor,
  PluginSettingsResponse,
} from "@bb/server-contract";
import { pluginSettingsUpdateRequestSchema } from "@bb/server-contract";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import { createPluginsClient } from "./plugin-client";

type FetchLike = typeof fetch;

export type PluginProvenance = InstalledPlugin["provenance"];

export interface PluginUpdateFailure {
  version: string;
  at: number | null;
  detail: string;
}

export interface PluginUpdateState {
  outcome: InstalledPlugin["updateState"]["outcome"] | null;
  availableVersion: string | null;
  blockedVersion: string | null;
  blockedReasons: string[];
  lastCheckAt: number | null;
  lastFailure: PluginUpdateFailure | null;
}

export interface PluginListItem {
  id: string;
  version: string;
  enabled: boolean;
  status: InstalledPlugin["status"];
  statusDetail: string | null;
  description: string | null;
  name: string | null;
  icon: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  hasSettings: boolean;
  provenance: PluginProvenance;
  isOrphanedBuiltin: boolean;
  sourceDisplay: string;
  updateState: PluginUpdateState;
}

export interface PluginListResult {
  plugins: PluginListItem[];
}

export function toEpochMs(
  value: number | string | null | undefined,
): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export const EMPTY_PLUGIN_UPDATE_STATE: PluginUpdateState = {
  outcome: null,
  availableVersion: null,
  blockedVersion: null,
  blockedReasons: [],
  lastCheckAt: null,
  lastFailure: null,
};

function toPluginListItem(plugin: InstalledPlugin): PluginListItem {
  const state = plugin.updateState;
  return {
    id: plugin.id,
    version: plugin.version,
    enabled: plugin.enabled,
    status: plugin.status,
    statusDetail: plugin.statusDetail,
    description: plugin.description,
    name: plugin.name,
    icon: plugin.icon,
    logoUrl: plugin.logoUrl,
    logoDarkUrl: plugin.logoDarkUrl,
    hasSettings: plugin.hasSettings,
    provenance: plugin.provenance,
    isOrphanedBuiltin: plugin.isOrphanedBuiltin,
    sourceDisplay: plugin.sourceDisplay,
    updateState: {
      outcome: state.outcome ?? null,
      availableVersion: state.availableVersion ?? null,
      blockedVersion: state.blockedVersion ?? null,
      blockedReasons: state.blockedReasons ?? [],
      lastCheckAt: toEpochMs(state.lastCheckAt),
      lastFailure:
        state.lastFailure === undefined
          ? null
          : {
              version: state.lastFailure.version,
              at: toEpochMs(state.lastFailure.at),
              detail: state.lastFailure.detail,
            },
    },
  };
}

export async function fetchPluginList(
  fetchImpl: FetchLike,
): Promise<PluginListResult> {
  try {
    const result = await createPluginsClient(fetchImpl).list();
    return { plugins: result.plugins.map(toPluginListItem) };
  } catch {
    return { plugins: [] };
  }
}

export type PluginSettingFieldDescriptor = PluginSettingDescriptor;

export interface PluginSettingsView {
  schema: Record<string, PluginSettingFieldDescriptor>;
  values: PluginSettingsResponse["values"];
}

export async function fetchPluginSettingsView(
  fetchImpl: FetchLike,
  pluginId: string,
): Promise<PluginSettingsView | null> {
  try {
    const result = await createPluginsClient(fetchImpl).getSettings({
      pluginId,
    });
    return { schema: result.schema, values: result.values };
  } catch {
    return null;
  }
}

export async function updatePluginSettings(
  fetchImpl: FetchLike,
  pluginId: string,
  values: Record<string, unknown>,
): Promise<PluginSettingsView> {
  const request = pluginSettingsUpdateRequestSchema.parse({ values });
  const result = await createPluginsClient(fetchImpl).updateSettings({
    pluginId,
    values: request.values,
  });
  return { schema: result.schema, values: result.values };
}

export async function setPluginEnabled(
  fetchImpl: FetchLike,
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  const plugins = createPluginsClient(fetchImpl);
  if (enabled) await plugins.enable({ pluginId });
  else await plugins.disable({ pluginId });
}

export async function removePlugin(
  fetchImpl: FetchLike,
  pluginId: string,
): Promise<void> {
  await createPluginsClient(fetchImpl).remove({ pluginId });
}

export function pluginListQueryKey(enabled: boolean): QueryKey {
  return ["plugin-list", enabled];
}

export function allPluginListQueryKeyPrefix(): QueryKey {
  return ["plugin-list"];
}

export function pluginSettingsViewQueryKey(pluginId: string): QueryKey {
  return ["plugin-settings-view", pluginId];
}

export function allPluginSettingsViewQueryKeyPrefix(): QueryKey {
  return ["plugin-settings-view"];
}

export function usePluginList(args: { enabled: boolean }) {
  return useQuery({
    queryKey: pluginListQueryKey(args.enabled),
    queryFn: () => fetchPluginList(fetch),
    enabled: args.enabled,
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
