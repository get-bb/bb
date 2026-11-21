import { PluginNameTag } from "@/components/plugin/management/PluginNameTag";
import { splitPluginDisplayName } from "@bb/domain/plugin-display-name";
import { PluginCardAuthorAvatar } from "@/components/plugin/management/PluginCard";
import { CURATED_PLUGIN_MARKETPLACE_NAME } from "@bb/server-contract";
import { useState, useSyncExternalStore } from "react";
import { RadioGroup, RadioGroupItem } from "@bb/shared-ui/radio-group";
import {
  ResourceActionButton,
  ResourceActivitySection,
  ResourceDefinitionSection,
  ResourceDetailPage,
  ResourceDetailReleaseSection,
  ResourceDetailStack,
  ResourceListState,
  ResourceOverflowMenu,
  type ResourceOverflowMenuItem,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { formatHomePathForDisplay } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import { useNavigate } from "react-router-dom";
import {
  pluginHasUpdateSurfaces,
  reviewableRangeUpgrade,
} from "@/components/plugin/management/plugin-status";
import {
  PluginDetailReleaseControl,
  PluginDetailReleaseStatus,
} from "@/components/plugin/management/PluginUpdatesCard";
import {
  CatalogEntryIconChip,
  formatAbsoluteDate,
  PluginLogo,
  pluginInstallCountPresentation,
} from "@/components/plugin/management/plugin-ui";
import {
  PluginDetailMetadata,
  PluginDetailMetadataItem,
  PluginMarketplaceByline,
  PluginMarketplaceDetailMetadata,
  PluginMarketplaceListingSections,
  PluginMarketplaceOverview,
  PluginMarketplaceSource,
  PluginMoreFromAuthorSection,
  PluginOverviewLead,
} from "@/components/plugin/management/PluginMarketplaceListing";
import { pluginRuntimeStatusPresentation } from "@/components/plugin/management/plugin-status";
import { PluginCatalogInstallControl } from "@/components/plugin/management/PluginCatalogInstallControl";
import {
  useCancelPluginInstallJob,
  useCatalogEntryInstallJob,
} from "@/hooks/queries/plugin-install-job-queries";
import {
  catalogEntryDetailKey,
  catalogEntryInstallBlocker,
} from "@/components/plugin/management/installed-plugin-catalog";
import {
  PluginHealthBanner,
  PluginIncludes,
  PluginSchedules,
  PluginServices,
} from "@/components/tools/PluginCapabilities";
import {
  PluginBannerBar,
  PluginBannerOpenButton,
} from "@/components/tools/plugin-detail-banner";
import {
  usePluginSource,
  usePluginUpdateCheck,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import {
  getPluginFrontendDiagnostics,
  subscribePluginFrontendDiagnostics,
  type PluginFrontendDiagnostic,
} from "@/lib/plugin-frontend";
import { usePluginSlotKind } from "@/lib/plugin-slots";
import { copyToClipboardWithToast, useClipboardCopy } from "@/lib/clipboard";
import { getSettingsTargetPath } from "@/components/settings/settings-sections";
import {
  isOfficialPlugin,
  OFFICIAL_PLUGIN_MARKETPLACE,
} from "@/lib/official-plugins";

function pluginMarketplaceUrl({
  marketplace,
  entryId,
}: {
  marketplace: string | null;
  entryId: string | null;
}): string | null {
  if (marketplace !== CURATED_PLUGIN_MARKETPLACE_NAME || entryId === null) {
    return null;
  }
  return `https://getbb.app/marketplace/${encodeURIComponent(entryId)}`;
}

function copyMarketplaceLinkItems(
  url: string | null,
): ResourceOverflowMenuItem[] {
  if (url === null) return [];
  return [
    {
      label: "Copy marketplace link",
      icon: "Copy",
      onSelect: () =>
        void copyToClipboardWithToast(url, {
          successMessage: "Marketplace link copied",
          errorMessage: "Failed to copy marketplace link.",
        }),
    },
  ];
}

export function pluginIsLocalSource(plugin: PluginListItem): boolean {
  return plugin.source.startsWith("path:");
}

export function pluginRemovalLabel(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin) ? "Remove from bb" : "Uninstall";
}

export function pluginRemovalDescription(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin)
    ? `Remove "${plugin.id}" from bb and delete its settings, secrets, stored files, and schedules? Its source files stay on disk. To move it to another directory, install the new path instead; that keeps its settings.`
    : `Uninstall "${plugin.id}" and delete its managed files, settings, secrets, stored files, and schedules?`;
}

