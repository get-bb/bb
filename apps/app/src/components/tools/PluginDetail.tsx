import { useSyncExternalStore } from "react";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import {
  ResourceDetailFact,
  ResourceDetailFacts,
  ResourceListState,
} from "@bb/shared-ui/resource-list";
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
import { PluginDetailView } from "@/components/tools/PluginDetailView";
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

function pluginCanBeRemoved(plugin: PluginListItem): boolean {
  return plugin.provenance !== "builtin";
}

export function pluginRemovalLabel(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin) ? "Remove from bb" : "Uninstall";
}

function PluginsLoadingRows() {
  return <ResourceListState state="loading" message="Loading plugins" />;
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
    return <PluginsLoadingRows />;
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
  const canRemove = pluginCanBeRemoved(plugin);
  const frontendFailure = frontendDiagnostics.get(plugin.id)?.lastFailure;

  return (
    <PluginDetailView
      leading={<PluginLogo plugin={plugin} className="size-4" />}
      title={plugin.name ?? plugin.id}
      description={plugin.description}
      statusAlert={
        frontendFailure !== null && frontendFailure !== undefined ? (
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
        ) : undefined
      }
      metadata={
        <span className="block break-all font-mono">{plugin.rootDir}</span>
      }
      provenance={
        sourceLabel && !canRemove
          ? {
              label: sourceLabel,
              tooltip:
                plugin.provenance === "builtin"
                  ? "Ships with bb"
                  : plugin.sourceDisplay,
              accessibleLabel: `${plugin.name ?? plugin.id}: ${sourceLabel}`,
              icon:
                plugin.provenance === "builtin" ||
                plugin.provenance === "catalog"
                  ? ("PackageReceive" as const)
                  : undefined,
            }
          : undefined
      }
      installed={
        canRemove
          ? {
              accessibleLabel: `Uninstall ${plugin.name ?? plugin.id}`,
              label:
                plugin.provenance === "catalog" ? "BB Official" : undefined,
              icon:
                plugin.provenance === "catalog"
                  ? ("PackageReceive" as const)
                  : undefined,
              appearance:
                plugin.provenance === "catalog"
                  ? ("provenance" as const)
                  : undefined,
              pending,
              onAction: () => onDelete(plugin),
            }
          : undefined
      }
      enabled={plugin.enabled}
      lifecycleDisabled={pending}
      onEnabledChange={() => onToggle(plugin)}
      overflowItems={[
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
      ]}
      definitionSections={[
        {
          label: "Release",
          kind: "release",
          content: (
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
          ),
        },
        ...(hasSettings
          ? [
              {
                label: "Settings",
                kind: "configuration" as const,
                content: <PluginSettingsDetail plugin={plugin} />,
              },
            ]
          : []),
        ...(hasIncludes
          ? [
              {
                label: "Includes",
                kind: "includes" as const,
                content: (
                  <PluginIncludes plugin={plugin} hasSettings={hasSettings} />
                ),
              },
            ]
          : []),
      ]}
      activitySections={
        hasActivity
          ? [
              {
                label: "Runtime activity",
                content: (
                  <PluginActivity
                    plugin={plugin}
                    runtimeStatus={runtimeStatus}
                  />
                ),
              },
            ]
          : []
      }
    />
  );
}
