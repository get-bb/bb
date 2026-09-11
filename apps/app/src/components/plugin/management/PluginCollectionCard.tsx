import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import { Switch } from "@bb/shared-ui/switch";
import {
  ResourceIconFrame,
  ResourceCardStat,
} from "@bb/shared-ui/resource-list";
import { appToast } from "@/components/ui/app-toast";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  setPluginEnabled,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { pluginListingActionLabel } from "@/hooks/queries/plugin-listing-queries";
import { pluginNeedsAttention } from "@/hooks/usePluginAttention";
import { PluginCard, PluginCardAuthor, PluginAuthorByline } from "./PluginCard";
import {
  CatalogEntryIconChip,
  PluginCategoryLabel,
  PluginLogo,
  formatPluginInstallCount,
} from "./plugin-ui";
import {
  pluginCollectionCategory,
  pluginCollectionName,
  type PluginCollectionEntry,
} from "./plugin-collection";
import {
  pluginRowSignal,
  pluginRuntimeStatusPresentation,
} from "./plugin-status";
import { PluginRowSignalView } from "./PluginRowSignal";

interface PluginCollectionCardProps {
  entry: PluginCollectionEntry;
  onOpen: (trigger: HTMLButtonElement) => void;
  onUpdate: () => void;
  onListingAction: () => void;
}

export function PluginCollectionCard({
  entry,
  onOpen,
  onUpdate,
  onListingAction,
}: PluginCollectionCardProps) {
  const { runtime, listing, catalogEntry } = entry;
  const name = pluginCollectionName(entry);
  const category = pluginCollectionCategory(entry);
  const runtimeStatus =
    runtime === null ? null : pluginRuntimeStatusPresentation(runtime);
  const author = listing?.entry.author;
  const authorUrl =
    author?.url ??
    (author?.github === undefined
      ? null
      : `https://github.com/${author.github}`);
  const localSource =
    runtime?.source.startsWith("path:") === true
      ? runtime.source.slice(5)
      : null;
  const icon = listing?.entry.icon;
  const leading =
    catalogEntry !== null ? (
      <CatalogEntryIconChip entry={catalogEntry} />
    ) : runtime !== null ? (
      <ResourceIconFrame className="size-6 rounded border border-border bg-muted/40 text-muted-foreground">
        {() => <PluginLogo plugin={runtime} className="size-4" />}
      </ResourceIconFrame>
    ) : (
      <CatalogEntryIconChip
        entry={{
          displayName: name,
          icon: typeof icon === "string" ? icon : null,
          iconUrl:
            typeof icon === "object" && icon.url.startsWith("https:")
              ? icon.url
              : null,
          iconTinted: false,
        }}
      />
    );
  const byline =
    localSource !== null && listing === null ? (
      <span className="font-mono text-2xs" title={localSource}>
        {runtime?.sourceDisplay ?? localSource}
      </span>
    ) : catalogEntry !== null ? (
      <PluginCardAuthor entry={catalogEntry} />
    ) : author !== undefined ? (
      <PluginAuthorByline name={author.name} github={author.github ?? null}>
        {authorUrl === null ? (
          author.name
        ) : (
          <a
            href={authorUrl}
            target="_blank"
            rel="noreferrer"
            className="pointer-events-auto relative rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {author.name}
            <span className="sr-only"> Opens in a new tab</span>
          </a>
        )}
      </PluginAuthorByline>
    ) : runtime?.publisherLabel !== null &&
      runtime?.publisherLabel !== undefined ? (
      <PluginAuthorByline
        name={runtime.publisherLabel}
        github={null}
        official={runtime.provenance === "builtin"}
      >
        {runtime.publisherLabel}
      </PluginAuthorByline>
    ) : null;
  return (
    <div data-testid={`plugin-card-${entry.pluginId}`}>
      <PluginCard
        title={name}
        leading={leading}
        description={
          runtimeStatus === null ? (
            (runtime?.description ??
            listing?.entry.description ??
            catalogEntry?.description)
          ) : (
            <span>
              <span
                data-testid={`plugin-runtime-status-${entry.pluginId}`}
                className={
                  runtimeStatus.tone === "error"
                    ? "font-medium text-destructive-text"
                    : "font-medium text-warning-text"
                }
              >
                {runtimeStatus.label}
              </span>
              {" · "}
              <span>{runtime?.statusDetail ?? runtimeStatus.condition}</span>
            </span>
          )
        }
        byline={byline}
        footerMeta={
          listing !== null && listing.lifecycle.status !== "published" ? (
            <span className="text-2xs text-subtle-foreground">
              {listing.lifecycle.status === "draft"
                ? "Not published"
                : "In review"}
            </span>
          ) : category.id === "uncategorized" ? null : (
            <PluginCategoryLabel
              categoryId={category.id}
              label={category.label}
            />
          )
        }
        headerAction={
          <span className="flex items-center gap-2">
            {listing?.lifecycle.status === "published" &&
            catalogEntry?.installs != null ? (
              <ResourceCardStat
                icon="Download"
                accessibleLabel={`${catalogEntry.installs.toLocaleString()} installs`}
              >
                <span className="text-2xs">
                  {formatPluginInstallCount(catalogEntry.installs)}
                </span>
              </ResourceCardStat>
            ) : null}
            {listing === null ? null : (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onListingAction}
              >
                {pluginListingActionLabel(listing)}
              </Button>
            )}
            {runtime === null ? null : (
              <PluginRuntimeActions plugin={runtime} onUpdate={onUpdate} />
            )}
          </span>
        }
        openLabel={`${name} plugin details`}
        onOpen={onOpen}
      />
    </div>
  );
}

interface PluginRuntimeActionsProps {
  plugin: PluginListItem;
  onUpdate: () => void;
}

function PluginRuntimeActions({ plugin, onUpdate }: PluginRuntimeActionsProps) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    meta: { showErrorToast: false },
    mutationFn: (enabled: boolean) =>
      setPluginEnabled(fetch, plugin.id, enabled),
    onError: (error, enabled) =>
      appToast.error(
        `${enabled ? "Enabling" : "Disabling"} ${plugin.id} failed`,
        { description: error instanceof Error ? error.message : String(error) },
      ),
    onSettled: () => invalidatePluginList({ queryClient }),
  });
  const enabled = toggle.isPending ? toggle.variables : plugin.enabled;
  const notRunning = pluginNeedsAttention({
    enabled: enabled === true,
    status: plugin.status,
  });
  const signal = pluginRowSignal(plugin);
  return (
    <>
      {signal?.kind === "update" ? (
        <span data-testid={`plugin-update-signal-${plugin.id}`}>
          <PluginRowSignalView
            signal={signal}
            onUpdateClick={onUpdate}
            onStatusClick={() => {}}
          />
        </span>
      ) : null}
      {notRunning ? (
        <span
          data-testid={`plugin-not-running-${plugin.id}`}
          className="sr-only"
        >
          not running
        </span>
      ) : null}
      <Switch
        checked={enabled}
        disabled={toggle.isPending}
        onCheckedChange={(next) => toggle.mutate(next)}
        aria-label={`${enabled ? "Disable" : "Enable"} ${plugin.id}${notRunning ? ` (${plugin.status}, not running)` : ""}`}
      />
    </>
  );
}
