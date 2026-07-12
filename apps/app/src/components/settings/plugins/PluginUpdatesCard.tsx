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
import { Switch } from "@bb/shared-ui/switch";
import { appToast } from "@/components/ui/app-toast.js";
import { SettingsWithControl } from "@/components/ui/settings-section.js";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  checkPluginUpdates,
  ignorePluginVersion,
  setPluginAutoApply,
  setPluginUpdatePolicy,
  useMarketplaces,
  usePluginSource,
  usePluginUpdateHistory,
  type PluginUpdateHistoryEvent,
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

export function PluginUpdatesSourceCard({
  plugin,
  autoApplyDisabled,
}: {
  plugin: PluginListItem;
  /** Org kill-switch (GET /plugins `autoApplyDisabled`); overrides everything. */
  autoApplyDisabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const sourceQuery = usePluginSource(plugin.id, { enabled: detailsOpen });
  const historyQuery = usePluginUpdateHistory(plugin.id, {
    enabled: historyOpen,
  });
  // The plugin row only carries the marketplace display name, so the forcing
  // marketplace is looked up by that name in the catalog list.
  const marketplacesQuery = useMarketplaces({
    enabled: plugin.provenance === "marketplace",
  });
  const forcingMarketplace =
    plugin.provenance === "marketplace" && plugin.marketplaceName !== null
      ? (marketplacesQuery.data?.find(
          (marketplace) =>
            marketplace.displayName === plugin.marketplaceName &&
            marketplace.autoApply,
        ) ?? null)
      : null;

  const setAutoApply = useMutation({
    mutationFn: (enabled: boolean) =>
      setPluginAutoApply(fetch, plugin.id, enabled),
    onSuccess: () => invalidatePluginList({ queryClient }),
    onError: (error) => {
      appToast.error("Changing automatic updates failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

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

          {plugin.autoApply !== null ? (
            <div className="py-3" data-testid="plugin-auto-apply-row">
              <SettingsWithControl
                label="Automatic updates"
                description={
                  autoApplyDisabled
                    ? "Automatic updates are disabled by your organization."
                    : forcingMarketplace !== null
                      ? `Enabled via the ${forcingMarketplace.displayName} marketplace.`
                      : "Compatible releases apply without asking; a failed update rolls back automatically."
                }
              >
                <Switch
                  aria-label="Automatic updates"
                  // Org policy wins: the switch must never read as active
                  // while the org kill-switch is on, even if the effective
                  // per-plugin/marketplace value is true.
                  checked={!autoApplyDisabled && plugin.autoApply}
                  disabled={
                    autoApplyDisabled ||
                    forcingMarketplace !== null ||
                    setAutoApply.isPending
                  }
                  onCheckedChange={(checked) => setAutoApply.mutate(checked)}
                />
              </SettingsWithControl>
            </div>
          ) : null}

          <div className="py-3">
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
            <div className="py-3">
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

          <div className="pt-3">
            <SettingsWithControl
              label="Update history"
              description="Checks, downloads, activations, and rollbacks"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen((current) => !current)}
              >
                History
              </Button>
            </SettingsWithControl>
            {historyOpen ? (
              <div
                className="mt-2 rounded-md border border-border-seam bg-muted/30 px-3 py-2.5"
                data-testid="plugin-update-history"
              >
                {historyQuery.isPending ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon name="Spinner" className="size-3.5 animate-spin" />
                    Loading update history…
                  </p>
                ) : historyQuery.data == null ? (
                  <p className="text-xs text-muted-foreground">
                    Update history is unavailable.
                  </p>
                ) : historyQuery.data.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No update activity yet.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {historyQuery.data.map((event, index) => (
                      <UpdateHistoryRow key={index} event={event} />
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
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

/** "time · kind · from→to · outcome", detail on a second line (newest first). */
function UpdateHistoryRow({ event }: { event: PluginUpdateHistoryEvent }) {
  const versions =
    event.fromVersion !== null && event.toVersion !== null
      ? `${event.fromVersion} → ${event.toVersion}`
      : (event.toVersion ?? event.fromVersion);
  const line = [
    event.at !== null ? formatHistoryTimestamp(event.at) : null,
    event.kind,
    versions,
    event.outcome,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  return (
    <li className="text-xs">
      <span
        className={
          event.kind === "rollback"
            ? "font-medium text-destructive-text"
            : "text-foreground"
        }
      >
        {line}
      </span>
      {event.detail !== null ? (
        <p className="mt-0.5 text-2xs text-subtle-foreground">{event.detail}</p>
      ) : null}
    </li>
  );
}

function formatHistoryTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
