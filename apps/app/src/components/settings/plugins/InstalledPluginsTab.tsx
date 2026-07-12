import { useState, type KeyboardEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { Switch } from "@bb/shared-ui/switch";
import { appToast } from "@/components/ui/app-toast.js";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  setPluginEnabled,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { getSettingsPluginRoutePath } from "@/lib/route-paths";
import { pluginRowSignal } from "./plugin-update-signals";
import { UpdatePluginDialog } from "./UpdatePluginDialog";
import {
  ATTENTION_TINT_STYLE,
  PluginLogo,
  UPDATE_TINT_STYLE,
} from "./plugin-ui";

/**
 * Layer 1 (sketch v2 A): rows at rest are logo, name, description, switch —
 * no versions, no source strings, no menus. A row earns at most one pill,
 * only when it needs the user: the "Update x.y.z" pill IS the action (opens
 * the confirmation directly), "Needs attention" flags a rollback or load
 * failure. Newer-incompatible and pinned never badge. Hover reveals the
 * chevron; the row navigates to the plugin's detail page where depth lives.
 */
export function InstalledPluginsTab({ plugins }: { plugins: PluginListItem[] }) {
  const [updateTargetId, setUpdateTargetId] = useState<string | null>(null);
  const updateTarget =
    updateTargetId === null
      ? null
      : (plugins.find((plugin) => plugin.id === updateTargetId) ?? null);

  if (plugins.length === 0) {
    return (
      <EmptyState message="No plugins installed. Use “Add plugin”, browse a marketplace, or run bb plugin install <source>." />
    );
  }

  return (
    <>
      <div className="rounded-lg border border-border bg-card px-4 py-1">
        <div className="divide-y divide-border">
          {plugins.map((plugin) => (
            <InstalledPluginRow
              key={plugin.id}
              plugin={plugin}
              onUpdateClick={() => setUpdateTargetId(plugin.id)}
            />
          ))}
        </div>
      </div>
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

  const openDetail = () => navigate(getSettingsPluginRoutePath(plugin.id));
  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail();
    }
  };

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`${plugin.displayName ?? plugin.id} plugin settings`}
      className="group flex cursor-pointer items-center gap-3 py-3 focus-visible:outline-none"
      data-testid={`plugin-row-${plugin.id}`}
      onClick={openDetail}
      onKeyDown={onRowKeyDown}
    >
      <PluginLogo plugin={plugin} className="size-6 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {plugin.displayName ?? plugin.id}
        </p>
        {plugin.description !== null && plugin.description.length > 0 ? (
          <p className="mt-0.5 truncate text-xs leading-snug text-muted-foreground">
            {plugin.description}
          </p>
        ) : null}
      </div>
      {signal?.kind === "update" ? (
        <button
          type="button"
          className="shrink-0 rounded-full border px-2 py-0.5 text-2xs font-medium"
          style={UPDATE_TINT_STYLE}
          data-testid={`plugin-update-pill-${plugin.id}`}
          onClick={(event) => {
            event.stopPropagation();
            onUpdateClick();
          }}
        >
          Update {signal.version}
        </button>
      ) : signal?.kind === "attention" ? (
        <span
          className="pointer-events-none shrink-0 rounded-full border px-2 py-0.5 text-2xs font-medium"
          style={ATTENTION_TINT_STYLE}
          data-testid={`plugin-attention-pill-${plugin.id}`}
        >
          Needs attention
        </span>
      ) : null}
      <span
        className="shrink-0"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Switch
          checked={enabled}
          disabled={toggle.isPending}
          onCheckedChange={(next) => toggle.mutate(next)}
          aria-label={`Enable ${plugin.id}`}
        />
      </span>
      <Icon
        name="ChevronRight"
        className="size-3.5 shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </div>
  );
}
