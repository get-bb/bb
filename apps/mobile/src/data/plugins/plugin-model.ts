import type { JsonValue } from "@bb/domain";
import type {
  InstalledPlugin,
  PluginCatalogSearchResult,
  PluginMarketplace,
  PluginRuntimeStatus,
  PluginSettingDescriptor,
  PluginUpdateCheckEntry,
} from "@bb/server-contract";

/**
 * Pure presentation / request helpers for plugin management. Mirrors the
 * headless parts of apps/app `components/plugin/management/plugin-status.ts`,
 * `PluginSettings.tsx` (the write-only secret rule), `PluginDetail.tsx`
 * (removal labels) and `plugin-catalog-queries.ts` (update entries). No React
 * Native imports: vitest-tested under node.
 */

export type PluginStatusTone = "error" | "warning";

export interface PluginRuntimeStatusPresentation {
  /** `@/ui` icon name. */
  icon:
    | "CircleX"
    | "AlertCircle"
    | "FileQuestion"
    | "Settings"
    | "AlertTriangle";
  label: string;
  tone: PluginStatusTone;
  condition: string;
  recovery: string;
}

type PluginRuntimeStatusDefinition = Pick<
  PluginRuntimeStatusPresentation,
  "icon" | "label" | "tone"
>;

/**
 * Canonical user-facing projection of plugin runtime health. Enabled /
 * disabled is lifecycle state and updates are release state; neither is
 * folded into this health vocabulary.
 */
const PLUGIN_RUNTIME_STATUS_DEFINITIONS: Record<
  PluginRuntimeStatus,
  PluginRuntimeStatusDefinition | null
> = {
  running: null,
  error: { icon: "CircleX", label: "Failed", tone: "error" },
  incompatible: { icon: "AlertCircle", label: "Incompatible", tone: "error" },
  missing: { icon: "FileQuestion", label: "Missing", tone: "error" },
  disabled: null,
  "needs-configuration": {
    icon: "Settings",
    label: "Needs configuration",
    tone: "warning",
  },
  degraded: { icon: "AlertTriangle", label: "Degraded", tone: "warning" },
};

type PluginHealthFacts = Pick<
  InstalledPlugin,
  "status" | "source" | "provenance" | "hasSettings"
>;

function pluginRuntimeRecovery(plugin: PluginHealthFacts): string {
  switch (plugin.status) {
    case "error":
      if (plugin.source.startsWith("path:")) {
        return "Fix the plugin, then reload it.";
      }
      if (plugin.provenance === "builtin") {
        return "Reload the plugin. If it still fails, restart bb.";
      }
      return "Reload the plugin. If it still fails, remove it and install it again.";
    case "incompatible":
      return plugin.provenance === "builtin"
        ? "Update bb to load a compatible bundled plugin."
        : "Install a version compatible with this bb.";
    case "missing":
      return plugin.provenance === "builtin"
        ? "Restart bb. If the files are still missing, reinstall bb."
        : "Remove the plugin, then install it again from its source.";
    case "needs-configuration":
      return plugin.hasSettings
        ? "Complete the settings below; bb reloads the plugin after you save."
        : "Add the required configuration, then reload the plugin.";
    case "degraded":
      return "Wait a moment, then reload the plugin.";
    default:
      return "";
  }
}

function pluginRuntimeCondition(status: PluginRuntimeStatus): string {
  switch (status) {
    case "error":
      return "The plugin couldn't start.";
    case "incompatible":
      return "This plugin version isn't compatible with your version of bb.";
    case "missing":
      return "The plugin's files are missing.";
    case "needs-configuration":
      return "Required settings are incomplete.";
    case "degraded":
      return "A background service is still stopping.";
    default:
      return "";
  }
}

/** Null for a healthy (running / disabled) plugin. */
export function pluginRuntimeStatusPresentation(
  plugin: PluginHealthFacts,
): PluginRuntimeStatusPresentation | null {
  const definition = PLUGIN_RUNTIME_STATUS_DEFINITIONS[plugin.status];
  if (definition === null) return null;
  return {
    ...definition,
    condition: pluginRuntimeCondition(plugin.status),
    recovery: pluginRuntimeRecovery(plugin),
  };
}

/**
 * A plugin row earns at most one signal: a failed update that rolled back
 * outranks abnormal runtime health, which outranks an unverifiable update
 * source, which outranks an available update. Pinned sources and
 * newer-but-incompatible releases never signal the list.
 */