function PluginLocalSource({
  path,
  notice,
  openDisabled,
  onOpen,
}: {
  path: string;
  notice: string | null;
  openDisabled: boolean;
  onOpen: () => void;
}) {
  const { copied, copy } = useClipboardCopy({
    text: path,
    errorMessage: "Failed to copy path.",
  });

  return (
    <ResourceDefinitionSection label="Source">
      <div className="flex min-w-0 items-center gap-3">
        <Icon
          name="Folder"
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <TooltipProvider delayDuration={250}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="block truncate rounded-sm font-mono text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {formatHomePathForDisplay(path)}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm break-all">
                {path}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ResourceActionButton
            label="Open source"
            icon="ExternalLink"
            disabled={openDisabled}
            disabledReason={openDisabled ? "No editor configured" : undefined}
            onClick={onOpen}
          />
          <ResourceActionButton
            label={`Copy plugin path: ${path}`}
            tooltipLabel={copied ? "Copied" : "Copy path"}
            icon={copied ? "Check" : "Copy"}
            onClick={() => void copy()}
          />
        </div>
      </div>
      {notice === null ? null : (
        <p
          className="mt-2 flex items-start gap-1.5 text-2xs leading-snug text-subtle-foreground"
          data-testid="plugin-source-notice"
        >
          <Icon name="Info" className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{notice}</span>
        </p>
      )}
    </ResourceDefinitionSection>
  );
}

function PluginListingPicker({
  entry,
  selectedMarketplace,
  onSelect,
}: {
  entry: PluginCatalogSearchEntry;
  selectedMarketplace: string;
  onSelect: (marketplace: string) => void;
}) {
  return (
    <ResourceDefinitionSection label="Install from">
      <RadioGroup
        value={selectedMarketplace}
        onValueChange={onSelect}
        aria-label={`Marketplace to install ${entry.displayName} from`}
      >
        {entry.listings.map((listing) => {
          const id = `plugin-listing-${listing.marketplace}`;
          return (
            <label
              key={listing.marketplace}
              htmlFor={id}
              className="flex min-w-0 cursor-pointer items-start gap-2.5"
            >
              <RadioGroupItem
                id={id}
                value={listing.marketplace}
                className="mt-0.5 shrink-0"
              />
              <span className="min-w-0 space-y-0.5">
                <span className="block text-sm text-foreground">
                  {listing.marketplaceDisplayName}
                </span>
                <span className="block break-all font-mono text-2xs text-subtle-foreground">
                  {listing.source}
                </span>
              </span>
            </label>
          );
        })}
      </RadioGroup>
    </ResourceDefinitionSection>
  );
}

function selectedListingEntry(
  entry: PluginCatalogSearchEntry,
  marketplace: string,
): PluginCatalogSearchEntry {
  const listing = entry.listings.find(
    (candidate) => candidate.marketplace === marketplace,
  );
  if (listing === undefined || listing.marketplace === entry.marketplace) {
    return entry;
  }
  return {
    ...entry,
    entryId: listing.entryId,
    marketplace: listing.marketplace,
    marketplaceDisplayName: listing.marketplaceDisplayName,
    publisherLabel: listing.publisherLabel,
    official: listing.official,
    source: listing.source,
  };
}

const OFFICIAL_BYLINE_ENTRY = {
  author: null,
  marketplace: OFFICIAL_PLUGIN_MARKETPLACE,
  publisherLabel: "BB Official",
} as const;

