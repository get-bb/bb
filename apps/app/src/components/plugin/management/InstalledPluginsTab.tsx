import { useSetPluginEnabled } from "@/components/plugin/useSetPluginEnabled";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Switch } from "@bb/shared-ui/switch";
import {
  ResourceBrowseGrid,
  ResourceIconFrame,
} from "@bb/shared-ui/resource-list";
import { appToast } from "@/components/ui/app-toast.js";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import { pluginNeedsAttention } from "@/hooks/usePluginAttention";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  getPluginDetailRoutePath,
  isPluginsRoutePath,
} from "@/lib/route-paths";
import {
  pluginRowSignal,
  pluginRuntimeStatusPresentation,
} from "./plugin-status";
import { PluginRowSignalView, PluginSignalLogo } from "./PluginRowSignal";
import { PluginCard, PluginCardAuthor, PluginAuthorByline } from "./PluginCard";
import { installedPluginCatalogEntry } from "./installed-plugin-catalog";
import {
  usePluginCatalogSearch,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import { UpdatePluginDialog } from "./UpdatePluginDialog";
import { PluginLogo, PluginCategoryLabel } from "./plugin-ui";

export function InstalledPluginsTab({
  plugins,
}: {
  plugins: readonly PluginListItem[];
}) {
  const catalogQuery = usePluginCatalogSearch("", { enabled: true });
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
      <ResourceBrowseGrid className="w-full grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2">
        {plugins.map((plugin) => (
          <InstalledPluginRow
            key={plugin.id}
            plugin={plugin}
            catalogEntry={installedPluginCatalogEntry(
              plugin,
              catalogQuery.data?.entries ?? [],
            )}
            onUpdateClick={() => setUpdateTargetId(plugin.id)}
          />
        ))}
      </ResourceBrowseGrid>
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

export function InstalledPluginRow({
  plugin,
  onUpdateClick,
  catalogEntry,
}: {
  plugin: PluginListItem;
  catalogEntry?: PluginCatalogSearchEntry;
  onUpdateClick: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const setEnabled = useSetPluginEnabled();
  const toggle = useMutation({
    meta: { showErrorToast: false },
    mutationFn: (enabled: boolean) => setEnabled(plugin.id, enabled),
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
  const enabled = toggle.isPending ? toggle.variables : plugin.enabled;
  const signal = pluginRowSignal(plugin);
  const statusSignal = signal?.kind === "status" ? signal : null;
  const updateSignal = signal?.kind === "update" ? signal : null;
  const runtimeStatus = pluginRuntimeStatusPresentation(plugin);
  const notRunning = pluginNeedsAttention({
    enabled: enabled === true,
    status: plugin.status,
  });
  const runtimeStatusToneClass =
    runtimeStatus?.tone === "error"
      ? "text-destructive-text"
      : runtimeStatus?.tone === "warning"
        ? "text-warning-text"
        : "text-muted-foreground";

  const openDetail = () =>
    navigate(
      isPluginsRoutePath(location.pathname)
        ? `${getPluginDetailRoutePath({ pluginId: plugin.id })}?view=installed`
        : getPluginDetailRoutePath({ pluginId: plugin.id, view: "installed" }),
    );
  return (
    <div data-testid={`plugin-row-${plugin.id}`}>
      <PluginCard
        leading={
          <PluginSignalLogo signal={statusSignal} onStatusClick={openDetail}>
            <ResourceIconFrame className="size-6 rounded border border-border bg-muted/40 text-muted-foreground">
              {() => <PluginLogo plugin={plugin} className="size-4" />}
            </ResourceIconFrame>
          </PluginSignalLogo>
        }
        title={plugin.name ?? plugin.id}
        byline={
          plugin.source.startsWith("path:") ? (
            <span className="font-mono text-2xs" title={plugin.source.slice(5)}>
              {plugin.sourceDisplay}
            </span>
          ) : catalogEntry !== undefined ? (
            <PluginCardAuthor entry={catalogEntry} />
          ) : plugin.publisherLabel !== null ? (
            <PluginAuthorByline
              name={
                plugin.provenance === "builtin"
                  ? "BB Official"
                  : plugin.publisherLabel
              }
              github={null}
              official={plugin.provenance === "builtin"}
            >
              {plugin.provenance === "builtin"
                ? "BB Official"
                : plugin.publisherLabel}
            </PluginAuthorByline>
          ) : null
        }
        footerMeta={
          (catalogEntry?.category ?? plugin.category) !== undefined ? (
            <PluginCategoryLabel
              categoryId={catalogEntry?.categoryId ?? plugin.categoryId}
              label={catalogEntry?.category ?? plugin.category ?? ""}
            />
          ) : null
        }
        description={
          runtimeStatus === null ? (
            plugin.description
          ) : (
            <span>
              <span
                data-testid={`plugin-runtime-status-${plugin.id}`}
                className={cn("font-medium", runtimeStatusToneClass)}
              >
                {runtimeStatus.label}
              </span>
              {" · "}
              <span>{plugin.statusDetail ?? runtimeStatus.condition}</span>
            </span>
          )
        }
        openLabel={`${plugin.name ?? plugin.id} plugin details`}
        onOpen={openDetail}
        headerAction={
          <span className="flex items-center gap-2">
            {updateSignal !== null ? (
              <span data-testid={`plugin-update-signal-${plugin.id}`}>
                <PluginRowSignalView
                  signal={updateSignal}
                  onUpdateClick={onUpdateClick}
                  onStatusClick={openDetail}
                />
              </span>
            ) : undefined}
            {notRunning ? (
              <span
                data-testid={`plugin-not-running-${plugin.id}`}
                className={cn("sr-only", runtimeStatusToneClass)}
              >
                not running
              </span>
            ) : null}
            <Switch
              checked={enabled}
              disabled={toggle.isPending}
              onCheckedChange={(next) => toggle.mutate(next)}
              aria-label={`${enabled ? "Disable" : "Enable"} ${plugin.id}${
                notRunning ? ` (${plugin.status}, not running)` : ""
              }`}
            />
          </span>
        }
      />
    </div>
  );
}
