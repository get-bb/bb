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

export function pluginFailureHasConfiguredPath(
  plugin: PluginListItem,
): boolean {
  return /\bconfigured\b.*\b(?:directory|folder|path)\b/iu.test(
    plugin.statusDetail ?? "",
  );
}

function pluginRuntimeRecovery(plugin: PluginListItem): string {
  switch (plugin.status) {
    case "running":
    case "error":
      if (pluginFailureHasConfiguredPath(plugin)) {
        return "Check that the configured path exists and bb can access it, then reload the plugin.";
      }
      if (plugin.source.startsWith("path:")) {
        return "Fix the reported problem in the local plugin, then reload it.";
      }
      if (plugin.provenance === "builtin") {
        return "Reload the plugin. If it still fails, restart bb.";
      }
      return "Check the cause above, then reload the plugin.";
    case "incompatible":
      return plugin.provenance === "builtin"
        ? "Update bb to load a compatible bundled plugin."
        : "Install a version compatible with this bb.";
    case "missing":
      if (plugin.source.startsWith("path:")) {
        return "Restore the local plugin directory, then reload the plugin. If it moved, add it from its new path.";
      }
      return plugin.provenance === "builtin"
        ? "Restart bb. If the files are still missing, reinstall bb."
        : "Remove the plugin, then install it again from its source.";
    case "needs-configuration":
      return plugin.hasSettings
        ? "Open settings and complete the required configuration; bb reloads the plugin after you save."
        : "Add the required configuration, then reload the plugin.";
    case "degraded":
      return "Wait a moment, then reload the plugin.";
    default:
      return "";
  }
}

function pluginRuntimeCondition(plugin: PluginListItem): string {
  const detail = plugin.statusDetail?.trim();
  if (plugin.status !== "starting" && detail) return detail;
  switch (plugin.status) {
    case "starting":
      return "The plugin is starting. This can take a moment.";
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

export function pluginRuntimeStatusPresentation(
  plugin: PluginListItem,
): PluginRuntimeStatusPresentation | null {
  if (plugin.status === "running") {
    const detail = plugin.statusDetail?.trim();
    if (detail) {
      const reloadFailed = detail.startsWith("reload failed:");
      return {
        icon: "AlertTriangle",
        label: reloadFailed ? "Reload failed" : "Needs attention",
        tone: "warning",
        condition: detail,
        recovery: [
          reloadFailed ? "The previous plugin instance is still running." : "",
          pluginRuntimeRecovery(plugin),
        ]
          .filter(Boolean)
          .join(" "),
      };
    }
    if (plugin.services.some((service) => service.state === "backoff")) {
      return {
        icon: "RotateCcw",
        label: "Restarting",
        tone: "warning",
        condition: "A background service crashed and bb is restarting it.",
        recovery: "Wait for it to restart.",
      };
    }
  }
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
