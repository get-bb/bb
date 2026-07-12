import { useEffect, useRef, useState } from "react";
import { appToast } from "@/components/ui/app-toast.js";
import {
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { pluginToastSignal } from "./plugin-update-signals";
import { UpdatePluginDialog } from "./UpdatePluginDialog";

/**
 * Plugin-update notifications (locked design "Update confirmation and
 * notifications"), mirroring the desktop-update sticky-toast pattern:
 * a compatible update toasts with "Review" (opens the confirmation dialog)
 * and Dismiss — nothing is EVER applied from the toast. Incompatible newer
 * releases never toast; a failed update + rollback toasts and the row badge
 * carries the state. Driven by the plugin list, which the realtime
 * `plugins-changed` broadcast keeps fresh.
 */

// Session-scoped: a dismissed toast stays quiet until the signal changes
// (new version, new failure) or the app reloads. Durable dismissal is the
// detail page's Ignore (ignoredVersion), which mutes the signal entirely.
const shownSignalKeys = new Set<string>();

export function resetPluginUpdateToastsForTest(): void {
  shownSignalKeys.clear();
}

export function PluginUpdateToasts() {
  const systemConfig = useSystemConfig();
  const pluginsEnabled = systemConfig.data?.experiments.plugins === true;
  const listQuery = usePluginList({ enabled: pluginsEnabled });
  const plugins = listQuery.data;
  const [reviewPluginId, setReviewPluginId] = useState<string | null>(null);
  // The dialog reads live list data so a re-check between toast and click
  // shows current state.
  const reviewPlugin =
    reviewPluginId === null
      ? null
      : (plugins?.find((plugin) => plugin.id === reviewPluginId) ?? null);
  const openReviewRef = useRef((pluginId: string) => {
    setReviewPluginId(pluginId);
  });

  useEffect(() => {
    if (plugins === undefined) return;
    for (const plugin of plugins) {
      maybeToastForPlugin(plugin, openReviewRef.current);
    }
  }, [plugins]);

  if (reviewPlugin === null) return null;
  return (
    <UpdatePluginDialog
      plugin={reviewPlugin}
      open
      onOpenChange={(open) => {
        if (!open) setReviewPluginId(null);
      }}
    />
  );
}

function maybeToastForPlugin(
  plugin: PluginListItem,
  openReview: (pluginId: string) => void,
): void {
  const signal = pluginToastSignal(plugin);
  if (signal === null) return;
  if (shownSignalKeys.has(signal.key)) return;
  shownSignalKeys.add(signal.key);

  const displayName = plugin.displayName ?? plugin.id;
  if (signal.kind === "update-available") {
    appToast.message("Plugin update available", {
      id: signal.key,
      duration: Infinity,
      description:
        plugin.marketplaceName !== null
          ? `${displayName} ${signal.version} — compatible update from ${plugin.marketplaceName}`
          : `${displayName} ${signal.version} — compatible update`,
      action: {
        label: "Review",
        onClick: () => openReview(plugin.id),
      },
      cancel: {
        label: "Dismiss",
        onClick: () => appToast.dismiss(signal.key),
      },
    });
    return;
  }

  appToast.error("Plugin update failed — rolled back", {
    id: signal.key,
    duration: Infinity,
    description: `${displayName} ${signal.version} failed to start. bb restored ${plugin.version} and its data.`,
  });
}
