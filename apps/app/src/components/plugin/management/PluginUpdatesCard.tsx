import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
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

/** The newest release that exists but cannot run on this bb version. */
export function pluginCompatibilityBlockedVersion(
  plugin: PluginListItem,
): string | null {
  if (!pluginHasUpdateSurfaces(plugin)) return null;
  return plugin.updateState.availableVersion === null
    ? plugin.updateState.blockedVersion
    : null;
}

/**
 * Release state beside the version and lifecycle controls on plugin detail.
 *
 * Updates describe the installed artifact, not the plugin's current ability
 * to operate. Keeping them in the header prevents routine update availability
 * and historical rollbacks from competing with present-tense health banners.
 */
export function PluginDetailReleaseControl({
  plugin,
}: {
  plugin: PluginListItem;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const availableVersion = plugin.updateState.availableVersion;
  const blockedVersion = pluginCompatibilityBlockedVersion(plugin);
  const failure = plugin.updateState.lastFailure;

  if (!pluginHasUpdateSurfaces(plugin)) return null;

  if (failure !== null) {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs"
          aria-label={`View failed update to ${failure.version}`}
          onClick={() => setDetailsOpen(true)}
        >
          <Icon
            name="CircleX"
            className="size-3.5 text-destructive"
            aria-hidden
          />
          Update failed
        </Button>
        <UpdatePluginDialog
          failureStateLabel="Update failed"
          plugin={plugin}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      </>
    );
  }

  if (availableVersion !== null) {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs"
          aria-label={`Update ${plugin.name ?? plugin.id} to ${availableVersion}`}
          onClick={() => setDetailsOpen(true)}
        >
          <Icon name="PackageReceive" className="size-3.5" aria-hidden />
          Update
        </Button>
        <UpdatePluginDialog
          failureStateLabel="Update failed"
          plugin={plugin}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      </>
    );
  }

  if (blockedVersion === null) return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2.5 text-xs"
        aria-label={`View why update ${blockedVersion} is blocked`}
        onClick={() => setDetailsOpen(true)}
      >
        <Icon
          name="AlertTriangle"
          className="size-3.5 text-warning"
          aria-hidden
        />
        Update blocked
      </Button>
      <UpdatePluginDialog
        failureStateLabel="Update failed"
        plugin={plugin}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </>
  );
}
