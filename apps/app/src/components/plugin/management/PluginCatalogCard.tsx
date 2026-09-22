import { PluginCatalogInstallControl } from "./PluginCatalogInstallControl";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import type { AddPluginInitial } from "./AddPluginDialog";
import { PluginCard, PluginCardGrid, PluginCardAuthor } from "./PluginCard";
import {
  CatalogEntryIconChip,
  pluginInstallCountPresentation,
} from "./plugin-ui";

export function PluginCatalogGrid({
  entries,
  onInstall,
  onUninstall,
  onOpenPlugin,
}: {
  entries: readonly PluginCatalogSearchEntry[];
  onInstall: (initial: AddPluginInitial) => void;
  onUninstall?: (entry: PluginCatalogSearchEntry) => void;
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
}) {
  return (
    <PluginCardGrid>
      {entries.map((entry) => (
        <PluginCatalogCard
          key={`${entry.marketplace}/${entry.entryId}`}
          entry={entry}
          onInstall={onInstall}
          onUninstall={onUninstall}
          onOpenPlugin={onOpenPlugin}
        />
      ))}
    </PluginCardGrid>
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
  const count = pluginInstallCountPresentation(entry.installs);
  return (
    <PluginCard
      leading={<CatalogEntryIconChip entry={entry} className="size-8" />}
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
            disabled={!entry.compatible}
            count={count}
            onInstall={() => onInstall(entry)}
          />
        )
      }
      openLabel={`Open ${entry.displayName} details`}
      onOpen={(trigger) => onOpenPlugin(entry.pluginId, trigger)}
    />
  );
}
