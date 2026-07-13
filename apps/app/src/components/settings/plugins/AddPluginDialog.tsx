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
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { appToast } from "@/components/ui/app-toast.js";
import {
  invalidateMarketplaces,
  invalidatePluginList,
} from "@/hooks/cache-owners/plugin-cache-owner";
import {
  installPlugin,
  type PluginInstallRequest,
} from "@/hooks/queries/plugin-marketplace-queries";
import { FullTrustWarning, KeyValueGrid, PlaceholderBadge } from "./plugin-ui";

/**
 * Pre-fill for Browse-tab installs: the dialog shows the marketplace entry
 * instead of the free source field, and the install body uses the
 * marketplace form so provenance is recorded.
 */
export type AddPluginInitial = {
  marketplaceId: string;
  marketplaceName: string;
  entryId: string;
  displayName: string;
};

export interface AddPluginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: AddPluginInitial | null;
}

/**
 * The one-step Add-plugin dialog: source field (or the Browse tab's catalog
 * entry pre-filled) plus the full-trust confirmation, committing straight to
 * POST /plugins/install. The server resolves and validates during install;
 * an incompatible or unparsable source surfaces as the install error toast
 * with no active state changed.
 */
export function AddPluginDialog({
  open,
  onOpenChange,
  initial,
}: AddPluginDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <AddPluginDialogContent
            initial={initial ?? null}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function buildRequest(
  initial: AddPluginInitial | null,
  sourceText: string,
): PluginInstallRequest | null {
  if (initial !== null) {
    return {
      marketplace: {
        marketplaceId: initial.marketplaceId,
        entryId: initial.entryId,
      },
    };
  }
  const trimmed = sourceText.trim();
  return trimmed.length === 0 ? null : { source: trimmed };
}

function AddPluginDialogContent({
  initial,
  onOpenChange,
}: {
  initial: AddPluginInitial | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [sourceText, setSourceText] = useState("");
  const request = buildRequest(initial, sourceText);

  const install = useMutation({
    mutationFn: (body: PluginInstallRequest) => installPlugin(fetch, body),
    onSuccess: () => {
      invalidatePluginList({ queryClient });
      // Search rows carry installed flags; a fresh install flips them.
      invalidateMarketplaces({ queryClient });
      appToast.success(`${initial?.displayName ?? "Plugin"} installed`);
      onOpenChange(false);
    },
    onError: (error) => {
      appToast.error("Installing the plugin failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {initial !== null ? `Install ${initial.displayName}?` : "Add plugin"}
        </DialogTitle>
        <DialogDescription>
          {initial !== null
            ? `Install from the ${initial.marketplaceName} marketplace.`
            : "Install from npm, a Git repository, or a local path."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {initial !== null ? (
          <div className="flex items-center gap-2.5 rounded-md border border-border bg-muted/30 px-3 py-2">
            <PlaceholderBadge className="size-6" />
            <span className="text-sm font-medium text-foreground">
              {initial.displayName}
            </span>
            <span className="ml-auto font-mono text-xs text-subtle-foreground">
              {initial.entryId}@{initial.marketplaceName}
            </span>
          </div>
        ) : (
          <div>
            <Input
              value={sourceText}
              autoFocus
              placeholder="npm:@bb-plugins/linear"
              aria-label="Plugin source"
              className="h-8 font-mono text-xs"
              onChange={(event) => setSourceText(event.target.value)}
            />
            <p className="mt-1.5 text-2xs text-subtle-foreground">
              npm:package[@version] · git URL[@ref] · ./local/path
            </p>
          </div>
        )}

        <FullTrustWarning />
        <KeyValueGrid
          entries={[
            {
              key: "Source",
              value:
                initial !== null
                  ? `${initial.entryId}@${initial.marketplaceName}`
                  : sourceText.trim().length > 0
                    ? sourceText.trim()
                    : "—",
            },
            {
              key: "Provenance",
              value:
                initial !== null
                  ? `From the ${initial.marketplaceName} marketplace`
                  : "Direct install — no marketplace",
              mono: false,
            },
          ]}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={request === null || install.isPending}
          aria-busy={install.isPending}
          onClick={() => {
            if (request !== null) install.mutate(request);
          }}
        >
          {install.isPending ? (
            <Icon name="Spinner" className="animate-spin" />
          ) : null}
          Install {initial?.displayName ?? "plugin"}
        </Button>
      </DialogFooter>
    </>
  );
}
