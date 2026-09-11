import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { ResourceBrowseGrid } from "@bb/shared-ui/resource-list";
import {
  getPluginDetailRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { pluginListingTaskPrompt } from "@/hooks/queries/plugin-listing-queries";
import { PluginCollectionCard } from "./PluginCollectionCard";
import { type PluginCollectionEntry } from "./plugin-collection";
import { UpdatePluginDialog } from "./UpdatePluginDialog";

interface InstalledPluginsTabProps {
  entries: readonly PluginCollectionEntry[];
  onOpenPlugin?: (pluginId: string, trigger: HTMLButtonElement) => void;
}

export function InstalledPluginsTab({
  entries,
  onOpenPlugin,
}: InstalledPluginsTabProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [updateTargetId, setUpdateTargetId] = useState<string | null>(null);
  const updateTarget =
    entries.find((entry) => entry.pluginId === updateTargetId)?.runtime ?? null;
  if (entries.length === 0) {
    return (
      <EmptyState message="No plugins yet. Browse the catalog, create a plugin, or run bb plugin install <source>." />
    );
  }
  return (
    <>
      <ResourceBrowseGrid className="w-full grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2">
        {entries.map((entry) => (
          <PluginCollectionCard
            key={entry.pluginId}
            entry={entry}
            onOpen={(trigger) => {
              if (onOpenPlugin !== undefined)
                onOpenPlugin(entry.pluginId, trigger);
              else
                navigate(
                  `${getPluginDetailRoutePath({ pluginId: entry.pluginId })}${location.search}`,
                );
            }}
            onUpdate={() => setUpdateTargetId(entry.pluginId)}
            onListingAction={() => {
              if (entry.listing === null) return;
              navigate(getRootComposeRoutePath(), {
                state: {
                  focusPrompt: true,
                  initialPrompt: pluginListingTaskPrompt(entry.listing),
                  replaceInitialPrompt: true,
                },
              });
            }}
          />
        ))}
      </ResourceBrowseGrid>
      {updateTarget === null ? null : (
        <UpdatePluginDialog
          plugin={updateTarget}
          open
          onOpenChange={(open) => {
            if (!open) setUpdateTargetId(null);
          }}
        />
      )}
    </>
  );
}
