import { useSyncExternalStore } from "react";
import {
  ResourceActivitySection,
  ResourceDetailConfigurationSection,
  ResourceDetailIncludesSection,
  ResourceDetailOverviewSection,
  ResourceDetailPage,
  ResourceDetailStack,
  ResourceListState,
  ResourceOverflowMenu,
  type ResourceOverflowMenuItem,
} from "@bb/shared-ui/resource-list";
import { Pill } from "@bb/shared-ui/pill";
import { Switch } from "@bb/shared-ui/switch";
import { PluginSettingsDetail } from "@/components/plugin/PluginSettings";
import {
  PluginCompatibilityBanner,
  PluginUpdateBanner,
  pluginHasUpdateSurfaces,
} from "@/components/plugin/management/PluginUpdatesCard";
import {
  formatAbsoluteDate,
  PluginLogo,
} from "@/components/plugin/management/plugin-ui";
import { pluginRuntimeStatusPresentation } from "@/components/plugin/management/plugin-status";
import {
  PluginHealthAlerts,
  PluginIncludes,
  PluginSchedules,
  PluginServices,
} from "@/components/tools/PluginCapabilities";
import { PluginBannerBar } from "@/components/tools/plugin-detail-banner";
import { usePluginSource } from "@/hooks/queries/plugin-catalog-queries";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import {
  getPluginFrontendDiagnostics,
  subscribePluginFrontendDiagnostics,
} from "@/lib/plugin-frontend";
import { usePluginSlots } from "@/lib/plugin-slots";

function pluginSourceLabel(plugin: PluginListItem): string | null {
  if (plugin.provenance === "builtin") return "Built-in";
  if (plugin.provenance === "catalog") return "BB Official";
  if (plugin.source.startsWith("path:")) return null;
  return "Direct install";
}

export function pluginIsLocalSource(plugin: PluginListItem): boolean {
  return plugin.source.startsWith("path:");
}

export function pluginRemovalLabel(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin) ? "Remove from bb" : "Uninstall";
}

/**
 * The plugin page's conditions, as full-width bars above the page itself.
 *
 * These render outside ToolsScrollPage rather than inside the detail column:
 * a frontend crash, a blocked update, or a dead runtime is a condition on the
 * whole page, and inset into the centered column it read as just another
 * content block halfway down.
 */
export function PluginDetailBanners({ plugin }: { plugin: PluginListItem }) {
  const frontendDiagnostics = useSyncExternalStore(
    subscribePluginFrontendDiagnostics,
    getPluginFrontendDiagnostics,
    getPluginFrontendDiagnostics,
  );
  const frontendFailure = frontendDiagnostics.get(plugin.id)?.lastFailure;
  const hasUpdateManagement = pluginHasUpdateSurfaces(plugin);
  return (
    <>
      {frontendFailure === null || frontendFailure === undefined ? null : (
        <PluginBannerBar
          tone="destructive"
          icon="CircleX"
          title={`Frontend ${frontendFailure.phase} failure${
            frontendFailure.scriptId === null
              ? ""
              : ` in content script \u201C${frontendFailure.scriptId}\u201D`
          }`}
          detail={frontendFailure.message}
        />
      )}
      {hasUpdateManagement ? (
        <PluginCompatibilityBanner plugin={plugin} />
      ) : null}
      {hasUpdateManagement ? <PluginUpdateBanner plugin={plugin} /> : null}
      <PluginHealthAlerts
        plugin={plugin}
        runtimeStatus={pluginRuntimeStatusPresentation(plugin)}
      />
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
  const sourceLabel = pluginSourceLabel(plugin);
  const canEditSource = pluginIsLocalSource(plugin);
  const canRemove = plugin.provenance !== "builtin";
  // Only update-managed plugins have an install record; a built-in ships with
  // bb and a path install is whatever is on disk right now.
  const installedAt = hasUpdateManagement
    ? (sourceQuery.data?.installedAt ?? null)
    : null;

  const pluginName = plugin.name ?? plugin.id;
  const provenanceLabel =
    plugin.provenance === "catalog" ? "BB Official" : sourceLabel;
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
      // passive pill. It used to render as a green "Installed"/"BB Official"
      // button that swapped to a red Uninstall on hover — a status that
      // deleted on click, at the same weight as the enable toggle.
      titleMeta={
        provenanceLabel ? (
          <Pill variant="outline" size="sm">
            {provenanceLabel}
          </Pill>
        ) : undefined
      }
      // Version and install date are identity, so they sit with the identity.
      // They had been a two-row bordered table inside About, carrying the same
      // weight as Capabilities and the health tables for two trivial facts, and
      // floated hard right with a void between them and the description.
      metadata={
        <>
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="font-mono">{plugin.version}</span>
            <span aria-hidden>·</span>
            {installedAt === null ? (
              <span>Updates with bb</span>
            ) : (
              <span>Installed {formatAbsoluteDate(installedAt)}</span>
            )}
          </span>
          <span className="mt-0.5 block break-all font-mono">
            {plugin.rootDir}
          </span>
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
        overflowItems.length > 0 ? (
          <ResourceOverflowMenu
            label={`${pluginName} actions`}
            items={overflowItems}
          />
        ) : undefined
      }
    >
      <ResourceDetailStack>
        {/*
          About is prose, nothing else. Release used to be a second headed
          section, then a fact table beside this paragraph; both gave a rank-1
          surface to two facts and out-competed Capabilities, which is what the
          page is for. The facts now sit in the header, with the identity.
        */}
        <ResourceDetailOverviewSection label="About">
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {plugin.description ?? "This plugin does not describe itself."}
          </p>
        </ResourceDetailOverviewSection>
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
          status vocabularies, so they are two tables under their own names. The
          "Health" wrapper that used to hold them added a heading level without
          adding a fact.
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
