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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Pill } from "@bb/shared-ui/pill";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { RadioGroup, RadioGroupItem } from "@bb/shared-ui/radio-group";
import { Label } from "@bb/shared-ui/label";
import { appToast } from "@/components/ui/app-toast.js";
import {
  invalidateMarketplaces,
  invalidatePluginList,
} from "@/hooks/cache-owners/plugin-cache-owner";
import {
  addMarketplace,
  MarketplaceRemovalBlockedError,
  refreshMarketplace,
  removeMarketplace,
  setMarketplaceAutoPolicy,
  useMarketplaces,
  type MarketplaceAffectedPlugin,
  type MarketplaceAutoPolicy,
  type MarketplaceListItem,
  type MarketplacePluginDisposition,
} from "@/hooks/queries/plugin-marketplace-queries";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  ATTENTION_TINT_STYLE,
  LetterBadge,
  WARNING_NOTE_STYLE,
  formatAbsoluteDate,
} from "./plugin-ui";

/**
 * The Marketplaces tab (sketch v1 E): catalog rows with refresh state and a
 * removal chooser. A failed refresh keeps last-known-good and says so;
 * removal never silently uninstalls — the 422 affectedPlugins flow asks per
 * plugin whether to keep it as a direct install or uninstall it.
 */
export function MarketplacesTab() {
  const queryClient = useQueryClient();
  const marketplacesQuery = useMarketplaces({ enabled: true });
  const marketplaces = marketplacesQuery.data ?? [];
  const [addOpen, setAddOpen] = useState(false);
  const [removal, setRemoval] = useState<{
    marketplace: MarketplaceListItem;
    affectedPlugins: MarketplaceAffectedPlugin[];
  } | null>(null);

  const invalidate = () => {
    invalidateMarketplaces({ queryClient });
    invalidatePluginList({ queryClient });
  };

  const remove = useMutation({
    mutationFn: (marketplace: MarketplaceListItem) =>
      removeMarketplace(fetch, marketplace.id, []),
    onSuccess: (_result, marketplace) => {
      invalidate();
      appToast.success(`Removed ${marketplace.displayName}`);
    },
    onError: (error, marketplace) => {
      if (error instanceof MarketplaceRemovalBlockedError) {
        setRemoval({ marketplace, affectedPlugins: error.affectedPlugins });
        return;
      }
      appToast.error(`Removing ${marketplace.displayName} failed`, {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => setAddOpen(true)}
        >
          <Icon name="Plus" className="size-3.5" />
          Add marketplace
        </Button>
      </div>
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
                onRemove={() => remove.mutate(marketplace)}
              />
            ))}
          </div>
        </div>
      )}
      <p className="text-2xs text-subtle-foreground">
        Adding a marketplace installs nothing; refreshing a catalog never runs
        plugin code.
      </p>
      <AddMarketplaceDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={invalidate}
      />
      {removal !== null ? (
        <RemoveMarketplaceDialog
          marketplace={removal.marketplace}
          affectedPlugins={removal.affectedPlugins}
          onOpenChange={(open) => {
            if (!open) setRemoval(null);
          }}
          onRemoved={invalidate}
        />
      ) : null}
    </div>
  );
}

/**
 * Official badge (sketch v1 E): builtin and managed catalogs are
 * organization- or bb-vouched; user/project catalogs are whatever the user
 * added and never earn the badge.
 */
export function marketplaceIsOfficial(scope: MarketplaceListItem["scope"]): boolean {
  return scope === "builtin" || scope === "managed";
}

/**
 * The check-policy summary line (sketch v1 E "checks daily, updates need
 * approval" slot). The scheduled sweep re-checks roughly hourly (1h base
 * delay + jitter), so the copy says hourly, not the sketch's "daily".
 */
