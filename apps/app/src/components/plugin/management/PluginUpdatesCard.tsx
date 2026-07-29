import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  ResourceActionButton,
  ResourceDetailFact,
  ResourceDetailFacts,
} from "@bb/shared-ui/resource-list";
import { usePluginSource } from "@/hooks/queries/plugin-catalog-queries";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import { pluginUpdateAvailableVersion } from "./plugin-status";
import { SUCCESS_BANNER_STYLE, formatAbsoluteDate } from "./plugin-ui";
import { UpdatePluginDialog } from "./UpdatePluginDialog";

/**
 * Detail-page release facts. The source endpoint contributes only the useful
 * installation timestamp; requested/resolved transport strings stay out of
 * the user-facing taxonomy.
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

export function PluginReleaseFacts({
  plugin,
  releaseVersion,
}: {
  plugin: PluginListItem;
  /** Includes current release identity alongside the other release facts. */
  releaseVersion?: string;
}) {
  const [blockedOpen, setBlockedOpen] = useState(false);
  const sourceQuery = usePluginSource(plugin.id, { enabled: true });

  if (!pluginHasUpdateSurfaces(plugin)) return null;

  const source = sourceQuery.data ?? null;
  const blockedVersion =
    plugin.updateState.availableVersion === null
      ? plugin.updateState.blockedVersion
      : null;

  return (
    <div className="space-y-3">
      <ResourceDetailFacts>
        {releaseVersion ? (
          <ResourceDetailFact label="Current version" mono>
            {releaseVersion}
          </ResourceDetailFact>
        ) : null}
        {source?.installedAt !== null && source?.installedAt !== undefined ? (
          <ResourceDetailFact label="Installed">
            {formatAbsoluteDate(source.installedAt)}
          </ResourceDetailFact>
        ) : null}
      </ResourceDetailFacts>
      {/* Compatibility is not a peer fact: it is a blocked update that the user
          may need to act on, so it keeps a tone, an icon, and its own action
          instead of hiding in a fact row. */}
      {blockedVersion !== null ? (
        <div className="flex min-w-0 items-start gap-2.5 rounded-md border border-warning/30 bg-warning/5 px-3 py-2.5">
          <Icon
            name="AlertTriangle"
            className="mt-0.5 size-4 shrink-0 text-warning"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">
              {blockedVersion} isn&apos;t compatible with this bb
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
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
      ) : null}
      {blockedVersion !== null ? (
        <UpdatePluginDialog
          failureStateLabel="Update failed"
          plugin={plugin}
          open={blockedOpen}
          onOpenChange={setBlockedOpen}
        />
      ) : null}
    </div>
  );
}
