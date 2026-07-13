import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { appToast } from "@/components/ui/app-toast.js";
import {
  invalidateMarketplaces,
  invalidatePluginList,
} from "@/hooks/cache-owners/plugin-cache-owner";
import {
  addMarketplace,
  refreshMarketplace,
  removeMarketplace,
  useMarketplaces,
  type MarketplaceListItem,
} from "@/hooks/queries/plugin-marketplace-queries";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  ATTENTION_TINT_STYLE,
  PlaceholderBadge,
  WARNING_NOTE_STYLE,
  formatAbsoluteDate,
} from "./plugin-ui";

/**
 * The Marketplaces tab (sketch v1 E): catalog rows with refresh state and a
 * simple removal confirm. A failed refresh keeps last-known-good and says
 * so; removal never uninstalls — installed plugins from the catalog become
 * direct installs, and the confirmation toast names how many were kept.
 */
export function MarketplacesTab({
  addOpen,
  onAddOpenChange,
}: {
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}) {
  const marketplacesQuery = useMarketplaces({ enabled: true });
  const marketplaces = marketplacesQuery.data ?? [];
  const [removal, setRemoval] = useState<MarketplaceListItem | null>(null);

  return (
    <div className="space-y-3">
      {marketplaces.length === 0 ? (
        <EmptyState
          message={
            marketplacesQuery.isPending
              ? "Loading marketplaces…"
              : "No marketplaces added. Marketplaces are plugin catalogs — adding one installs nothing."
          }
        />
      ) : (
        <div className="rounded-lg border border-border bg-card px-4 py-1">
          <div className="divide-y divide-border">
            {marketplaces.map((marketplace) => (
              <MarketplaceRow
                key={marketplace.id}
                marketplace={marketplace}
                onRemove={() => setRemoval(marketplace)}
              />
            ))}
          </div>
        </div>
      )}
      <p className="text-2xs text-subtle-foreground">
        Adding a marketplace installs nothing; refreshing a catalog never runs
        plugin code.
      </p>
      <AddMarketplaceDialog open={addOpen} onOpenChange={onAddOpenChange} />
      {removal !== null ? (
        <RemoveMarketplaceDialog
          marketplace={removal}
          onOpenChange={(open) => {
            if (!open) setRemoval(null);
          }}
        />
      ) : null}
    </div>
  );
}

