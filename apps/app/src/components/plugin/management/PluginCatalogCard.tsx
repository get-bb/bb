import {
  ResourceInstallControl,
  ResourceInstalledControl,
} from "@bb/shared-ui/resource-list";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import type { AddPluginInitial } from "./AddPluginDialog";
import { PluginCard, PluginCardGrid, PluginCardAuthor } from "./PluginCard";
import {
  CatalogEntryIconChip,
  pluginInstallCountPresentation,
} from "./plugin-ui";

export function PluginCatalogGrid({
  entries,
  showCategory = true,
  onInstall,
  onOpenPlugin,
}: {
  entries: readonly PluginCatalogSearchEntry[];
  showCategory?: boolean;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
}) {
  return (
    <PluginCardGrid>
      {entries.map((entry) => (
        <PluginCatalogCard
          key={`${entry.marketplace}/${entry.entryId}`}
          entry={entry}
          showCategory={showCategory}
          onInstall={onInstall}
          onOpenPlugin={onOpenPlugin}
        />
      ))}
    </PluginCardGrid>
  );
}

export function PluginCatalogCard({
  entry,
  showCategory,
  onInstall,
  onOpenPlugin,
}: {
  entry: PluginCatalogSearchEntry;
  showCategory: boolean;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
}) {
  const count = pluginInstallCountPresentation(entry.installs);
  return (
    <PluginCard
      leading={<CatalogEntryIconChip entry={entry} compact />}
      title={entry.displayName}
      description={entry.description || undefined}
      byline={<PluginCardAuthor entry={entry} />}
      badge={
        showCategory && entry.category !== undefined
          ? {
              kind: "category",
              categoryId: entry.categoryId,
              label: entry.category,
            }
          : null
      }
      headerAction={
        entry.installed ? (
          <ResourceInstalledControl accessibleLabel="Installed" count={count} />
        ) : (
          <ResourceInstallControl
            accessibleLabel={`Install ${entry.displayName}${
              count === undefined ? "" : ` — ${count.accessibleLabel}`
            }`}
            disabled={!entry.compatible}
            presentation="compact"
            tooltip={`Install ${entry.displayName}`}
            count={count}
            className="border-border/80 bg-background text-foreground shadow-none hover:bg-state-hover"
            onAction={() =>
              onInstall({
                entryId: entry.entryId,
                marketplace: entry.marketplace,
                pluginId: entry.pluginId,
                publisherLabel: entry.publisherLabel,
                displayName: entry.displayName,
                icon: entry.icon,
                iconUrl: entry.iconUrl,
                iconTinted: entry.iconTinted,
                source: entry.source,
              })
            }
          />
        )
      }
      openLabel={`Open ${entry.displayName} details`}
      onOpen={(trigger) => onOpenPlugin(entry.pluginId, trigger)}
    />
  );
}
