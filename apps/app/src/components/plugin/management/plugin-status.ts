import type { PluginRuntimeStatus } from "@bb/server-contract";
import type { IconName } from "@bb/shared-ui/icon";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";

export interface PluginRuntimeStatusPresentation {
  icon: IconName;
  label: string;
  tone: "error" | "warning" | "muted";
  condition: string;
  recovery: string;
}

type PluginRuntimeStatusDefinition = Omit<
  PluginRuntimeStatusPresentation,
  "condition" | "recovery"
>;

const PLUGIN_RUNTIME_STATUS_DEFINITIONS: Record<
  PluginRuntimeStatus,
  PluginRuntimeStatusDefinition | null
> = {
  starting: { icon: "Clock", label: "Starting", tone: "muted" },
  running: null,
  error: { icon: "CircleX", label: "Failed", tone: "error" },
  incompatible: {
    icon: "AlertCircle",
    label: "Incompatible",
    tone: "error",
  },
  missing: { icon: "FileQuestion", label: "Missing", tone: "error" },
  disabled: null,
  "needs-configuration": {
    icon: "Settings",
    label: "Needs configuration",
    tone: "warning",
  },
  degraded: { icon: "AlertTriangle", label: "Degraded", tone: "warning" },
};

function configuredPathUnavailable(plugin: PluginListItem): boolean {
  return /\bconfigured\b.*\b(directory|folder|path)\b/iu.test(
    plugin.statusDetail ?? "",
  );
}

function pluginRuntimeRecovery(plugin: PluginListItem): string {
  switch (plugin.status) {
    case "error":
      if (configuredPathUnavailable(plugin))
        return "Check the path, then reload.";
      return plugin.source.startsWith("path:")
        ? "Fix the plugin, then reload."
        : "Try reloading it.";
    case "incompatible":
      return plugin.provenance === "builtin"
        ? "Update bb."
        : "Install a compatible version.";
    case "missing":
      if (plugin.source.startsWith("path:"))
        return "Restore the folder, then reload.";
      return plugin.provenance === "builtin"
        ? "Update or reinstall bb."
        : "Reinstall from its source.";
    case "needs-configuration":
      return plugin.hasSettings ? "" : "Then reload.";
    case "degraded":
      return "Wait, then reload.";
    default:
      return "";
  }
}

function pluginRuntimeCondition(plugin: PluginListItem): string {
  switch (plugin.status) {
    case "starting":
      return "The plugin is starting.";
    case "error":
      return configuredPathUnavailable(plugin)
        ? "Configured folder unavailable."
        : "The plugin couldn't start.";
    case "incompatible":
      return "This version is incompatible with bb.";
    case "missing":
      return "Plugin files are missing.";
    case "needs-configuration": {
      const detail = plugin.statusDetail?.trim();
      return detail && detail.length <= 60
        ? detail
        : "Complete the required settings.";
    }
    case "degraded":
      return "A service is still stopping.";
    default:
      return "";
  }
}

export function pluginRuntimeStatusPresentation(
  plugin: PluginListItem,
): PluginRuntimeStatusPresentation | null {
  const definition = PLUGIN_RUNTIME_STATUS_DEFINITIONS[plugin.status];
  if (definition === null) return null;
  return {
    ...definition,
    condition: pluginRuntimeCondition(plugin),
    recovery: pluginRuntimeRecovery(plugin),
  };
}

export type PluginRowSignal =
  | { kind: "update"; version: string }
  | {
      kind: "status";
      icon: IconName;
      label: string;
      tone: PluginRuntimeStatusPresentation["tone"];
      detail: string | null;
    };

export function pluginRowSignal(
  plugin: PluginListItem,
): PluginRowSignal | null {
  const state = plugin.updateState;
  if (state.lastFailure !== null) {
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
  const runtimeStatus = pluginRuntimeStatusPresentation(plugin);
  if (runtimeStatus !== null) {
    return {
      kind: "status",
      icon: runtimeStatus.icon,
      label: runtimeStatus.label,
      tone: runtimeStatus.tone,
      detail: plugin.statusDetail,
    };
  }
  if (state.outcome === "unavailable") {
    return {
      kind: "status",
      icon: "AlertTriangle",
      label: "Needs attention",
      tone: "warning",
      detail: state.detail,
    };
  }
  if (state.availableVersion !== null) {
    return { kind: "update", version: state.availableVersion };
  }
  return null;
}
