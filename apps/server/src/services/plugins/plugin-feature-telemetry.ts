import type { TelemetryInitiator } from "../system/telemetry.js";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  getInstalledPlugin,
  getPluginMarketplace,
  type InstalledPluginRow,
} from "@bb/db";
import {
  CURATED_PLUGIN_MARKETPLACE_NAME,
  type CoreFeature,
  type TelemetryPluginSource,
} from "@bb/server-contract";
import {
  CURATED_MARKETPLACE_V1_URL,
  CURATED_MARKETPLACE_V2_URL,
} from "../plugin-catalog/marketplace-manifest.js";
import { captureFeatureUsed } from "../system/feature-telemetry.js";
import type { PluginServiceDeps } from "./plugin-service-internal.js";

const invocation = new AsyncLocalStorage<TelemetryInitiator>();
export const BUILTIN_PLUGIN_CAPABILITIES: Readonly<
  Record<string, CoreFeature>
> = {
  automations: "automation",
  "browser-automation": "browser",
  connect: "remote_access",
  "push-notifications": "remote_access",
  github: "git",
  "monaco-editor": "file",
  "simple-notes": "file",
  "side-chat": "child_thread",
  tasks: "thread",
  workflows: "child_thread",
  "concurrency-limit": "settings",
  "keep-awake": "settings",
  "thread-list": "settings",
  "theme-preview": "settings",
  "bb--storage-retention": "settings",
  "bb-account": "settings",
  "bb-ai": "provider",
  "account-pool": "provider",
  "bb--provider-usage": "provider",
  "provider-acp": "provider",
  "environment-git-worktree": "environment",
  "environment-project-checkout": "environment",
  "environment-personal-workspace": "environment",
  "environment-modal-sandbox": "environment",
};

export function capturePluginUse(
  deps: PluginServiceDeps,
  pluginId: string,
  interaction: "opened" | "invoked" | "ran",
  initiator: TelemetryInitiator,
): void {
  if (invocation.getStore()) return;
  try {
    const row = getInstalledPlugin(deps.db, pluginId);
    if (!row || !row.enabled) return;
    const source = resolvePluginTelemetrySource(deps, row);
    const feature =
      row.provenance === "builtin" && row.sourceKind === "builtin"
        ? (BUILTIN_PLUGIN_CAPABILITIES[pluginId] ??
          (pluginId.startsWith("provider-") ? "provider" : "plugin"))
        : "plugin";
    captureFeatureUsed(deps.telemetry, {
      kind: feature,
      feature_scope: "plugin",
      plugin_source: source,
      interaction,
      initiator,
    });
  } catch {}
}

export function withPluginUse<T>(
  deps: PluginServiceDeps,
  pluginId: string,
  initiator: TelemetryInitiator,
  run: () => T,
  capture = true,
  interaction: "invoked" | "ran" = "invoked",
): T {
  if (invocation.getStore()) return run();
  if (capture) capturePluginUse(deps, pluginId, interaction, initiator);
  return invocation.run(initiator, run);
}

export function pluginInvocationInitiator(): TelemetryInitiator {
  return invocation.getStore() ?? "plugin";
}

export function resolvePluginTelemetrySource(
  deps: Pick<PluginServiceDeps, "db" | "watchBuiltinPluginSources">,
  row: Pick<
    InstalledPluginRow,
    "sourceKind" | "provenance" | "catalogMarketplaceName"
  >,
): TelemetryPluginSource {
  let source: TelemetryPluginSource = "unknown";
  if (
    row.sourceKind === "path" ||
    (row.sourceKind === "builtin" && deps.watchBuiltinPluginSources === true)
  )
    source = "local";
  else if (row.sourceKind === "builtin" && row.provenance === "builtin")
    source = "builtin";
  else if (
    row.provenance === "catalog" &&
    row.catalogMarketplaceName !== null
  ) {
    const marketplace = getPluginMarketplace(
      deps.db,
      row.catalogMarketplaceName,
    );
    if (
      marketplace?.name === CURATED_PLUGIN_MARKETPLACE_NAME &&
      marketplace.sourceKind === "https" &&
      [CURATED_MARKETPLACE_V1_URL, CURATED_MARKETPLACE_V2_URL].includes(
        marketplace.manifestUrl,
      )
    )
      source = "public_catalog";
    else if (marketplace?.sourceKind === "git") source = "private_marketplace";
  }
  return source;
}
