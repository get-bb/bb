import { useSyncExternalStore, type ReactNode } from "react";
import {
  ResourceActivitySection,
  ResourceActionButton,
  ResourceDefinitionSection,
  ResourceDetailPage,
  ResourceDetailReleaseSection,
  ResourceDetailStack,
  ResourceInstallControl,
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
import { getPluginConfigurationRoutePath } from "@/lib/route-paths";
import { CheckPluginUpdatesButton } from "@/components/plugin/management/CheckPluginUpdatesButton";
import {
  PluginDetailReleaseControl,
  PluginDetailReleaseStatus,
  pluginHasUpdateSurfaces,
} from "@/components/plugin/management/PluginUpdatesCard";
import {
  CatalogEntryIconChip,
  formatAbsoluteDate,
  formatPluginInstallCount,
  PluginLogo,
  pluginRemovalDisabled,
} from "@/components/plugin/management/plugin-ui";
import {
  PluginMarketplaceDetailMetadata,
  PluginDetailMetadata,
  PluginDetailMetadataItem,
  PluginMarketplaceHeaderMetadata,
  PluginMarketplaceListingSections,
  PluginMarketplaceOverview,
  PluginMarketplaceSource,
  PluginMoreFromAuthorSection,
  PluginOverviewLead,
} from "@/components/plugin/management/PluginMarketplaceListing";
import { pluginRuntimeStatusPresentation } from "@/components/plugin/management/plugin-status";
import {
  PluginHealthBanner,
  PluginIncludes,
  PluginSchedules,
  PluginServices,
} from "@/components/tools/PluginCapabilities";
import { PluginBannerBar } from "@/components/tools/plugin-detail-banner";
import { ProvenancePill } from "@/components/tools/ProvenancePill";
import {
  usePluginSource,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import {
  getPluginFrontendDiagnostics,
  subscribePluginFrontendDiagnostics,
  type PluginFrontendDiagnostic,
} from "@/lib/plugin-frontend";
import { usePluginSlots } from "@/lib/plugin-slots";
import { useClipboardCopy } from "@/lib/clipboard";

export function PluginProvenancePill({ plugin }: { plugin: PluginListItem }) {
  const label = plugin.publisherLabel;
  return label === null ? null : <ProvenancePill label={label} />;
}

export function pluginIsLocalSource(plugin: PluginListItem): boolean {
  return plugin.source.startsWith("path:");
}

export function pluginRemovalLabel(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin) ? "Remove from bb" : "Uninstall";
}

export function pluginRemovalDescription(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin)
    ? `Remove "${plugin.id}" from bb and delete its settings, secrets, and schedules? Its source files stay on disk. To move it to another directory, install the new path instead; that keeps its settings.`
    : `Uninstall "${plugin.id}" and delete its managed files, settings, secrets, and schedules?`;
}

function PluginLocalSource({
  path,
  openDisabled,
  onOpen,
}: {
  path: string;
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
          <p className="text-sm text-foreground">Local source</p>
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
    </ResourceDefinitionSection>
  );
}