export function marketplaceCheckPolicySummary(policy: {
  autoCheck: boolean;
  autoApply: boolean;
}): string {
  if (policy.autoCheck) {
    return policy.autoApply
      ? "checks hourly · automatic updates"
      : "checks hourly · updates need approval";
  }
  return policy.autoApply
    ? "manual checks · automatic updates"
    : "manual checks";
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

  // No optimistic flip: the checkbox state only changes once the server
  // echoes the persisted policy (a mismatch rejects and toasts instead).
  const setPolicy = useMutation({
    mutationFn: (policy: MarketplaceAutoPolicy) =>
      setMarketplaceAutoPolicy(fetch, marketplace.id, policy),
    onSuccess: () => {
      invalidateMarketplaces({ queryClient });
      // Marketplace autoApply feeds each plugin's effective autoApply.
      invalidatePluginList({ queryClient });
    },
    onError: (error) => {
      appToast.error(
        `Changing the ${marketplace.displayName} update policy failed`,
        {
          description: error instanceof Error ? error.message : String(error),
        },
      );
    },
  });

  const failed = marketplace.lastError !== null;
  const countLabel = `${marketplace.pluginCount} plugin${marketplace.pluginCount === 1 ? "" : "s"}`;
  const policyLabel = marketplaceCheckPolicySummary(marketplace);
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
      <LetterBadge label={marketplace.displayName} className="size-6" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {marketplace.displayName}
          </span>
          {marketplaceIsOfficial(marketplace.scope) ? (
            <Pill variant="secondary" size="sm">
              official
            </Pill>
          ) : null}
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
          {countLabel} · {refreshLabel} · {policyLabel}
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
            <DropdownMenuCheckboxItem
              checked={marketplace.autoCheck}
              disabled={setPolicy.isPending}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) =>
                setPolicy.mutate({
                  autoCheck: checked === true,
                  autoApply: marketplace.autoApply,
                })
              }
            >
              Check for updates automatically
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={marketplace.autoApply}
              disabled={setPolicy.isPending}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) =>
                setPolicy.mutate({
                  autoCheck: marketplace.autoCheck,
                  autoApply: checked === true,
                })
              }
            >
              Apply compatible updates automatically
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive-text"
              onSelect={onRemove}
            >
              Remove…
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
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const [source, setSource] = useState("");
  const [name, setName] = useState("");

  const add = useMutation({
    mutationFn: () =>
      addMarketplace(fetch, {
        source: source.trim(),
        ...(name.trim().length > 0 ? { name: name.trim() } : {}),
      }),
    onSuccess: () => {
      onAdded();
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

/** Exported for tests (per-plugin keep/uninstall dispositions). */
export function RemoveMarketplaceDialog({
  marketplace,
  affectedPlugins,
  onOpenChange,
  onRemoved,
}: {
  marketplace: MarketplaceListItem;
  affectedPlugins: MarketplaceAffectedPlugin[];
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  // Keep-as-direct is the safe default: the plugin retains its source
  // intent and update policy, only provenance changes.
  const [actions, setActions] = useState<Record<string, "keep" | "uninstall">>(
    () => Object.fromEntries(affectedPlugins.map((plugin) => [plugin.id, "keep"])),
  );

  const remove = useMutation({
    mutationFn: () => {
      const dispositions: MarketplacePluginDisposition[] = affectedPlugins.map(
        (plugin) => ({
          pluginId: plugin.id,
          action: actions[plugin.id] ?? "keep",
        }),
      );
      return removeMarketplace(fetch, marketplace.id, dispositions);
    },
    onSuccess: () => {
      onRemoved();
      appToast.success(`Removed ${marketplace.displayName}`);
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
            {affectedPlugins.length} installed plugin
            {affectedPlugins.length === 1 ? " came" : "s came"} from this
            marketplace. Choose what happens to each.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-lg border border-border">
          {affectedPlugins.map((plugin, index) => (
            <div
              key={plugin.id}
              className={
                index > 0
                  ? "border-t border-border-seam px-3 py-2.5"
                  : "px-3 py-2.5"
              }
            >
              <div className="flex items-center gap-2">
                <LetterBadge label={plugin.id} className="size-5 text-2xs" />
                <span className="text-sm font-medium text-foreground">
                  {plugin.id}
                </span>
                <span className="font-mono text-2xs text-subtle-foreground">
                  v{plugin.version}
                </span>
              </div>
              <RadioGroup
                className="mt-2 flex gap-4"
                value={actions[plugin.id] ?? "keep"}
                onValueChange={(value) =>
                  setActions((current) => ({
                    ...current,
                    [plugin.id]: value === "uninstall" ? "uninstall" : "keep",
                  }))
                }
              >
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem
                    value="keep"
                    id={`dispose-${plugin.id}-keep`}
                  />
                  <Label
                    htmlFor={`dispose-${plugin.id}-keep`}
                    className="text-xs font-normal text-muted-foreground"
                  >
                    Keep as direct install
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem
                    value="uninstall"
                    id={`dispose-${plugin.id}-uninstall`}
                  />
                  <Label
                    htmlFor={`dispose-${plugin.id}-uninstall`}
                    className="text-xs font-normal text-muted-foreground"
                  >
                    Uninstall
                  </Label>
                </div>
              </RadioGroup>
            </div>
          ))}
        </div>
        <p className="text-2xs text-subtle-foreground">
          Kept plugins keep their current source and update policy; they&rsquo;ll
          appear as &ldquo;direct&rdquo; installs.
        </p>
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
