import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { PluginBannerBar } from "@/components/tools/plugin-detail-banner";
import { appToast } from "@/components/ui/app-toast";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import { applyPluginUpdate } from "@/hooks/queries/plugin-catalog-queries";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import { pluginUpdateAvailableVersion } from "./plugin-status";
import {
  DetailsDisclosure,
  displayPluginVersion,
  formatAbsoluteDate,
} from "./plugin-ui";
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
        title={`Update to ${displayPluginVersion(failure.version)} failed — rolled back${
          failure.at !== null ? ` on ${formatAbsoluteDate(failure.at)}` : ""
        }`}
        detail={
          failure.detail.length > 0
            ? failure.detail
            : `Code and data were restored to ${displayPluginVersion(plugin.version)}.`
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
        title={`Update to ${displayPluginVersion(availableVersion)}`}
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

function sentence(value: string): string {
  const trimmed = value.trim();
  const capitalized = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  return /[.!?]$/u.test(capitalized) ? capitalized : `${capitalized}.`;
}

/**
 * Release action for the plugin detail section header.
 *
 * Updates describe the installed artifact, not the plugin's current ability
 * to operate. Keeping them in the Release section prevents routine update
 * availability and historical rollbacks from competing with activation or
 * present-tense health banners.
 */
export function PluginDetailReleaseControl({
  plugin,
}: {
  plugin: PluginListItem;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const queryClient = useQueryClient();
  const name = plugin.name ?? plugin.id;
  const availableVersion = plugin.updateState.availableVersion;
  const failure = plugin.updateState.lastFailure;
  const retry = useMutation({
    mutationFn: () => applyPluginUpdate(fetch, plugin.id),
    onSuccess: (result) => {
      invalidatePluginList({ queryClient });
      if (result.outcome === "rolled-back") {
        appToast.error(`Updating ${name} failed`, {
          description:
            result.detail ??
            `${displayPluginVersion(plugin.version)} was restored.`,
        });
      } else if (result.applied) {
        appToast.success(`${name} updated`, {
          description:
            result.to === null
              ? undefined
              : `Now running ${displayPluginVersion(result.to.display)}.`,
        });
      } else {
        appToast.message(`${name} is already up to date`);
      }
    },
    onError: (error) => {
      appToast.error(`Updating ${name} failed`, {
        description: pluginAdminErrorMessage(error),
      });
    },
  });

  if (!pluginHasUpdateSurfaces(plugin)) return null;
  if (availableVersion === null) return null;

  if (failure !== null) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        disabled={retry.isPending}
        aria-busy={retry.isPending}
        aria-label={`Retry update to ${displayPluginVersion(availableVersion)}`}
        onClick={() => retry.mutate()}
      >
        {retry.isPending ? (
          <Icon name="Spinner" className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Icon name="RotateCcw" className="size-3.5" aria-hidden />
        )}
        Retry
      </Button>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        aria-label={`Update ${plugin.name ?? plugin.id} to ${displayPluginVersion(availableVersion)}`}
        onClick={() => setDetailsOpen(true)}
      >
        <Icon name="PackageReceive" className="size-3.5" aria-hidden />
        Update
      </Button>
      <UpdatePluginDialog
        plugin={plugin}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </>
  );
}

/** Passive update context shown in the Release table. */
export function PluginDetailReleaseStatus({
  plugin,
}: {
  plugin: PluginListItem;
}) {
  const failure = plugin.updateState.lastFailure;
  const blockedVersion = pluginCompatibilityBlockedVersion(plugin);
  const blockedReasons = plugin.updateState.blockedReasons;

  if (!pluginHasUpdateSurfaces(plugin)) return null;

  if (failure !== null) {
    return (
      <div
        role="status"
        aria-label="Update failed"
        className="flex min-w-0 items-start gap-2.5"
      >
        <Icon
          name="CircleX"
          className="mt-0.5 size-4 shrink-0 text-destructive"
          aria-hidden
        />
        <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
          bb couldn&rsquo;t activate {displayPluginVersion(failure.version)}. It
          restored {displayPluginVersion(plugin.version)} and its data.
        </p>
      </div>
    );
  }

  if (
    plugin.updateState.outcome === "unavailable" &&
    plugin.updateState.detail !== null
  ) {
    return (
      <div
        role="status"
        aria-label="Update needs attention"
        className="flex min-w-0 items-start gap-2.5"
      >
        <Icon
          name="AlertTriangle"
          className="mt-0.5 size-4 shrink-0 text-warning"
          aria-hidden
        />
        <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
          {plugin.updateState.detail}
        </p>
      </div>
    );
  }

  if (plugin.updateState.availableVersion !== null) {
    return (
      <div role="status" className="flex min-w-0 items-baseline gap-2">
        <span className="font-mono text-xs text-foreground">
          {displayPluginVersion(plugin.updateState.availableVersion)}
        </span>
        <span className="text-xs text-muted-foreground">Available</span>
      </div>
    );
  }

  if (blockedVersion === null) return null;
  return (
    <div
      role="status"
      aria-label="Update blocked"
      className="flex min-w-0 items-start gap-2.5"
    >
      <Icon
        name="AlertTriangle"
        className="mt-0.5 size-4 shrink-0 text-warning"
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {blockedReasons[0] === undefined
            ? `${displayPluginVersion(blockedVersion)} isn’t compatible with this bb.`
            : sentence(blockedReasons[0])}{" "}
          {displayPluginVersion(plugin.version)} remains installed. Keep using
          it and check again when a compatible plugin version is available.
        </p>
        {blockedReasons.length > 1 ? (
          <div className="mt-1.5">
            <DetailsDisclosure summary="Other requirements">
              <ul className="space-y-1 text-foreground">
                {blockedReasons.slice(1).map((reason) => (
                  <li key={reason}>{sentence(reason)}</li>
                ))}
              </ul>
            </DetailsDisclosure>
          </div>
        ) : null}
      </div>
    </div>
  );
}
