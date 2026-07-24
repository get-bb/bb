import { useSyncExternalStore } from "react";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import {
  ResourceActivitySection,
  ResourceDetailConfigurationSection,
  ResourceDetailFact,
  ResourceDetailFacts,
  ResourceDetailIncludesSection,
  ResourceDetailOverviewSection,
  ResourceDetailPage,
  ResourceDetailReleaseSection,
  ResourceDetailStack,
  ResourceInstalledControl,
  ResourceLifecycleStatus,
  ResourceListState,
  ResourceOverflowMenu,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";
import { PluginSettingsDetail } from "@/components/plugin/PluginSettings";
import {
  PluginReleaseFacts,
  PluginUpdateBanner,
  pluginHasUpdateSurfaces,
} from "@/components/plugin/management/PluginUpdatesCard";
import { PluginLogo } from "@/components/plugin/management/plugin-ui";
import { pluginRuntimeStatusPresentation } from "@/components/plugin/management/plugin-status";
import {
  PluginActivity,
  PluginIncludes,
} from "@/components/tools/PluginCapabilities";
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
  const frontendDiagnostics = useSyncExternalStore(
    subscribePluginFrontendDiagnostics,
    getPluginFrontendDiagnostics,
    getPluginFrontendDiagnostics,
  );
  if (isLoading) {
    return <ResourceListState state="loading" message="Loading plugins" />;
  }

  if (plugin === null) {
    return (
      <EmptyStatePanel className="py-6">Plugin not found.</EmptyStatePanel>
    );
  }

  const hasSettings =
    plugin.hasSettings ||
    settingsSections.some((section) => section.pluginId === plugin.id);
  const hasUpdateManagement = pluginHasUpdateSurfaces(plugin);
  const runtimeStatus = pluginRuntimeStatusPresentation(plugin);
  const sourceLabel = pluginSourceLabel(plugin);
  const hasIncludes =
    plugin.app.hasApp ||
    plugin.cliCommand !== null ||
    hasSettings ||
    plugin.services.length > 0 ||
    plugin.schedules.length > 0;
  const hasActivity =
    (plugin.enabled && runtimeStatus !== null) ||
    plugin.handlerStats.errorCount > 0 ||
    plugin.services.length > 0 ||
    plugin.schedules.length > 0;
  const canEditSource = pluginIsLocalSource(plugin);
  const canRemove = plugin.provenance !== "builtin";
  const frontendFailure = frontendDiagnostics.get(plugin.id)?.lastFailure;

  const pluginName = plugin.name ?? plugin.id;
  return (
    <ResourceDetailPage
      leading={<PluginLogo plugin={plugin} className="size-4" />}
      title={pluginName}
      metadata={
        <span className="block break-all font-mono">{plugin.rootDir}</span>
      }
      lifecycleControl={
        <div className="flex items-center gap-2">
          {canRemove ? (
            <ResourceInstalledControl
              accessibleLabel={`Uninstall ${pluginName}`}
              label={
                plugin.provenance === "catalog" ? "BB Official" : undefined
              }
              icon={
                plugin.provenance === "catalog" ? "PackageReceive" : undefined
              }
              appearance={
                plugin.provenance === "catalog" ? "provenance" : undefined
              }
              pending={pending}
              onAction={() => onDelete(plugin)}
            />
          ) : sourceLabel ? (
            <ResourceLifecycleStatus
              label={sourceLabel}
              tooltip={
                plugin.provenance === "builtin"
                  ? "Ships with bb"
                  : plugin.sourceDisplay
              }
              accessibleLabel={`${pluginName}: ${sourceLabel}`}
              icon={
                plugin.provenance === "builtin" ||
                plugin.provenance === "catalog"
                  ? "PackageReceive"
                  : undefined
              }
            />
          ) : null}
          <Switch
            checked={plugin.enabled}
            disabled={pending}
            aria-label={`${plugin.enabled ? "Disable" : "Enable"} ${pluginName}`}
            onCheckedChange={() => onToggle(plugin)}
          />
        </div>
      }
      overflowMenu={
        canEditSource ? (
          <ResourceOverflowMenu
            label={`${pluginName} actions`}
            items={[
              {
                label: "Edit",
                icon: "Edit",
                disabled: pending,
                onSelect: () => onEdit(plugin),
              },
              {
                label: "Open source",
                icon: "ExternalLink",
                disabled: pending || openSourceDisabled,
                disabledReason: openSourceDisabled
                  ? "No editor configured"
                  : undefined,
                onSelect: () => onOpenSource(plugin),
              },
            ]}
          />
        ) : undefined
      }
    >
      <ResourceDetailStack>
        {frontendFailure !== null && frontendFailure !== undefined ? (
          <div
            className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive"
            role="alert"
          >
            Frontend {frontendFailure.phase} failure
            {frontendFailure.scriptId === null
              ? ""
              : ` in content script “${frontendFailure.scriptId}”`}
            : {frontendFailure.message}
          </div>
        ) : null}
        {plugin.description ? (
          <ResourceDetailOverviewSection label="About">
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              {plugin.description}
            </p>
          </ResourceDetailOverviewSection>
        ) : null}
        <ResourceDetailReleaseSection label="Release">
          <div className="space-y-3">
            {hasUpdateManagement ? (
              <PluginUpdateBanner plugin={plugin} />
            ) : null}
            {hasUpdateManagement ? (
              <PluginReleaseFacts
                plugin={plugin}
                embedded
                releaseVersion={plugin.version}
              />
            ) : (
              <ResourceDetailFacts>
                <ResourceDetailFact label="Current version" mono>
                  {plugin.version}
                </ResourceDetailFact>
                <ResourceDetailFact label="Updates">
                  Included with bb releases
                </ResourceDetailFact>
              </ResourceDetailFacts>
            )}
          </div>
        </ResourceDetailReleaseSection>
        {hasSettings ? (
          <ResourceDetailConfigurationSection label="Settings">
            <PluginSettingsDetail plugin={plugin} />
          </ResourceDetailConfigurationSection>
        ) : null}
        {hasIncludes ? (
          <ResourceDetailIncludesSection label="Includes">
            <PluginIncludes plugin={plugin} hasSettings={hasSettings} />
          </ResourceDetailIncludesSection>
        ) : null}
        {hasActivity ? (
          <ResourceActivitySection label="Runtime activity">
            <PluginActivity plugin={plugin} runtimeStatus={runtimeStatus} />
          </ResourceActivitySection>
        ) : null}
      </ResourceDetailStack>
    </ResourceDetailPage>
  );
}
