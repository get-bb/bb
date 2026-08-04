import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";
import {
  ResourceBrowseCard,
  ResourceBrowseGrid,
  ResourceCollectionViewport,
  ResourceInstallControl,
  ResourceInstalledControl,
  ResourceListState,
  ResourceSortMenu,
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
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import { removePlugin } from "@/hooks/queries/plugin-settings-queries";
import type { AddPluginInitial } from "./AddPluginDialog";
import { PluginCategoryFilterPills } from "./PluginCategoryFilterPills";
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
  const [category, setCategory] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [debouncedQuery] = useDebounceValue(query.trim(), 300);
  const searchQuery = usePluginCatalogSearch(debouncedQuery, { enabled: true });
  const entries = searchQuery.data ?? [];
  const categories: string[] = [];
  for (const entry of entries) {
    if (!categories.includes(entry.category)) categories.push(entry.category);
  }
  if (category !== null && !categories.includes(category)) {
    categories.push(category);
  }
  const visibleEntries = (
    category === null
      ? entries
      : entries.filter((entry) => entry.category === category)
  )
    .slice()
    .sort((left, right) => {
      const result = left.displayName.localeCompare(right.displayName);
      if (result !== 0) return sortDirection === "asc" ? result : -result;
      return left.entryId.localeCompare(right.entryId);
    });

  return (
    <ResourceCollectionViewport
      scrollId="plugins-browse-results"
      contentClassName="space-y-4"
      toolbar={
        <ResourceToolbar
          searchValue={query}
          searchPlaceholder="Search plugins"
          onSearchChange={setQuery}
          containedControls
          controls={
            <ResourceSortMenu
              value="alpha"
              direction={sortDirection}
              options={[{ id: "alpha", label: "Plugin name" }]}
              onChange={() =>
                setSortDirection((current) =>
                  current === "asc" ? "desc" : "asc",
                )
              }
            />
          }
        />
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
        <div className="space-y-3">
          <PluginCategoryFilterPills
            categories={categories}
            value={category}
            onValueChange={setCategory}
          />
          {visibleEntries.length === 0 ? (
            <ResourceListState
              state="empty"
              message="No plugins match this category."
            />
          ) : (
            <ResourceBrowseGrid className="grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2">
              {visibleEntries.map((entry) => (
                <BrowseCard
                  key={entry.entryId}
                  entry={entry}
                  installedPluginId={entry.installed ? entry.pluginId : null}
                  onInstall={onInstall}
                  onOpenPlugin={onOpenPlugin}
                />
              ))}
            </ResourceBrowseGrid>
          )}
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
        className="min-h-20 gap-x-2 gap-y-1.5 p-2.5"
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