export type PluginRowSignal =
  | { kind: "update"; version: string }
  | {
      kind: "status";
      icon: PluginRuntimeStatusPresentation["icon"] | "RotateCcw";
      label: string;
      tone: PluginStatusTone;
      detail: string | null;
    };

export function pluginRowSignal(
  plugin: PluginHealthFacts &
    Pick<InstalledPlugin, "updateState" | "statusDetail">,
): PluginRowSignal | null {
  const state = plugin.updateState;
  if (state.lastFailure !== undefined) {
    return {
      kind: "status",
      icon: "RotateCcw",
      label: "Update failed",
      tone: "error",
      detail:
        state.lastFailure.detail.length > 0
          ? state.lastFailure.detail
          : `Update to ${state.lastFailure.version} failed and was rolled back.`,
    };
  }
  const runtime = pluginRuntimeStatusPresentation(plugin);
  if (runtime !== null) {
    return {
      kind: "status",
      icon: runtime.icon,
      label: runtime.label,
      tone: runtime.tone,
      detail: plugin.statusDetail,
    };
  }
  if (state.outcome === "unavailable") {
    return {
      kind: "status",
      icon: "AlertTriangle",
      label: "Needs attention",
      tone: "warning",
      detail: state.detail ?? null,
    };
  }
  if (state.availableVersion !== undefined) {
    return { kind: "update", version: state.availableVersion };
  }
  return null;
}

/** The row subtitle: version plus where the plugin came from. */
export function describePluginRow(
  plugin: Pick<
    InstalledPlugin,
    "version" | "publisherLabel" | "sourceDisplay" | "enabled" | "status"
  >,
): string {
  const parts = [`v${plugin.version}`];
  if (plugin.publisherLabel !== null) parts.push(plugin.publisherLabel);
  else parts.push(plugin.sourceDisplay);
  if (!plugin.enabled) parts.push("Disabled");
  else if (plugin.status === "running") parts.push("Running");
  return parts.join(" · ");
}

function pluginIsLocalSource(plugin: Pick<InstalledPlugin, "source">): boolean {
  return plugin.source.startsWith("path:");
}

/** "Remove from bb" for a local path source (the files stay), else "Uninstall". */
export function pluginRemovalLabel(
  plugin: Pick<InstalledPlugin, "source">,
): string {
  return pluginIsLocalSource(plugin) ? "Remove from bb" : "Uninstall";
}

/**
 * What a removal deletes, matching the server's `remove`: settings, secrets,
 * and schedules go with the registration on every source kind; only managed
 * git/npm files are deleted from disk. Moving a local plugin is an install of
 * the new path, which keeps that configuration.
 */
export function pluginRemovalDescription(
  plugin: Pick<InstalledPlugin, "source">,
): string {
  return pluginIsLocalSource(plugin)
    ? "bb stops loading this plugin and deletes its settings, secrets, and schedules. Its files stay where they are. To move it to another directory, install the new path instead; that keeps its settings."
    : "bb stops the plugin and deletes its installed files, settings, secrets, and schedules.";
}

/** Display name, falling back to the id. */
export function pluginDisplayName(
  plugin: Pick<InstalledPlugin, "id" | "name">,
): string {
  return plugin.name ?? plugin.id;
}

/**
 * Statuses whose factory ran, so a settings schema exists server-side. A
 * needs-configuration plugin MUST be configurable (that status exists to send
 * the user to the form); degraded plugins are loaded too. Errored / missing /
 * incompatible plugins have no schema to render.
 */
const PLUGIN_STATUSES_WITH_SETTINGS: ReadonlySet<PluginRuntimeStatus> = new Set(
  ["running", "needs-configuration", "degraded"],
);

export type PluginSettingsAvailability =
  | { kind: "none" }
  | { kind: "available" }
  | { kind: "disabled" }
  | { kind: "unavailable"; status: PluginRuntimeStatus };

/**
 * Whether the detail screen can show the descriptor form, and why not. The
 * server only knows a plugin's schema once its factory ran, so a disabled
 * plugin reports `hasSettings: false` even when it declares settings: the
 * disabled case is decided first and never claims "no settings".
 */
export function pluginSettingsAvailability(
  plugin: Pick<InstalledPlugin, "hasSettings" | "enabled" | "status">,
): PluginSettingsAvailability {
  if (!plugin.enabled) return { kind: "disabled" };
  if (!plugin.hasSettings) return { kind: "none" };
  if (!PLUGIN_STATUSES_WITH_SETTINGS.has(plugin.status)) {
    return { kind: "unavailable", status: plugin.status };
  }
  return { kind: "available" };
}

