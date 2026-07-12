import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { appToast } from "@/components/ui/app-toast.js";
import { SettingsWithControl } from "@/components/ui/settings-section.js";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  checkPluginUpdates,
  ignorePluginVersion,
  setPluginUpdatePolicy,
  usePluginSource,
} from "@/hooks/queries/plugin-marketplace-queries";
import {
  PLUGIN_UPDATE_POLICIES,
  type PluginListItem,
  type PluginUpdatePolicy,
} from "@/hooks/queries/plugin-settings-queries";
import { formatRelativeTime } from "@/lib/relative-time";
import { pluginUpdateAvailableVersion } from "./plugin-update-signals";
import {
  KeyValueGrid,
  SUCCESS_BANNER_STYLE,
  UPDATE_POLICY_LABELS,
  formatAbsoluteDate,
} from "./plugin-ui";
import { UpdatePluginDialog } from "./UpdatePluginDialog";

/**
 * Layer 2 (sketch v2, detail page): the update-available banner and the
 * "Updates & source" card. Everything that was crowding the list row lands
 * here — human source line, update policy, last check — with the full
 * technical detail one disclosure deeper under "Source details".
 *
 * Builtins are provenance, not a marketplace: their update channel is the
 * bb app release itself, so none of these surfaces render for them (or for
 * older servers that predate provenance).
 */
export function pluginHasUpdateSurfaces(plugin: PluginListItem): boolean {
  return plugin.provenance === "direct" || plugin.provenance === "marketplace";
}

