import { useSyncExternalStore } from "react";
import {
  ResourceActivitySection,
  ResourceDetailConfigurationSection,
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
import { Link } from "react-router-dom";
import { getPluginConfigurationRoutePath } from "@/lib/route-paths";
import { CheckPluginUpdatesButton } from "@/components/plugin/management/CheckPluginUpdatesButton";
import {
  PluginDetailReleaseControl,
  PluginDetailReleaseStatus,
  pluginHasUpdateSurfaces,
} from "@/components/plugin/management/PluginUpdatesCard";
import {
  CatalogEntryIcon,
  formatAbsoluteDate,
  PluginLogo,
} from "@/components/plugin/management/plugin-ui";
import { pluginRuntimeStatusPresentation } from "@/components/plugin/management/plugin-status";
import { ExperimentalUrlLink } from "@/components/plugin/ExperimentalUrlLink";
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

/**
 * Passive publisher shown beside an installed plugin's name: `BB Official` for
 * a plugin bundled with the app, the listing marketplace's display name for a
 * catalog install. A plugin the user added from a source wears no pill —
 * naming a publisher there would be a trust signal bb cannot back.
 */
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

function PluginPath({ path }: { path: string }) {
  const { copied, copy } = useClipboardCopy({
    text: path,
    errorMessage: "Failed to copy path.",
  });

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Copy plugin path: ${path}`}
            onClick={() => void copy()}
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
 * The repository link's text: the URL without its scheme, so a GitHub entry
 * reads as `github.com/owner/repo` and a reader knows the destination.
 */
export function repositoryLinkLabel(url: string): string {
  return url.replace(/^https?:\/\//u, "").replace(/\/+$/u, "");
}

/**
 * Read-only detail for an uninstalled catalog entry.
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
      leading={<CatalogEntryIcon entry={entry} className="size-full" />}
      title={entry.displayName}
      titleMeta={<ProvenancePill label={entry.publisherLabel} />}
      metadata={
        <>
          <span>{entry.category}</span>
          {entry.author === null ? null : (
            <span>
              {" · By: "}
              {entry.author.url === null ? (
                entry.author.name
              ) : (
                <ExperimentalUrlLink
                  href={entry.author.url}
                  className="underline underline-offset-2"
                >
                  {entry.author.name}
                </ExperimentalUrlLink>
              )}
            </span>
          )}
          {entry.repositoryUrl === null ? null : (
            <span>
              {" · "}
              <a
                href={entry.repositoryUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                {repositoryLinkLabel(entry.repositoryUrl)}
              </a>
            </span>
          )}
        </>
      }
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
          <p className="max-w-none text-sm leading-relaxed text-muted-foreground">
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

  const hasUpdateManagement = pluginHasUpdateSurfaces(plugin);
  const canEditSource = pluginIsLocalSource(plugin);
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
  const hasConfiguration =
    plugin.hasSettings ||
    settingsSections.some((section) => section.pluginId === plugin.id);

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
          <p className="max-w-none text-sm leading-relaxed text-muted-foreground">
            {plugin.description ?? "This plugin does not describe itself."}
          </p>
        </ResourceDetailOverviewSection>
        {hasConfiguration ? (
          <ResourceDetailConfigurationSection
            id="configuration"
            className="scroll-mt-4"
            label="Configuration"
          >
            {/* Configuration lives on the Settings page; the detail page
                only points there so one surface owns the form. */}
            <p className="max-w-none text-sm leading-relaxed text-muted-foreground">
              This plugin is configured from{" "}
              <Link
                to={getPluginConfigurationRoutePath({ pluginId: plugin.id })}
                className="inline-flex items-center gap-0.5 rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                its Settings page
                <Icon
                  name="ChevronRight"
                  className="size-3.5 no-underline"
                  aria-hidden
                />
              </Link>
            </p>
          </ResourceDetailConfigurationSection>
        ) : null}
        <ResourceDetailReleaseSection
          label="Release"
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
          <PluginDetailTable>
            <PluginDetailFieldRow
              label={updatesWithBb ? "Delivery" : "Installed"}
              labelClassName="font-medium"
            >
              {installedValue}
            </PluginDetailFieldRow>
            <PluginDetailFieldRow label="Version" labelClassName="font-medium">
              <span className="font-mono text-xs">{plugin.version}</span>
            </PluginDetailFieldRow>
            {hasReleaseUpdate ? (
              <PluginDetailFieldRow label="Update" stackOnNarrow>
                <PluginDetailReleaseStatus plugin={plugin} />
              </PluginDetailFieldRow>
            ) : null}
          </PluginDetailTable>
        </ResourceDetailReleaseSection>
        <PluginIncludes plugin={plugin} />
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
