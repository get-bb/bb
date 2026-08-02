import { useState, useSyncExternalStore } from "react";
import {
  ResourceActivitySection,
  ResourceDetailConfigurationSection,
  ResourceDetailIncludesSection,
  ResourceDetailOverviewSection,
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
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { PluginSettingsDetail } from "@/components/plugin/PluginSettings";
import {
  PluginDetailReleaseControl,
  PluginDetailReleaseStatus,
  pluginHasUpdateSurfaces,
} from "@/components/plugin/management/PluginUpdatesCard";
import {
  formatAbsoluteDate,
  PluginLogo,
} from "@/components/plugin/management/plugin-ui";
import { pluginRuntimeStatusPresentation } from "@/components/plugin/management/plugin-status";
import {
  PluginHealthBanner,
  PluginIncludes,
  PluginSchedules,
  PluginServices,
} from "@/components/tools/PluginCapabilities";
import {
  PluginDetailFieldRow,
  PluginDetailTable,
} from "@/components/tools/plugin-detail-table";
import { PluginBannerBar } from "@/components/tools/plugin-detail-banner";
import { ProvenancePill } from "@/components/tools/ProvenancePill";
import { appToast } from "@/components/ui/app-toast";
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

function pluginSourceLabel(plugin: PluginListItem): string | null {
  return plugin.provenance === "builtin" || plugin.provenance === "catalog"
    ? "BB Official"
    : null;
}

/** Passive provenance shown beside an installed plugin's name. */
export function PluginProvenancePill({ plugin }: { plugin: PluginListItem }) {
  const label = pluginSourceLabel(plugin);
  return label === null ? null : <ProvenancePill label={label} />;
}

export function pluginIsLocalSource(plugin: PluginListItem): boolean {
  return plugin.source.startsWith("path:");
}

export function pluginRemovalLabel(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin) ? "Remove from bb" : "Uninstall";
}