function MarketplaceRow({
  marketplace,
  onRemove,
}: {
  marketplace: MarketplaceListItem;
  onRemove: () => void;
}) {
  const queryClient = useQueryClient();
  const refresh = useMutation({
    mutationFn: () => refreshMarketplace(fetch, marketplace.id),
    onSettled: () => {
      invalidateMarketplaces({ queryClient });
    },
    onError: (error) => {
      appToast.error(`Refreshing ${marketplace.displayName} failed`, {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const failed = marketplace.lastError !== null;
  const countLabel = `${marketplace.pluginCount} plugin${marketplace.pluginCount === 1 ? "" : "s"}`;
  const refreshLabel = failed
    ? marketplace.lastRefreshAt !== null
      ? // Last-known-good stays in use on refresh failure (locked design).
        `using cached catalog from ${formatAbsoluteDate(marketplace.lastRefreshAt)}`
      : "no cached catalog yet"
    : marketplace.lastRefreshAt !== null
      ? `refreshed ${formatRelativeTime({ timestamp: marketplace.lastRefreshAt, now: Date.now() })}`
      : "never refreshed";

  return (
    <div
      className="flex items-start gap-3 py-3"
      data-testid={`marketplace-row-${marketplace.id}`}
    >
      <PlaceholderBadge iconName="GridView" className="size-6" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {marketplace.displayName}
          </span>
          {failed ? (
            <span
              className="inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium"
              style={ATTENTION_TINT_STYLE}
            >
              refresh failed
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {countLabel} · {refreshLabel}
        </p>
        {failed ? (
          <p className="mt-0.5 text-xs text-warning-text">
            {marketplace.lastError}
          </p>
        ) : null}
        <p className="mt-1 truncate font-mono text-2xs text-subtle-foreground">
          {marketplace.source}
          {marketplace.resolvedCommit !== null
            ? ` → ${marketplace.resolvedCommit.slice(0, 7)}`
            : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={refresh.isPending}
          aria-busy={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          {refresh.isPending ? (
            <Icon name="Spinner" className="size-3.5 animate-spin" />
          ) : null}
          {failed ? "Retry" : "Refresh"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 px-0"
              aria-label={`Marketplace actions for ${marketplace.displayName}`}
            >
              <Icon name="MoreHorizontal" className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive-text"
              onSelect={onRemove}
            >
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function AddMarketplaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [source, setSource] = useState("");
  const [name, setName] = useState("");

  const add = useMutation({
    mutationFn: () =>
      addMarketplace(fetch, {
        source: source.trim(),
        ...(name.trim().length > 0 ? { name: name.trim() } : {}),
      }),
    onSuccess: () => {
      invalidateMarketplaces({ queryClient });
      appToast.success("Marketplace added", {
        description: "No plugins were installed.",
      });
      setSource("");
      setName("");
      onOpenChange(false);
    },
    onError: (error) => {
      appToast.error("Adding the marketplace failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add marketplace</DialogTitle>
          <DialogDescription>
            A marketplace is a catalog of plugins you can browse and install
            from.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Input
              value={source}
              autoFocus
              placeholder="bb-plugins/official · git URL[@ref] · ./local-marketplace"
              aria-label="Marketplace source"
              className="h-8 font-mono text-xs"
              onChange={(event) => setSource(event.target.value)}
            />
          </div>
          <Input
            value={name}
            placeholder="Name (optional)"
            aria-label="Marketplace name"
            className="h-8 text-xs"
            onChange={(event) => setName(event.target.value)}
          />
          {/* The trust prompt never collapses: catalogs can introduce
              full-trust code, though adding one installs nothing. */}
          <div
            className="flex gap-2.5 rounded-lg border px-3 py-2.5 text-xs text-foreground"
            style={WARNING_NOTE_STYLE}
            data-testid="marketplace-trust-warning"
          >
            <span className="mt-0.5 shrink-0 text-warning-text">
              <Icon name="AlertTriangle" className="size-3.5" />
            </span>
            <span>
              <span className="font-medium">
                Catalogs can introduce full-trust plugin code.
              </span>{" "}
              Adding a marketplace installs nothing — each install still asks
              for confirmation — but only add catalogs you trust.
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={add.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={source.trim().length === 0 || add.isPending}
            aria-busy={add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending ? (
              <Icon name="Spinner" className="animate-spin" />
            ) : null}
            Add marketplace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Exported for tests (simplified removal confirm). */
export function RemoveMarketplaceDialog({
  marketplace,
  onOpenChange,
}: {
  marketplace: MarketplaceListItem;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => removeMarketplace(fetch, marketplace.id),
    onSuccess: (result) => {
      invalidateMarketplaces({ queryClient });
      invalidatePluginList({ queryClient });
      appToast.success(`Removed ${marketplace.displayName}`, {
        description:
          result.convertedPluginIds.length > 0
            ? `Kept as direct installs: ${result.convertedPluginIds.join(", ")}.`
            : undefined,
      });
      onOpenChange(false);
    },
    onError: (error) => {
      appToast.error(`Removing ${marketplace.displayName} failed`, {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove {marketplace.displayName}?</DialogTitle>
          <DialogDescription>
            Removing a marketplace uninstalls nothing: plugins installed from
            it stay and become &ldquo;direct&rdquo; installs, keeping their
            current source.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={remove.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending}
            aria-busy={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? (
              <Icon name="Spinner" className="animate-spin" />
            ) : null}
            Remove marketplace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