export function describePluginSettingsAvailability(
  availability: PluginSettingsAvailability,
): string | null {
  switch (availability.kind) {
    case "none":
      return "This plugin has no settings.";
    case "disabled":
      return "Enable this plugin to see and edit its settings.";
    case "unavailable":
      return `Settings are unavailable while the plugin is ${availability.status}.`;
    case "available":
      return null;
  }
}

/** A setting draft: what the form holds for one key before saving. */
export type PluginSettingDraft = string | boolean;

/** Whether a stored secret is set (the server only reports `{ set }`). */
export function pluginSecretIsSet(storedValue: JsonValue | undefined): boolean {
  return (
    typeof storedValue === "object" &&
    storedValue !== null &&
    !Array.isArray(storedValue) &&
    storedValue.set === true
  );
}

/**
 * The value a form field shows for a descriptor: the draft when the user
 * touched it, else the stored value when it has the descriptor's type, else
 * the descriptor default / empty. Secrets are write-only and always start
 * empty.
 */
export function pluginSettingFieldValue(
  descriptor: PluginSettingDescriptor,
  storedValue: JsonValue | undefined,
  draft: PluginSettingDraft | undefined,
): PluginSettingDraft {
  if (descriptor.type === "boolean") {
    if (typeof draft === "boolean") return draft;
    if (typeof storedValue === "boolean") return storedValue;
    return descriptor.default ?? false;
  }
  if (typeof draft === "string") return draft;
  if (descriptor.type === "string" && descriptor.secret === true) return "";
  if (typeof storedValue === "string") return storedValue;
  return descriptor.default ?? "";
}

/**
 * The PUT body for a form submit: only keys whose draft differs from the
 * stored value. Secrets are write-only — an untouched or emptied secret
 * means "leave unchanged" and never rides the payload.
 */
export function pluginSettingsChanges(
  schema: Record<string, PluginSettingDescriptor>,
  values: Record<string, JsonValue>,
  drafts: Record<string, PluginSettingDraft>,
): Record<string, JsonValue> {
  const changed: Record<string, JsonValue> = {};
  for (const [key, draft] of Object.entries(drafts)) {
    const descriptor = schema[key];
    if (descriptor === undefined) continue;
    const isSecret = descriptor.type === "string" && descriptor.secret === true;
    if (isSecret) {
      if (draft === "") continue;
      changed[key] = draft;
      continue;
    }
    if (draft === values[key]) continue;
    changed[key] = draft;
  }
  return changed;
}

/** One plugin's last update-check result, flattened for rendering. */
export interface PluginUpdateSummary {
  outcome: PluginUpdateCheckEntry["outcome"];
  /** Headline for the update card. */
  title: string;
  /** Supporting line (candidate version, block reasons, detail). */
  detail: string | null;
  /** Whether `POST /plugins/:id/update` makes sense. */
  canApply: boolean;
}

export function summarizePluginUpdate(
  entry: PluginUpdateCheckEntry | undefined,
): PluginUpdateSummary | null {
  if (entry === undefined) return null;
  switch (entry.outcome) {
    case "update-available":
      return {
        outcome: entry.outcome,
        title: `Update available${entry.candidate ? `: ${entry.candidate.display}` : ""}`,
        detail: `Installed ${entry.installed.display}`,
        canApply: entry.devMode !== true,
      };
    case "current":
      return {
        outcome: entry.outcome,
        title: "Up to date",
        detail: `Installed ${entry.installed.display}`,
        canApply: false,
      };
    case "pinned":
      return {
        outcome: entry.outcome,
        title: "Pinned",
        detail: entry.detail ?? `Installed ${entry.installed.display}`,
        canApply: false,
      };
    case "incompatible":
      return {
        outcome: entry.outcome,
        title: entry.blocked
          ? `${entry.blocked.version} needs a newer bb`
          : "Newer release is incompatible",
        detail: entry.blocked?.reasons.join("; ") ?? entry.detail ?? null,
        canApply: false,
      };
    case "unavailable":
      return {
        outcome: entry.outcome,
        title: "Updates unavailable",
        detail: entry.detail ?? null,
        canApply: false,
      };
  }
}