export function CatalogPluginDetail({
  entry,
  onInstall,
  catalogEntries,
  onOpenPlugin,
  headerActions,
}: {
  entry: PluginCatalogSearchEntry;
  onInstall: (entry: PluginCatalogSearchEntry) => void;
  catalogEntries: readonly PluginCatalogSearchEntry[];
  onOpenPlugin: (pluginId: string) => void;
  headerActions?: ReactNode;
}) {
  const count =
    entry.installs === null
      ? undefined
      : {
          display: formatPluginInstallCount(entry.installs),
          accessibleLabel: `${entry.installs.toLocaleString()} ${entry.installs === 1 ? "install" : "installs"}`,
        };
  return (
    <ResourceDetailPage
      maxWidthClassName="max-w-5xl"
      leading={<CatalogEntryIconChip entry={entry} />}
      leadingClassName="size-6"
      title={entry.displayName}
      metadata={<PluginMarketplaceHeaderMetadata entry={entry} />}
      actions={
        <>
          {headerActions}
          <ResourceInstallControl
            accessibleLabel={`Install ${entry.displayName}`}
            disabled={!entry.compatible}
            count={count}
            onAction={() => onInstall(entry)}
          />
        </>
      }
    >
      <ResourceDetailStack>
        <PluginMarketplaceListingSections entry={entry} />
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
}: {
  entry: PluginCatalogSearchEntry;
}) {
  if (entry.incompatibleReason === null) return null;
  return (
    <PluginBannerBar
      tone="warning"
      icon="AlertTriangle"
      title="Update bb to install this plugin"
      detail={entry.incompatibleReason}
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
        statusDetail: frontendDiagnostic?.lastFailure?.message ?? null,
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
  catalogEntry,
  onConfigure,
}: {
  plugin: PluginListItem;
  catalogEntry?: PluginCatalogSearchEntry;
  onConfigure?: () => void;
}) {
  const frontendDiagnostics = useSyncExternalStore(
    subscribePluginFrontendDiagnostics,
    getPluginFrontendDiagnostics,
    getPluginFrontendDiagnostics,
  );
  const frontendDiagnostic = frontendDiagnostics.get(plugin.id);
  const banner = pluginHealthBannerState(plugin, frontendDiagnostic);
  if (banner === null) return null;
  return (
    <PluginHealthBanner
      plugin={banner.plugin}
      runtimeStatus={pluginRuntimeStatusPresentation(banner.plugin)}
      catalogEntry={catalogEntry}
      onConfigure={onConfigure}
    />
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
  headerActions,
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
  headerActions?: ReactNode;
}) {
  const navigate = useNavigate();
  const { settingsSections } = usePluginSlots();
  const sourceQuery = usePluginSource(plugin?.id ?? "", {
    enabled: plugin !== null && !plugin.source.startsWith("builtin:"),
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
    hasUpdateManagement && plugin.updateState.availableVersion !== null;
  const hasReleaseUpdate =
    hasUpdateManagement &&
    (plugin.updateState.availableVersion !== null ||
      plugin.updateState.blockedVersion !== null ||
      plugin.updateState.lastFailure !== null);
  const hasConfiguration =
    plugin.hasSettings ||
    settingsSections.some((section) => section.pluginId === plugin.id);

  const installationMetadata = (
    <>
      <PluginDetailMetadataItem
        label={updatesWithBb ? "Delivery" : "Installed"}
      >
        {installedValue}
      </PluginDetailMetadataItem>
      <PluginDetailMetadataItem label="Version">
        <span className="font-mono">{plugin.version}</span>
      </PluginDetailMetadataItem>
      {hasReleaseUpdate ? (
        <PluginDetailMetadataItem label="Update" className="col-span-2">
          <PluginDetailReleaseStatus plugin={plugin} />
        </PluginDetailMetadataItem>
      ) : null}
    </>
  );
  const pluginName = plugin.name ?? plugin.id;
  const overflowItems: ResourceOverflowMenuItem[] = [
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
      disabled: pending || pluginRemovalDisabled(plugin),
      disabledReason: pluginRemovalDisabled(plugin)
        ? "Included with BB; disable this plugin instead."
        : undefined,
      onSelect: () => {
        if (!pending && !pluginRemovalDisabled(plugin)) onDelete(plugin);
      },
    },
  ];
  return (
    <ResourceDetailPage
      maxWidthClassName="max-w-5xl"
      leading={<PluginLogo plugin={plugin} className="size-4" />}
      title={pluginName}
      metadata={
        catalogEntry === undefined ? undefined : (
          <PluginMarketplaceHeaderMetadata entry={catalogEntry} />
        )
      }
      actions={
        <>
          {headerActions}
          {hasConfiguration ? (
            <ResourceActionButton
              label="Configure"
              icon="Settings"
              onClick={() => {
                if (onConfigure !== undefined) onConfigure();
                else
                  navigate(
                    getPluginConfigurationRoutePath({ pluginId: plugin.id }),
                  );
              }}
            />
          ) : null}
        </>
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
          <PluginOverviewLead
            description={
              plugin.description ?? "This plugin does not describe itself."
            }
          />
        ) : (
          <PluginMarketplaceOverview entry={catalogEntry} />
        )}
        <PluginIncludes plugin={plugin} />
        {canEditSource ? (
          <PluginLocalSource
            path={plugin.rootDir}
            openDisabled={openSourceDisabled}
            onOpen={() => onOpenSource(plugin)}
          />
        ) : catalogEntry === undefined ? null : (
          <PluginMarketplaceSource entry={catalogEntry} />
        )}
        <ResourceDetailReleaseSection
          label="Details"
          actions={
            hasReleaseControl ? (
              <PluginDetailReleaseControl plugin={plugin} />
            ) : hasUpdateManagement ? (
              <CheckPluginUpdatesButton
                pluginId={plugin.id}
                appearance="inline"
              />
            ) : undefined
          }
        >
          <PluginDetailMetadata>
            {catalogEntry === undefined ? (
              installationMetadata
            ) : (
              <PluginMarketplaceDetailMetadata entry={catalogEntry}>
                {installationMetadata}
              </PluginMarketplaceDetailMetadata>
            )}
          </PluginDetailMetadata>
        </ResourceDetailReleaseSection>
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