function PluginPath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      appToast.error("Failed to copy path.");
    }
  }

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Copy plugin path: ${path}`}
            onClick={copyPath}
            className="group -ml-1.5 mt-0.5 inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="min-w-0 truncate text-left font-mono">
              {formatHomePathForDisplay(path)}
            </span>
            <Icon
              name={copied ? "Check" : "Copy"}
              className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-hidden
            />
          </button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied" : "Copy path"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Read-only detail for an uninstalled BB Official catalog entry.
 *
 * The catalog exposes identity, category, description, and compatibility. It
 * cannot enumerate runtime capabilities until the plugin is installed and
 * running, so this page does not fabricate an installed-plugin inventory.
 */
export function CatalogPluginDetail({
  entry,
  onInstall,
}: {
  entry: PluginCatalogSearchEntry;
  onInstall: (entry: PluginCatalogSearchEntry) => void;
}) {
  return (
    <ResourceDetailPage
      maxWidthClassName="max-w-5xl"
      leading={
        <PluginIcon
          pluginId={entry.pluginId}
          icon={entry.icon}
          className="size-full"
        />
      }
      title={entry.displayName}
      titleMeta={<ProvenancePill label="BB Official" />}
      metadata={<span>{entry.category}</span>}
      actions={
        <ResourceInstallControl
          accessibleLabel={`Install ${entry.displayName}`}
          disabled={!entry.compatible}
          onAction={() => onInstall(entry)}
        />
      }
    >
      <ResourceDetailStack>
        <ResourceDetailOverviewSection label="About">
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {entry.description.length > 0
              ? entry.description
              : "This plugin does not describe itself."}
          </p>
        </ResourceDetailOverviewSection>
      </ResourceDetailStack>
    </ResourceDetailPage>
  );
}

/** Acquisition compatibility shown in the same page-level notice system. */
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

/**
 * The installed plugin page's highest-priority runtime condition.
 *
 * These render outside ToolsScrollPage rather than inside the detail column.
 * Only present-tense operational health belongs in this selector; acquisition
 * compatibility uses CatalogPluginDetailBanner, while release opportunities
 * and history stay with the version controls in the detail page.
 */
export type PluginDetailBannerKind =
  | "failed"
  | "degraded"
  | "incompatible"
  | "missing"
  | "needs-configuration";

export function pluginDetailBannerKind(
  plugin: PluginListItem,
  hasFrontendFailure: boolean,
): PluginDetailBannerKind | null {
  if (!plugin.enabled) return null;
  if (plugin.status === "error") return "failed";
  if (plugin.status === "degraded") return "degraded";
  if (plugin.status === "incompatible") return "incompatible";
  if (plugin.status === "missing") return "missing";
  if (plugin.status === "needs-configuration") return "needs-configuration";
  if (hasFrontendFailure) return "failed";
  return null;
}

function pluginHealthBannerState(
  plugin: PluginListItem,
  frontendDiagnostic: PluginFrontendDiagnostic | undefined,
): { plugin: PluginListItem; reloadable?: boolean } | null {
  if (!plugin.enabled) return null;
  if (pluginRuntimeStatusPresentation(plugin) !== null) return { plugin };

  // An active generation can retain a disposer failure from the generation it
  // replaced. That cleanup diagnostic does not mean the current frontend
  // failed to start, so only a presently failed frontend earns this banner.
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

export function PluginDetailBanners({ plugin }: { plugin: PluginListItem }) {
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
      reloadable={banner.reloadable}
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
}: {
  isLoading: boolean;
  plugin: PluginListItem | null;
  pending: boolean;
  openSourceDisabled: boolean;
  onToggle: (plugin: PluginListItem) => void;
  onEdit: (plugin: PluginListItem) => void;
  onOpenSource: (plugin: PluginListItem) => void;
  onDelete: (plugin: PluginListItem) => void;
}) {
  const { settingsSections } = usePluginSlots();
  // Hooks run before the loading and not-found returns below, so this has to
  // tolerate a null plugin rather than read `plugin.id` unconditionally.
  const sourceQuery = usePluginSource(plugin?.id ?? "", {
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

  const hasSettings =
    plugin.hasSettings ||
    settingsSections.some((section) => section.pluginId === plugin.id);
  const hasUpdateManagement = pluginHasUpdateSurfaces(plugin);
  const canEditSource = pluginIsLocalSource(plugin);
  const canRemove = plugin.provenance !== "builtin";
  // Delivery policy comes from the source itself. Source detail is auxiliary:
  // a missing or still-loading install date must never make a managed plugin
  // look as though it ships with bb.
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

  const pluginName = plugin.name ?? plugin.id;
  // Uninstall is destructive and irreversible-ish, so it belongs with the other
  // ownership actions rather than beside the reversible enable toggle.
  const overflowItems: ResourceOverflowMenuItem[] = [
    ...(canEditSource
      ? [
          {
            label: "Edit",
            icon: "Edit" as const,
            disabled: pending,
            onSelect: () => onEdit(plugin),
          },
          {
            label: "Open source",
            icon: "ExternalLink" as const,
            disabled: pending || openSourceDisabled,
            disabledReason: openSourceDisabled
              ? "No editor configured"
              : undefined,
            onSelect: () => onOpenSource(plugin),
          },
        ]
      : []),
    ...(canRemove
      ? [
          {
            label: pluginRemovalLabel(plugin),
            icon: "Trash2" as const,
            tone: "destructive" as const,
            disabled: pending,
            onSelect: () => onDelete(plugin),
          },
        ]
      : []),
  ];
  return (
    <ResourceDetailPage
      maxWidthClassName="max-w-5xl"
      leading={<PluginLogo plugin={plugin} className="size-4" />}
      title={pluginName}
      // Provenance is a label, not a control: it sits flush to the name as a
      // passive badge. Default owned sources need no label; only BB-published
      // plugins carry provenance here. It used to render as a green
      // "Installed"/"BB Official"
      // button that swapped to a red Uninstall on hover — a status that
      // deleted on click, at the same weight as the enable toggle.
      titleMeta={<PluginProvenancePill plugin={plugin} />}
      metadata={<PluginPath path={plugin.rootDir} />}
      lifecycleControl={
        <Switch
          checked={plugin.enabled}
          disabled={pending}
          aria-label={`${plugin.enabled ? "Disable" : "Enable"} ${pluginName}`}
          onCheckedChange={() => onToggle(plugin)}
        />
      }
      overflowMenu={
        overflowItems.length > 0 ? (
          <ResourceOverflowMenu
            label={`${pluginName} actions`}
            items={overflowItems}
          />
        ) : undefined
      }
    >
      <ResourceDetailStack>
        <ResourceDetailOverviewSection label="About">
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {plugin.description ?? "This plugin does not describe itself."}
          </p>
        </ResourceDetailOverviewSection>
        <ResourceDetailReleaseSection
          label="Release"
          actions={
            hasReleaseControl ? (
              <PluginDetailReleaseControl plugin={plugin} />
            ) : undefined
          }
        >
          <PluginDetailTable compactLabelColumn>
            <PluginDetailFieldRow
              label={updatesWithBb ? "Delivery" : "Installed"}
            >
              {installedValue}
            </PluginDetailFieldRow>
            <PluginDetailFieldRow label="Version">
              <span className="font-mono text-xs">{plugin.version}</span>
            </PluginDetailFieldRow>
            {hasReleaseUpdate ? (
              <PluginDetailFieldRow
                label="Update"
                stackOnNarrow
                compactLabelColumn
              >
                <PluginDetailReleaseStatus plugin={plugin} />
              </PluginDetailFieldRow>
            ) : null}
          </PluginDetailTable>
        </ResourceDetailReleaseSection>
        <ResourceDetailIncludesSection label="Capabilities">
          <PluginIncludes plugin={plugin} hasSettings={hasSettings} />
        </ResourceDetailIncludesSection>
        {hasSettings ? (
          <ResourceDetailConfigurationSection label="Settings">
            <PluginSettingsDetail plugin={plugin} />
          </ResourceDetailConfigurationSection>
        ) : null}
        {/*
          Services and schedules are two different objects with two different
          status vocabularies, so they stay under their own names and use
          separate semantic tables. Services expose name and status; schedules
          expose name plus next-run or failure detail. The "Health" wrapper
          that used to hold them added a heading level without adding a fact.
        */}
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
      </ResourceDetailStack>
    </ResourceDetailPage>
  );
}
