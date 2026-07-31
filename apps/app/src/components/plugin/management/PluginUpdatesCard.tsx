import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { ResourceActionButton } from "@bb/shared-ui/resource-list";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import { pluginUpdateAvailableVersion } from "./plugin-status";
import { SUCCESS_BANNER_STYLE, formatAbsoluteDate } from "./plugin-ui";
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
      <div
        className="flex items-center gap-3 rounded-lg border border-destructive-text/30 bg-destructive/5 px-3 py-2.5"
        data-testid="plugin-update-failure-banner"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-destructive-text">
            Update to {failure.version} failed — rolled back
            {failure.at !== null ? ` on ${formatAbsoluteDate(failure.at)}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {failure.detail.length > 0
              ? failure.detail
              : `Code and data were restored to ${plugin.version}.`}
          </p>
        </div>
      </div>
    );
  }

  if (availableVersion === null) return null;

  return (
    <>
      <div
        className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
        style={SUCCESS_BANNER_STYLE}
        data-testid="plugin-update-banner"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            Update to {availableVersion}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Compatible with your bb.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => setUpdateOpen(true)}
        >
          Update
        </Button>
      </div>
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
 * other banners at the top instead of halfway down the page.
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
      <div className="flex min-w-0 items-start gap-3 rounded-md border border-warning/30 bg-warning/5 px-3.5 py-3">
        <Icon
          name="AlertTriangle"
          className="mt-0.5 size-4 shrink-0 text-warning"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {blockedVersion} isn&apos;t compatible with this bb
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {plugin.updateState.blockedReasons[0] ??
              `Staying on ${plugin.version}.`}
          </p>
        </div>
        <ResourceActionButton
          label="View compatibility details"
          icon="Info"
          onClick={() => setBlockedOpen(true)}
        />
      </div>
      <UpdatePluginDialog
        failureStateLabel="Update failed"
        plugin={plugin}
        open={blockedOpen}
        onOpenChange={setBlockedOpen}
      />
    </>
  );
}