export function CatalogPluginDetail({
  entry,
  onInstall,
  catalogEntries,
  onOpenPlugin,
}: {
  entry: PluginCatalogSearchEntry;
  onInstall: (entry: PluginCatalogSearchEntry) => void;
  catalogEntries: readonly PluginCatalogSearchEntry[];
  onOpenPlugin: (pluginId: string) => void;
}) {
  const presentation = pluginInstallCountPresentation(entry);
  const count = presentation?.tone === "count" ? presentation : undefined;
  const installBlocker = catalogEntryInstallBlocker(entry);
  const installJob = useCatalogEntryInstallJob(entry);
  const { mutate: cancelInstall } = useCancelPluginInstallJob();
  const [selectedMarketplace, setSelectedMarketplace] = useState(
    entry.marketplace,
  );
  const overflowItems = copyMarketplaceLinkItems(pluginMarketplaceUrl(entry));
  const entryTitle = splitPluginDisplayName(entry.displayName);
  return (
    <ResourceDetailPage
      maxWidthClassName="max-w-5xl"
      leading={<CatalogEntryIconChip entry={entry} compact />}
      leadingClassName="size-6"
      title={entryTitle.name}
      titleMeta={
        entryTitle.tag ? <PluginNameTag tag={entryTitle.tag} /> : undefined
      }
      metadataLeading={<PluginCardAuthorAvatar entry={entry} />}
      metadata={<PluginMarketplaceByline entry={entry} />}
      actions={
        <PluginCatalogInstallControl
          displayName={entry.displayName}
          installed={false}
          showLabel
          disabled={installBlocker !== null}
          unavailableReason={installBlocker}
          count={count}
          onInstall={() =>
            onInstall(selectedListingEntry(entry, selectedMarketplace))
          }
          installJob={installJob}
          onCancelInstall={cancelInstall}
        />
      }
      overflowMenu={
        overflowItems.length === 0 ? undefined : (
          <ResourceOverflowMenu
            label={`${entry.displayName} actions`}
            items={overflowItems}
          />
        )
      }
    >
      <ResourceDetailStack>
        <PluginMarketplaceListingSections entry={entry} />
        {entry.listings.length > 1 ? (
          <PluginListingPicker
            entry={entry}
            selectedMarketplace={selectedMarketplace}
            onSelect={setSelectedMarketplace}
          />
        ) : null}
        <PluginMoreFromAuthorSection
          entry={entry}
          catalogEntries={catalogEntries}
          onOpenPlugin={onOpenPlugin}
        />
      </ResourceDetailStack>
    </ResourceDetailPage>
  );
}

export function CatalogPluginDetailBanner({
  entry,
  onOpenPlugin,
}: {
  entry: PluginCatalogSearchEntry;
  onOpenPlugin: (pluginId: string) => void;
}) {
  if (entry.incompatibleReason !== null) {
    return (
      <PluginBannerBar
        tone="warning"
        icon="AlertTriangle"
        title="Update bb to install this plugin"
        detail={entry.incompatibleReason}
      />
    );
  }
  if (entry.conflictingInstallSource === null) return null;
  return (
    <PluginBannerBar
      tone="warning"
      icon="AlertTriangle"
      title="Another plugin uses this ID"
      detail={`remove the installed “${entry.pluginId}” to install this one.`}
      action={
        <PluginBannerOpenButton
          label="View installed plugin"
          onClick={() => onOpenPlugin(entry.pluginId)}
        />
      }
    />
  );
}

function pluginHealthBannerState(
  plugin: PluginListItem,
  frontendDiagnostic: PluginFrontendDiagnostic | undefined,
): { plugin: PluginListItem } | null {
  if (!plugin.enabled) return null;
  if (pluginRuntimeStatusPresentation(plugin) !== null) return { plugin };

  if (pluginFrontendDiagnosticRequiresFailureBanner(frontendDiagnostic)) {
    return {
      plugin: {
        ...plugin,
        status: "error",
        statusDetail: null,
      },
    };
  }
  return null;
}

export function pluginFrontendDiagnosticRequiresFailureBanner(
  diagnostic: PluginFrontendDiagnostic | undefined,
): boolean {
  return diagnostic?.status === "failed";
}

export function PluginDetailBanners({
  plugin,
  configurationPath,
  catalogEntry,
  catalogEntries,
  onOpenPlugin,
}: {
  plugin: PluginListItem;
  configurationPath?: string;
  catalogEntry: PluginCatalogSearchEntry | null;
  catalogEntries: readonly PluginCatalogSearchEntry[];
  onOpenPlugin: (pluginId: string) => void;
}) {
  const frontendDiagnostics = useSyncExternalStore(
    subscribePluginFrontendDiagnostics,
    getPluginFrontendDiagnostics,
    getPluginFrontendDiagnostics,
  );
  const frontendDiagnostic = frontendDiagnostics.get(plugin.id);
  const banner = pluginHealthBannerState(plugin, frontendDiagnostic);
  const publishedListing = catalogEntries.find(
    (entry) =>
      entry.pluginId === plugin.id && entry.conflictingInstallSource !== null,
  );
  const otherListings =
    catalogEntry === null
      ? []
      : catalogEntry.listings.filter(
          (listing) => listing.marketplace !== catalogEntry.marketplace,
        );
  return (
    <>
      {banner === null ? null : (
        <PluginHealthBanner
          plugin={banner.plugin}
          configurationPath={configurationPath}
          runtimeStatus={pluginRuntimeStatusPresentation(banner.plugin)}
        />
      )}
      {otherListings.length === 0 ? null : (
        <PluginBannerBar
          tone="muted"
          icon="Info"
          title={`Also listed in ${otherListings
            .map((listing) => listing.marketplaceDisplayName)
            .join(", ")}`}
        />
      )}
      {publishedListing === undefined ? null : (
        <PluginBannerBar
          tone="muted"
          icon="Info"
          title={`Also published in ${publishedListing.marketplaceDisplayName}`}
          action={
            <PluginBannerOpenButton
              label="View listing"
              onClick={() =>
                onOpenPlugin(catalogEntryDetailKey(publishedListing))
              }
            />
          }
        />
      )}
    </>
  );
}