export function PluginUpdateBanner({ plugin }: { plugin: PluginListItem }) {
  const queryClient = useQueryClient();
  const [updateOpen, setUpdateOpen] = useState(false);
  const availableVersion = pluginUpdateAvailableVersion(plugin);
  const failure = plugin.updateState.lastFailure;

  const ignore = useMutation({
    mutationFn: (version: string) =>
      ignorePluginVersion(fetch, plugin.id, version),
    onSuccess: () => invalidatePluginList({ queryClient }),
    onError: (error) => {
      appToast.error("Ignoring the version failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

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
            {failure.detail ??
              `Code and data were restored to ${plugin.version}.`}
            {plugin.updateState.quarantined
              ? " The failed release is quarantined until you retry."
              : ""}
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
            Update available — {availableVersion}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Compatible with your bb.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={ignore.isPending}
          onClick={() => ignore.mutate(availableVersion)}
        >
          Ignore
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => setUpdateOpen(true)}
        >
          Update…
        </Button>
      </div>
      <UpdatePluginDialog
        plugin={plugin}
        open={updateOpen}
        onOpenChange={setUpdateOpen}
      />
    </>
  );
}

export function PluginUpdatesSourceCard({ plugin }: { plugin: PluginListItem }) {
  const queryClient = useQueryClient();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const sourceQuery = usePluginSource(plugin.id, { enabled: detailsOpen });

  const setPolicy = useMutation({
    mutationFn: (policy: PluginUpdatePolicy) =>
      setPluginUpdatePolicy(fetch, plugin.id, policy),
    onSuccess: () => invalidatePluginList({ queryClient }),
    onError: (error) => {
      appToast.error("Changing the update policy failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const checkNow = useMutation({
    mutationFn: () => checkPluginUpdates(fetch, { id: plugin.id }),
    onSuccess: () => invalidatePluginList({ queryClient }),
    onError: (error) => {
      appToast.error("The update check failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  if (!pluginHasUpdateSurfaces(plugin)) return null;

  const state = plugin.updateState;
  const policy = plugin.updatePolicy;
  const source = sourceQuery.data ?? null;
  const blockedVersion =
    state.availableVersion === null ? state.blockedVersion : null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">
        Updates &amp; source
      </h3>
      <div className="rounded-lg border border-border bg-card px-4 py-3.5">
        <div className="divide-y divide-border">
          <div className="pb-3">
            <SettingsWithControl
              label="Source"
              description={plugin.sourceDisplay ?? "Unknown source"}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                aria-expanded={detailsOpen}
                onClick={() => setDetailsOpen((current) => !current)}
              >
                Details
              </Button>
            </SettingsWithControl>
            {detailsOpen ? (
              <div
                className="mt-2 rounded-md border border-border-seam bg-muted/30 px-3 py-2.5"
                data-testid="plugin-source-details"
              >
                {sourceQuery.isPending ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon name="Spinner" className="size-3.5 animate-spin" />
                    Loading source details…
                  </p>
                ) : source === null ? (
                  <p className="text-xs text-muted-foreground">
                    Source details are unavailable.
                  </p>
                ) : (
                  <KeyValueGrid
                    entries={[
                      { key: "Requested", value: source.requested },
                      {
                        key: "Resolved",
                        value:
                          source.integrity !== null
                            ? `${source.resolved} · ${source.integrity}`
                            : source.resolved,
                      },
                      ...(source.registry !== null
                        ? [{ key: "Registry", value: source.registry }]
                        : []),
                      ...(source.engines.bb !== null ||
                      source.engines.bbPluginSdk !== null
                        ? [
                            {
                              key: "Requires",
                              value: [
                                source.engines.bb !== null
                                  ? `bb ${source.engines.bb}`
                                  : null,
                                source.engines.bbPluginSdk !== null
                                  ? `sdk ${source.engines.bbPluginSdk}`
                                  : null,
                              ]
                                .filter(
                                  (part): part is string => part !== null,
                                )
                                .join(" · "),
                            },
                          ]
                        : []),
                      ...(source.installedAt !== null
                        ? [
                            {
                              key: "Installed",
                              value: formatAbsoluteDate(source.installedAt),
                              mono: false,
                            },
                          ]
                        : []),
                      ...(source.history.length > 0
                        ? [
                            {
                              key: "History",
                              value: source.history
                                .map((entry) => entry.version)
                                .join(" ← "),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              </div>
            ) : null}
          </div>

          <div className="py-3">
            <SettingsWithControl
              label="Update policy"
              description="How new releases are applied"
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 justify-between border-border/60 bg-card px-2 text-xs sm:w-44"
                    aria-label="Update policy"
                    disabled={policy === null || setPolicy.isPending}
                  >
                    <span className="min-w-0 truncate">
                      {policy === null ? "—" : UPDATE_POLICY_LABELS[policy]}
                    </span>
                    <Icon
                      name="ChevronDown"
                      className="size-3.5 text-muted-foreground"
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-[var(--radix-dropdown-menu-trigger-width)]"
                >
                  {PLUGIN_UPDATE_POLICIES.map((option) => (
                    <DropdownMenuItem
                      key={option}
                      onSelect={() => setPolicy.mutate(option)}
                    >
                      {UPDATE_POLICY_LABELS[option]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </SettingsWithControl>
          </div>

          <div className={blockedVersion !== null ? "py-3" : "pt-3"}>
            <SettingsWithControl
              label="Last checked"
              description={
                state.lastCheckAt !== null
                  ? formatRelativeTime({
                      timestamp: state.lastCheckAt,
                      now: Date.now(),
                    })
                  : "Never checked"
              }
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={checkNow.isPending}
                aria-busy={checkNow.isPending}
                onClick={() => checkNow.mutate()}
              >
                {checkNow.isPending ? (
                  <Icon name="Spinner" className="size-3.5 animate-spin" />
                ) : null}
                Check now
              </Button>
            </SettingsWithControl>
          </div>

          {blockedVersion !== null ? (
            // Newer-but-incompatible surfaces here, never on the list
            // (locked design): nothing is actionable, so no pill and no
            // toast — just the explanation one click away.
            <div className="pt-3">
              <SettingsWithControl
                label={`${blockedVersion} isn't compatible with this bb`}
                description={
                  plugin.updateState.blockedReasons[0] ??
                  `Staying on ${plugin.version}.`
                }
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setBlockedOpen(true)}
                >
                  Details
                </Button>
              </SettingsWithControl>
            </div>
          ) : null}
        </div>
      </div>
      {blockedVersion !== null ? (
        <UpdatePluginDialog
          plugin={plugin}
          open={blockedOpen}
          onOpenChange={setBlockedOpen}
        />
      ) : null}
    </div>
  );
}
