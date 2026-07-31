import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { ResourceActionButton } from "@bb/shared-ui/resource-list";
import { PluginBannerBar } from "@/components/tools/plugin-detail-banner";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import { pluginUpdateAvailableVersion } from "./plugin-status";
import { formatAbsoluteDate } from "./plugin-ui";
import { UpdatePluginDialog } from "./UpdatePluginDialog";

/**
 * Whether a plugin has any update surfaces at all.
 *
 * Bundled plugins — auto builtins and store-installed officials alike — are
 * pinned to the copy shipped inside the app and update with bb releases, so
 * none of these surfaces render for them.
 */
export function pluginHasUpdateSurfaces(plugin: PluginListItem): boolean {
  if (plugin.source.startsWith("builtin:")) return false;
  return plugin.provenance === "direct" || plugin.provenance === "catalog";
}

export function PluginUpdateBanner({ plugin }: { plugin: PluginListItem }) {
  const [updateOpen, setUpdateOpen] = useState(false);
  const availableVersion = pluginUpdateAvailableVersion(plugin);
  const failure = plugin.updateState.lastFailure;

  if (!pluginHasUpdateSurfaces(plugin)) return null;

  if (failure !== null) {
    return (
      <PluginBannerBar
        tone="destructive"
        icon="CircleX"
        testId="plugin-update-failure-banner"
        title={`Update to ${failure.version} failed — rolled back${
          failure.at !== null ? ` on ${formatAbsoluteDate(failure.at)}` : ""
        }`}
        detail={
          failure.detail.length > 0
            ? failure.detail
            : `Code and data were restored to ${plugin.version}.`
        }
      />
    );
  }

  if (availableVersion === null) return null;

  return (
    <>
      <PluginBannerBar
        tone="success"
        icon="PackageReceive"
        testId="plugin-update-banner"
        title={`Update to ${availableVersion}`}
        detail="Compatible with your bb."
        action={
          <Button
            type="button"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setUpdateOpen(true)}
          >
            Update
          </Button>
        }
      />
      <UpdatePluginDialog
        failureStateLabel="Update failed"
        plugin={plugin}
        open={updateOpen}
        onOpenChange={setUpdateOpen}
      />
    </>
  );
}

/**
 * A blocked update, rendered in the page's banner stack rather than inside
 * Release. It is something the user may need to act on, so it belongs with the
 * other banners above the page instead of halfway down it.
 */
export function PluginCompatibilityBanner({
  plugin,
}: {
  plugin: PluginListItem;
}) {
  const [blockedOpen, setBlockedOpen] = useState(false);
  if (!pluginHasUpdateSurfaces(plugin)) return null;
  const blockedVersion =
    plugin.updateState.availableVersion === null
      ? plugin.updateState.blockedVersion
      : null;
  if (blockedVersion === null) return null;
  return (
    <>
      <PluginBannerBar
        tone="warning"
        icon="AlertTriangle"
        title={`${blockedVersion} isn't compatible with this bb`}
        detail={
          plugin.updateState.blockedReasons[0] ??
          `Staying on ${plugin.version}.`
        }
        action={
          <ResourceActionButton
            label="View compatibility details"
            icon="Info"
            onClick={() => setBlockedOpen(true)}
          />
        }
      />
      <UpdatePluginDialog
        failureStateLabel="Update failed"
        plugin={plugin}
        open={blockedOpen}
        onOpenChange={setBlockedOpen}
      />
    </>
  );
}