export function PluginDetail({
  isLoading,
  plugin,
  pending,
  openSourceDisabled,
  onToggle,
  onEdit,
  onOpenSource,
  onDelete,
  catalogEntry,
  catalogEntries,
  onOpenPlugin,
  onConfigure,
  configurationPath,
}: {
  isLoading: boolean;
  plugin: PluginListItem | null;
  pending: boolean;
  openSourceDisabled: boolean;
  onToggle: (plugin: PluginListItem) => void;
  onEdit: (plugin: PluginListItem) => void;
  onOpenSource: (plugin: PluginListItem) => void;
  onDelete: (plugin: PluginListItem) => void;
  catalogEntry?: PluginCatalogSearchEntry;
  catalogEntries: readonly PluginCatalogSearchEntry[];
  onOpenPlugin: (pluginId: string) => void;
  onConfigure?: () => void;
  configurationPath?: string;
}) {
  const navigate = useNavigate();
  const settingsSections = usePluginSlotKind("settingsSections");
  const sourceQuery = usePluginSource(plugin?.id ?? "", {
    enabled: plugin !== null && !plugin.source.startsWith("builtin:"),
  });
  usePluginUpdateCheck(plugin?.id ?? null, {
    enabled: plugin !== null && pluginHasUpdateSurfaces(plugin),
  });
  if (isLoading) {
    return (
      <ResourceListState
        state="loading"
        message="Loading plugins"
        layout="detail"
        maxWidthClassName="max-w-5xl"
      />
    );
  }

  if (plugin === null) {
    return (
      <ResourceListState
        state="empty"
        message="Plugin not found."
        layout="detail"
        maxWidthClassName="max-w-5xl"
      />
    );
  }

  const hasUpdateManagement = pluginHasUpdateSurfaces(plugin);
  const canEditSource = pluginIsLocalSource(plugin);
  const updatesWithBb = plugin.source.startsWith("builtin:");
  const installedAt = sourceQuery.data?.installedAt ?? null;
  const installedValue = updatesWithBb
    ? "Updates with bb"
    : installedAt !== null
      ? formatAbsoluteDate(installedAt)
      : sourceQuery.isPending
        ? "Loading…"
        : "Install date unavailable";
  const hasReleaseControl =
    hasUpdateManagement &&
    (plugin.updateState.availableVersion !== null ||
      reviewableRangeUpgrade(plugin) !== null);
  const hasReleaseUpdate =
    hasUpdateManagement &&
    (plugin.updateState.availableVersion !== null ||
      plugin.updateState.blockedVersion !== null ||
      plugin.updateState.rangeUpgrade !== null ||
      plugin.updateState.lastFailure !== null);
  const hasConfiguration =
    plugin.hasSettings ||
    settingsSections.some((section) => section.pluginId === plugin.id);

  const pluginName = plugin.name ?? plugin.id;
  const pluginTitle = splitPluginDisplayName(pluginName);
  const marketplaceUrl = pluginMarketplaceUrl(
    catalogEntry ?? {
      marketplace: plugin.catalogMarketplaceName,
      entryId: plugin.catalogEntryId,
    },
  );
  const overflowItems: ResourceOverflowMenuItem[] = [
    ...copyMarketplaceLinkItems(marketplaceUrl),
    ...(canEditSource
      ? [
          {
            label: "Edit",
            icon: "Edit" as const,
            disabled: pending,
            onSelect: () => onEdit(plugin),
          },
        ]
      : []),
    {
      label: pluginRemovalLabel(plugin),
      icon: "Trash2" as const,
      tone: "destructive" as const,
      disabled: pending || plugin.provenance === "builtin",
      disabledReason:
        plugin.provenance === "builtin"
          ? "Included with BB; disable this plugin instead."
          : undefined,
      onSelect: () => onDelete(plugin),
    },
  ];
  const bylineEntry =
    catalogEntry ??
    (isOfficialPlugin(plugin) ? OFFICIAL_BYLINE_ENTRY : undefined);
  return (
    <ResourceDetailPage
      maxWidthClassName="max-w-5xl"
      leading={<PluginLogo plugin={plugin} className="size-4" />}
      title={pluginTitle.name}
      titleMeta={
        pluginTitle.tag ? <PluginNameTag tag={pluginTitle.tag} /> : undefined
      }
      metadataLeading={
        bylineEntry === undefined ? undefined : (
          <PluginCardAuthorAvatar entry={bylineEntry} />
        )
      }
      metadata={
        bylineEntry === undefined ? undefined : (
          <PluginMarketplaceByline entry={bylineEntry} />
        )
      }
      actions={
        hasConfiguration ? (
          <ResourceActionButton
            label={`${pluginName} settings`}
            tooltipLabel="Settings"
            icon="Settings"
            onClick={() => {
              if (onConfigure) {
                onConfigure();
                return;
              }
              void navigate(getSettingsTargetPath({ pluginId: plugin.id }));
            }}
          />
        ) : undefined
      }
      lifecycleControl={
        <Switch
          checked={plugin.enabled}
          disabled={pending}
          aria-label={`${plugin.enabled ? "Disable" : "Enable"} ${pluginName}`}
          onCheckedChange={() => onToggle(plugin)}
        />
      }
      overflowMenu={
        <ResourceOverflowMenu
          label={`${pluginName} actions`}
          items={overflowItems}
        />
      }
    >
      <ResourceDetailStack>
        {catalogEntry === undefined ? (
          <section
            className="max-w-prose"
            data-resource-detail-section="overview"
          >
            <PluginOverviewLead
              description={
                plugin.description ?? "This plugin does not describe itself."
              }
            />
          </section>
        ) : (
          <PluginMarketplaceOverview entry={catalogEntry} />
        )}
        {canEditSource ? (
          <PluginLocalSource
            path={plugin.rootDir}
            notice={plugin.sourceNotice}
            openDisabled={pending || openSourceDisabled}
            onOpen={() => onOpenSource(plugin)}
          />
        ) : catalogEntry !== undefined ? (
          <PluginMarketplaceSource entry={catalogEntry} />
        ) : null}
        <ResourceDetailReleaseSection
          label="Details"
          actions={
            hasReleaseControl ? (
              <PluginDetailReleaseControl plugin={plugin} />
            ) : undefined
          }
        >
          <PluginDetailMetadata>
            {catalogEntry === undefined ? null : (
              <PluginMarketplaceDetailMetadata entry={catalogEntry} />
            )}
            <PluginDetailMetadataItem
              label={updatesWithBb ? "Delivery" : "Installed"}
            >
              {installedValue}
            </PluginDetailMetadataItem>
            <PluginDetailMetadataItem label="Version">
              <span className="font-mono">{plugin.version}</span>
            </PluginDetailMetadataItem>
          </PluginDetailMetadata>
          {hasReleaseUpdate ? (
            <div className="space-y-1">
              <p className="text-2xs font-medium text-subtle-foreground">
                Update
              </p>
              <PluginDetailReleaseStatus plugin={plugin} />
            </div>
          ) : null}
        </ResourceDetailReleaseSection>
        <PluginIncludes plugin={plugin} configurationPath={configurationPath} />
        {plugin.services.length > 0 ? (
          <ResourceActivitySection label="Background services">
            <PluginServices plugin={plugin} />
          </ResourceActivitySection>
        ) : null}
        {plugin.schedules.length > 0 ? (
          <ResourceActivitySection label="Scheduled jobs">
            <PluginSchedules plugin={plugin} />
          </ResourceActivitySection>
        ) : null}
        {catalogEntry === undefined ? null : (
          <PluginMoreFromAuthorSection
            entry={catalogEntry}
            catalogEntries={catalogEntries}
            onOpenPlugin={onOpenPlugin}
          />
        )}
      </ResourceDetailStack>
    </ResourceDetailPage>
  );
}
