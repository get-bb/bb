import {
  RESOURCE_GRID_PAGE_SIZE,
  ResourceInfiniteScrollSentinel,
  useResourceInfiniteItems,
} from "@bb/shared-ui/resource-pagination";
import { PluginCatalogInstallControl } from "./PluginCatalogInstallControl";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import {
  useCancelPluginInstallJob,
  useCatalogEntryInstallJob,
} from "@/hooks/queries/plugin-install-job-queries";
import type { AddPluginInitial } from "./AddPluginDialog";
import { PluginCard, PluginCardGrid, PluginCardAuthor } from "./PluginCard";
import {
  catalogEntryDetailKey,
  catalogEntryInstallBlocker,
} from "./installed-plugin-catalog";
import {
  CatalogEntryIconChip,
  pluginInstallCountPresentation,
} from "./plugin-ui";

export function PluginCatalogGrid({
  entries,
  resetKey,
  onInstall,
  onUninstall,
  onOpenPlugin,
}: {
  entries: readonly PluginCatalogSearchEntry[];
  resetKey: string;
  onInstall: (initial: AddPluginInitial) => void;
  onUninstall?: (entry: PluginCatalogSearchEntry) => void;
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
}) {
  const list = useResourceInfiniteItems(entries, {
    pageSize: RESOURCE_GRID_PAGE_SIZE,
    resetKey,
  });
  return (
    <>
      <PluginCardGrid>
        {list.items.map((entry) => (
          <PluginCatalogCard
            key={`${entry.marketplace}/${entry.entryId}`}
            entry={entry}
            onInstall={onInstall}
            onUninstall={onUninstall}
            onOpenPlugin={onOpenPlugin}
          />
        ))}
      </PluginCardGrid>
      <ResourceInfiniteScrollSentinel
        itemCount={list.items.length}
        hasMore={list.hasMore}
        onLoadMore={list.loadMore}
      />
    </>
  );
}

export function PluginCatalogCard({
  entry,
  onInstall,
  onUninstall,
  onOpenPlugin,
}: {
  entry: PluginCatalogSearchEntry;
  onInstall: (initial: AddPluginInitial) => void;
  onUninstall?: (entry: PluginCatalogSearchEntry) => void;
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
}) {
  const count = pluginInstallCountPresentation(entry);
  const installBlocker = catalogEntryInstallBlocker(entry);
  const installJob = useCatalogEntryInstallJob(entry);
  const { mutate: cancelInstall } = useCancelPluginInstallJob();
  return (
    <PluginCard
      leading={<CatalogEntryIconChip entry={entry} compact />}
      title={entry.displayName}
      description={entry.description || undefined}
      byline={<PluginCardAuthor entry={entry} />}
      footerAction={
        entry.installed ? (
          <PluginCatalogInstallControl
            displayName={entry.displayName}
            installed
            subtle
            included={entry.source.startsWith("builtin:")}
            count={count}
            onUninstall={
              onUninstall === undefined ? undefined : () => onUninstall(entry)
            }
          />
        ) : (
          <PluginCatalogInstallControl
            displayName={entry.displayName}
            installed={false}
            subtle
            disabled={installBlocker !== null}
            unavailableReason={installBlocker}
            count={count}
            onInstall={() => onInstall(entry)}
            installJob={installJob}
            onCancelInstall={cancelInstall}
          />
        )
      }
      openLabel={`Open ${entry.displayName} details`}
      onOpen={(trigger) => onOpenPlugin(catalogEntryDetailKey(entry), trigger)}
    />
  );
}
