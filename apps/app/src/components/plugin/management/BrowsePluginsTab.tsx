import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import {
  RESOURCE_GRID_PAGE_SIZE,
  ResourcePagination,
  useResourcePagination,
} from "@bb/shared-ui/resource-pagination";
import {
  ResourceCollectionViewport,
  ResourceInstallControl,
  ResourceInstalledControl,
} from "@bb/shared-ui/resource-list";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import { appToast } from "@/components/ui/app-toast";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import {
  invalidatePluginCatalogSearch,
  invalidatePluginList,
} from "@/hooks/cache-owners/plugin-cache-owner";
import {
  usePluginCatalogSearch,
  usePluginCatalogStatus,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import { removePlugin } from "@/hooks/queries/plugin-settings-queries";
import type { AddPluginInitial } from "./AddPluginDialog";
import { PlaceholderBadge } from "./plugin-ui";

/** Browse BB's official plugins, bundled with the app. */
export function BrowsePluginsTab({
  onInstall,
  onOpenInstalled,
}: {
  onInstall: (initial: AddPluginInitial) => void;
  onOpenInstalled: (pluginId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounceValue(query.trim(), 300);
  const statusQuery = usePluginCatalogStatus({ enabled: true });
  const searchQuery = usePluginCatalogSearch(debouncedQuery, { enabled: true });
  const status = statusQuery.data;
  const entries = searchQuery.data ?? [];
  const pagination = useResourcePagination(entries, {
    pageSize: RESOURCE_GRID_PAGE_SIZE,
    resetKey: debouncedQuery.toLowerCase(),
  });

  const byCategory = new Map<string, PluginCatalogSearchEntry[]>();
  for (const entry of pagination.items) {
    const bucket = byCategory.get(entry.category);
    if (bucket === undefined) byCategory.set(entry.category, [entry]);
    else bucket.push(entry);
  }

  return (
    <ResourceCollectionViewport
      scrollId="plugins-browse-results"
      contentClassName="space-y-4"
      toolbar={
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card px-3.5 py-3">
            <p className="text-sm font-medium text-foreground">
              BB Official plugins
            </p>
            {status === undefined ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {statusQuery.isPending
                  ? "Loading plugins…"
                  : "Plugin list unavailable."}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {status.pluginCount} plugin
                {status.pluginCount === 1 ? "" : "s"} · bundled with BB and
                installed with one click
              </p>
            )}
          </div>

          <div className="relative min-w-48">
            <Icon
              name="Search"
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground"
            />
            <Input
              value={query}
              placeholder="Search plugins…"
              aria-label="Search plugins"
              className="h-8 pl-8 text-xs"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
      }
      footer={
        pagination.total > pagination.pageSize ? (
          <ResourcePagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            visibleCount={pagination.visibleCount}
            onPageChange={pagination.setPage}
            scrollTargetId="plugins-browse-results"
          />
        ) : undefined
      }
    >
      {searchQuery.isError && entries.length > 0 ? (
        <p className="text-xs text-warning-text" role="status">
          Showing cached catalog results because the latest search failed.
        </p>
      ) : null}

      {searchQuery.isPending ? (
        <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
          <Icon name="Spinner" className="size-3.5 animate-spin" />
          Searching catalog…
        </p>
      ) : entries.length === 0 ? (
        <EmptyState
          message={
            searchQuery.isError
              ? "BB's official plugins are unavailable."
              : "No plugins match this search."
          }
        />
      ) : (
        <div className="space-y-4">
          {[...byCategory.entries()].map(([category, categoryEntries]) => (
            <div key={category}>
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                {category}
              </h3>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,23rem),1fr))] gap-2.5">
                {categoryEntries.map((entry) => (
                  <BrowseCard
                    key={entry.entryId}
                    entry={entry}
                    installedPluginId={entry.installed ? entry.pluginId : null}
                    onInstall={onInstall}
                    onOpenInstalled={onOpenInstalled}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </ResourceCollectionViewport>
  );
}

function BrowseCard({
  entry,
  installedPluginId,
  onInstall,
  onOpenInstalled,
}: {
  entry: PluginCatalogSearchEntry;
  installedPluginId: string | null;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenInstalled: (pluginId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  const uninstall = useMutation({
    mutationFn: () => {
      if (installedPluginId === null) {
        throw new Error("Installed plugin id is unavailable");
      }
      return removePlugin(fetch, installedPluginId);
    },
    onSuccess: () => {
      setConfirmingUninstall(false);
      invalidatePluginList({ queryClient });
      invalidatePluginCatalogSearch({ queryClient });
      appToast.success(`${entry.displayName} uninstalled`);
    },
    onError: (error) => {
      appToast.error(`Uninstalling ${entry.displayName} failed`, {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const identity = (
    <>
      <PlaceholderBadge
        className="size-6"
        iconName={pluginIconName(entry.icon)}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {entry.displayName}
        </p>
        {entry.description.length > 0 ? (
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {entry.description}
          </p>
        ) : null}
        {!entry.compatible && entry.incompatibleReason !== null ? (
          <p className="text-2xs text-warning-text">
            {entry.incompatibleReason}
          </p>
        ) : null}
      </div>
    </>
  );

  return (
    <>
      <div
        className="flex items-start gap-3 rounded-lg border border-border bg-card p-3.5"
        data-testid={`browse-card-${entry.entryId}`}
      >
        {installedPluginId === null ? (
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {identity}
          </div>
        ) : (
          <button
            type="button"
            className="-m-1 flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-md p-1 text-left outline-none transition-colors hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
            aria-label={`Open ${entry.displayName} details`}
            onClick={() => onOpenInstalled(installedPluginId)}
          >
            {identity}
          </button>
        )}
        {entry.installed ? (
          <span className="mt-0.5">
            <ResourceInstalledControl
              accessibleLabel={
                installedPluginId === null
                  ? `${entry.displayName} installed`
                  : `Uninstall ${entry.displayName}`
              }
              pending={uninstall.isPending}
              onAction={
                installedPluginId === null
                  ? undefined
                  : () => setConfirmingUninstall(true)
              }
            />
          </span>
        ) : (
          <span className="mt-0.5">
            <ResourceInstallControl
              accessibleLabel={`Install ${entry.displayName}`}
              disabled={!entry.compatible}
              onAction={() =>
                onInstall({
                  entryId: entry.entryId,
                  displayName: entry.displayName,
                  icon: entry.icon,
                })
              }
            />
          </span>
        )}
      </div>
      <ConfirmDeleteDialog
        open={confirmingUninstall}
        onOpenChange={(open) => {
          if (!uninstall.isPending) setConfirmingUninstall(open);
        }}
      >
        <ConfirmDeleteDialogContent
          title={`Uninstall ${entry.displayName}?`}
          description="The plugin will be removed from this BB host. Plugin data may be retained for a future reinstall."
          confirmLabel={uninstall.isPending ? "Uninstalling…" : "Uninstall"}
          pending={uninstall.isPending}
          onConfirm={() => uninstall.mutate()}
          onCancel={() => setConfirmingUninstall(false)}
        />
      </ConfirmDeleteDialog>
    </>
  );
}
