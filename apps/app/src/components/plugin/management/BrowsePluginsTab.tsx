import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";
import {
  RESOURCE_GRID_PAGE_SIZE,
  ResourcePagination,
  useResourcePagination,
} from "@bb/shared-ui/resource-pagination";
import {
  ResourceBrowseCard,
  ResourceBrowseGrid,
  ResourceCollectionViewport,
  ResourceInstallControl,
  ResourceInstalledControl,
  ResourceListState,
  ResourceToolbar,
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
  onOpenPlugin,
}: {
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string) => void;
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

          <ResourceToolbar
            searchValue={query}
            searchPlaceholder="Search plugins"
            onSearchChange={setQuery}
          />
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
        <ResourceListState state="loading" message="Loading plugins" />
      ) : entries.length === 0 ? (
        <ResourceListState
          state={searchQuery.isError ? "error" : "empty"}
          message={
            searchQuery.isError
              ? "BB's official plugins are unavailable."
              : "No plugins match this search."
          }
          onRetry={
            searchQuery.isError
              ? () => {
                  void searchQuery.refetch();
                }
              : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {[...byCategory.entries()].map(([category, categoryEntries]) => (
            <div key={category}>
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                {category}
              </h3>
              <ResourceBrowseGrid
                className="grid-cols-[repeat(auto-fill,minmax(min(100%,23rem),1fr))]"
              >
                {categoryEntries.map((entry) => (
                  <BrowseCard
                    key={entry.entryId}
                    entry={entry}
                    installedPluginId={entry.installed ? entry.pluginId : null}
                    onInstall={onInstall}
                    onOpenPlugin={onOpenPlugin}
                  />
                ))}
              </ResourceBrowseGrid>
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
  onOpenPlugin,
}: {
  entry: PluginCatalogSearchEntry;
  installedPluginId: string | null;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string) => void;
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

  const leading = (
    <PlaceholderBadge
      className="size-6"
      iconName={pluginIconName(entry.icon)}
    />
  );
  const description =
    entry.description.length > 0 ? entry.description : undefined;
  const byline =
    !entry.compatible && entry.incompatibleReason !== null ? (
      <span className="text-warning-text">{entry.incompatibleReason}</span>
    ) : undefined;
  const headerAction =
    installedPluginId !== null ? (
      <ResourceInstalledControl
        accessibleLabel={`Uninstall ${entry.displayName}`}
        pending={uninstall.isPending}
        presentation="icon"
        tooltip={`Uninstall ${entry.displayName}`}
        onAction={() => setConfirmingUninstall(true)}
      />
    ) : (
      <ResourceInstallControl
        accessibleLabel={`Install ${entry.displayName}`}
        disabled={!entry.compatible}
        presentation="icon"
        tooltip={`Install ${entry.displayName}`}
        onAction={() =>
          onInstall({
            entryId: entry.entryId,
            displayName: entry.displayName,
            icon: entry.icon,
          })
        }
      />
    );

  return (
    <>
      <ResourceBrowseCard
        leading={leading}
        title={entry.displayName}
        description={description}
        byline={byline}
        headerAction={headerAction}
        openLabel={`Open ${entry.displayName} details`}
        onOpen={() => onOpenPlugin(entry.pluginId)}
      />
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