/** Installed plugins sorted by display name, id as the tiebreak. */
export function sortPlugins<T extends Pick<InstalledPlugin, "id" | "name">>(
  plugins: readonly T[],
): T[] {
  return [...plugins].sort((left, right) => {
    const byName = pluginDisplayName(left).localeCompare(
      pluginDisplayName(right),
      undefined,
      { sensitivity: "base" },
    );
    return byName !== 0 ? byName : left.id.localeCompare(right.id);
  });
}

/** Case-insensitive filter on name, id and description. */
export function filterPlugins<
  T extends Pick<InstalledPlugin, "id" | "name" | "description">,
>(plugins: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...plugins];
  return plugins.filter(
    (plugin) =>
      plugin.id.toLowerCase().includes(needle) ||
      (plugin.name?.toLowerCase().includes(needle) ?? false) ||
      (plugin.description?.toLowerCase().includes(needle) ?? false),
  );
}

export interface PluginCatalogGroup {
  /** Stable publisher identity (`builtin`, or the marketplace name). */
  publisherKey: string;
  label: string;
  entries: PluginCatalogSearchResult[];
}

/**
 * Catalog results grouped by publisher, BB Official first, then the listing
 * marketplaces in display-name order; entries keep the server's order
 * (relevance) inside a group.
 */
export function groupCatalogEntries(
  entries: readonly PluginCatalogSearchResult[],
): PluginCatalogGroup[] {
  const groups = new Map<string, PluginCatalogGroup>();
  for (const entry of entries) {
    const group = groups.get(entry.publisherKey);
    if (group) {
      group.entries.push(entry);
      continue;
    }
    groups.set(entry.publisherKey, {
      publisherKey: entry.publisherKey,
      label: entry.publisherLabel,
      entries: [entry],
    });
  }
  return [...groups.values()].sort((left, right) => {
    if (left.publisherKey === "builtin") return -1;
    if (right.publisherKey === "builtin") return 1;
    return left.label.localeCompare(right.label, undefined, {
      sensitivity: "base",
    });
  });
}

/**
 * Whether a catalog install needs the third-party confirmation (the install
 * plan with the resolved source). The curated marketplace is BB's own.
 */
export function catalogInstallNeedsSourceConfirmation(
  entry: Pick<PluginCatalogSearchResult, "marketplace">,
  curatedMarketplaceName: string,
): boolean {
  return entry.marketplace !== curatedMarketplaceName;
}

/** How the install confirmation describes a catalog entry's source. */
export function describeCatalogInstall(
  entry: Pick<PluginCatalogSearchResult, "source" | "publisherLabel">,
): string {
  if (entry.source.startsWith("builtin:")) {
    return "Install this plugin, bundled with BB.";
  }
  if (entry.source.startsWith("npm:")) {
    return `Install this ${entry.publisherLabel} plugin from its listed npm package.`;
  }
  return `Install this ${entry.publisherLabel} plugin from its listed source repository.`;
}

/** Which `POST /plugins/install` source kinds a free-text source can be. */
const DIRECT_SOURCE_PREFIXES = ["npm:", "git:", "path:", "builtin:"] as const;

/**
 * Validate a typed plugin source. Bare `owner/repo`-looking values and URLs
 * are accepted too: the server resolves and validates during install, and
 * an unparsable source surfaces as the install error with nothing changed.
 */
export function normalizePluginSourceInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (DIRECT_SOURCE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return trimmed;
  }
  if (/^https?:\/\//iu.test(trimmed)) return `git:${trimmed}`;
  if (trimmed.startsWith("/") || trimmed.startsWith("~")) {
    return `path:${trimmed}`;
  }
  return `npm:${trimmed}`;
}

/** The marketplace row subtitle. */
export function describeMarketplace(marketplace: PluginMarketplace): string {
  const count = `${marketplace.entryCount} ${marketplace.entryCount === 1 ? "plugin" : "plugins"}`;
  if (marketplace.lastError !== null) {
    return `${count} · Last refresh failed`;
  }
  if (marketplace.lastRefreshAt === null) return `${count} · Never refreshed`;
  return `${count} · Refreshed ${new Date(marketplace.lastRefreshAt).toLocaleString()}`;
}

/**
 * Validate a typed marketplace source: `https://…/marketplace.json`,
 * `git:<url>[@ref]`, or `path:<dir>`. Bare `https` URLs pass through; the
 * server validates the manifest.
 */
export function normalizeMarketplaceSourceInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("git:") ||
    trimmed.startsWith("path:")
  ) {
    return trimmed;
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("~")) {
    return `path:${trimmed}`;
  }
  return null;
}
