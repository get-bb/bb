import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";
import { Button } from "@bb/shared-ui/button";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import { appToast } from "@/components/ui/app-toast.js";
import {
  applyPluginCatalogStatus,
  invalidatePluginCatalogSearch,
} from "@/hooks/cache-owners/plugin-cache-owner";
import {
  refreshPluginCatalog,
  usePluginCatalogSearch,
  usePluginCatalogStatus,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import { formatRelativeTime } from "@/lib/relative-time";
import type { AddPluginInitial } from "./AddPluginDialog";
import {
  PlaceholderBadge,
  SUCCESS_TEXT_STYLE,
  UPDATE_TINT_STYLE,
  formatAbsoluteDate,
} from "./plugin-ui";

/** Browse and refresh BB's singleton official plugin catalog. */
export function BrowsePluginsTab({
  onInstall,
}: {
  onInstall: (initial: AddPluginInitial) => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounceValue(query.trim(), 300);
  const statusQuery = usePluginCatalogStatus({ enabled: true });
  const searchQuery = usePluginCatalogSearch(debouncedQuery, { enabled: true });
  const status = statusQuery.data;
  const entries = searchQuery.data ?? [];

  const refresh = useMutation({
    mutationFn: () => refreshPluginCatalog(fetch),
    onSuccess: (nextStatus) => {
      applyPluginCatalogStatus({ queryClient, status: nextStatus });
      if (nextStatus.lastError !== null) {
        appToast.error("Refreshing the plugin catalog failed", {
          description: nextStatus.lastError,
        });
        return;
      }
      invalidatePluginCatalogSearch({ queryClient });
      appToast.success("Plugin catalog refreshed");
    },
    onError: (error) => {
      // The server may have persisted failure status. Refetching status does
      // not touch successful search data, so cached catalog rows remain shown.
      void statusQuery.refetch();
      appToast.error("Refreshing the plugin catalog failed", {
        description: pluginAdminErrorMessage(error),
      });
    },
  });

  const byCategory = new Map<string, PluginCatalogSearchEntry[]>();
  for (const entry of entries) {
    const category = entry.category ?? "Other";
    const bucket = byCategory.get(category);
    if (bucket === undefined) byCategory.set(category, [entry]);
    else bucket.push(entry);
  }

  const failedRefresh = status?.lastError ?? null;
  const cachedAt = status?.lastRefreshAt ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card px-3.5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              BB Official catalog
            </p>
            {status === undefined ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {statusQuery.isPending
                  ? "Loading catalog status…"
                  : "Catalog status unavailable."}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {status.pluginCount} plugin
                {status.pluginCount === 1 ? "" : "s"}
                {status.lastRefreshAt !== null
                  ? ` · refreshed ${formatRelativeTime({ timestamp: status.lastRefreshAt, now: Date.now() })}`
                  : " · not refreshed yet"}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2.5 text-xs"
            disabled={refresh.isPending}
            aria-busy={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? (
              <Icon name="Spinner" className="size-3.5 animate-spin" />
            ) : (
              <Icon name="RotateCcw" className="size-3.5" />
            )}
            {failedRefresh === null ? "Refresh" : "Retry"}
          </Button>
        </div>
        {failedRefresh !== null ? (
          <p
            className="mt-2 text-xs text-warning-text"
            data-testid="catalog-refresh-error"
          >
            Refresh failed: {failedRefresh}.{" "}
            {cachedAt === null
              ? "Previously cached results remain available."
              : `Showing the catalog cached on ${formatAbsoluteDate(cachedAt)}.`}
          </p>
        ) : null}
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
              ? "The BB Official catalog is unavailable."
              : "No plugins match this search."
          }
        />
      ) : (
        [...byCategory.entries()].map(([category, categoryEntries]) => (
          <div key={category}>
            <h3 className="mb-2 text-sm font-semibold text-foreground">
              {category}
            </h3>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {categoryEntries.map((entry) => (
                <BrowseCard
                  key={entry.entryId}
                  entry={entry}
                  onInstall={onInstall}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function BrowseCard({
  entry,
  onInstall,
}: {
  entry: PluginCatalogSearchEntry;
  onInstall: (initial: AddPluginInitial) => void;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-border bg-card p-3.5"
      data-testid={`browse-card-${entry.entryId}`}
    >
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
        <p
          className="mt-1.5 truncate text-2xs text-subtle-foreground"
          title={entry.source}
          data-testid={`browse-source-${entry.entryId}`}
        >
          {entry.source}
        </p>
        {!entry.compatible && entry.incompatibleReason !== null ? (
          <p className="text-2xs text-warning-text">
            {entry.incompatibleReason}
          </p>
        ) : null}
      </div>
      {entry.installed ? (
        <span
          className="mt-0.5 inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-2xs font-medium"
          style={UPDATE_TINT_STYLE}
        >
          <span style={SUCCESS_TEXT_STYLE}>Installed ✓</span>
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-0.5 h-7 shrink-0 px-2.5 text-xs"
          disabled={!entry.compatible}
          onClick={() =>
            onInstall({
              entryId: entry.entryId,
              displayName: entry.displayName,
              icon: entry.icon,
            })
          }
        >
          Install
        </Button>
      )}
    </div>
  );
}
