import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Switch } from "@bb/shared-ui/switch";
import {
  ResourceListPanel,
  ResourceRow,
  ResourceRowDetailChevron,
} from "@bb/shared-ui/resource-list";
import { ProvenancePill } from "@/components/tools/ProvenancePill";
import { appToast } from "@/components/ui/app-toast.js";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  setPluginEnabled,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { getPluginDetailRoutePath } from "@/lib/route-paths";
import { pluginRowSignal } from "./plugin-status";
import { PluginRowSignalView, PluginSignalLogo } from "./PluginRowSignal";
import { UpdatePluginDialog } from "./UpdatePluginDialog";
import { PluginLogo } from "./plugin-ui";

/**
 * Layer 1 (sketch v2 A): rows at rest are logo, name, description, switch —
 * no versions, no source strings, no menus. A row earns at most one signal:
 * the "Update x.y.z" pill IS the action (opens the confirmation directly),
 * while abnormal runtime health is an icon action that opens plugin details.
 * Newer-incompatible and pinned never badge. Hover reveals the chevron; the
 * row navigates to the plugin's detail page where depth lives.
 */
export function InstalledPluginsTab({
  plugins,
}: {
  plugins: readonly PluginListItem[];
}) {
  const [updateTargetId, setUpdateTargetId] = useState<string | null>(null);
  const updateTarget =
    updateTargetId === null
      ? null
      : (plugins.find((plugin) => plugin.id === updateTargetId) ?? null);

  if (plugins.length === 0) {
    return (
      <EmptyState message="No plugins installed. Browse the catalog, create a plugin, or run bb plugin install <source>." />
    );
  }

  return (
    <>
      <ResourceListPanel>
        <div className="divide-y divide-border">
          {plugins.map((plugin) => (
            <InstalledPluginRow
              key={plugin.id}
              plugin={plugin}
              onUpdateClick={() => setUpdateTargetId(plugin.id)}
            />
          ))}
        </div>
      </ResourceListPanel>
      {updateTarget !== null ? (
        <UpdatePluginDialog
          plugin={updateTarget}
          open
          onOpenChange={(open) => {
            if (!open) setUpdateTargetId(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Exported for tests (pill states + enable/disable round-trip). */
export function InstalledPluginRow({
  plugin,
  onUpdateClick,
}: {
  plugin: PluginListItem;
  onUpdateClick: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      setPluginEnabled(fetch, plugin.id, enabled),
    onError: (error, enabled) => {
      appToast.error(
        `${enabled ? "Enabling" : "Disabling"} ${plugin.id} failed`,
        {
          description: error instanceof Error ? error.message : String(error),
        },
      );
    },
    onSettled: () => invalidatePluginList({ queryClient }),
  });
  // Reflect the in-flight target immediately; the invalidated list settles it.
  const enabled = toggle.isPending ? toggle.variables : plugin.enabled;
  const signal = pluginRowSignal(plugin);
  const statusSignal = signal?.kind === "status" ? signal : null;
  const updateSignal = signal?.kind === "update" ? signal : null;

  const openDetail = () =>
    navigate(
      getPluginDetailRoutePath({ pluginId: plugin.id, view: "installed" }),
    );
  return (
    <div data-testid={`plugin-row-${plugin.id}`}>
      <ResourceRow
        leading={
          <PluginSignalLogo signal={statusSignal} onStatusClick={openDetail}>
            <PluginLogo plugin={plugin} className="size-6 shrink-0" />
          </PluginSignalLogo>
        }
        title={plugin.name ?? plugin.id}
        titleMeta={
          plugin.publisherLabel === null ? undefined : (
            <ProvenancePill label={plugin.publisherLabel} />
          )
        }
        description={plugin.description}
        openLabel={`${plugin.name ?? plugin.id} plugin details`}
        onOpen={openDetail}
        trailingMeta={
          updateSignal !== null ? (
            <span data-testid={`plugin-update-signal-${plugin.id}`}>
              <PluginRowSignalView
                signal={updateSignal}
                onUpdateClick={onUpdateClick}
                onStatusClick={openDetail}
              />
            </span>
          ) : undefined
        }
        persistentActions={
          <Switch
            checked={enabled}
            disabled={toggle.isPending}
            onCheckedChange={(next) => toggle.mutate(next)}
            aria-label={`${enabled ? "Disable" : "Enable"} ${plugin.id}`}
          />
        }
        trailingVisual={<ResourceRowDetailChevron />}
      />
    </div>
  );
}
