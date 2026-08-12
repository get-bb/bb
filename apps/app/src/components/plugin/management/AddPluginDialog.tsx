import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InstalledPlugin } from "@bb/server-contract";
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
import { pluginIconName } from "@/components/plugin/PluginIcon";
import { appToast } from "@/components/ui/app-toast.js";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import {
  applyInstalledPlugin,
  invalidatePluginCatalogSearch,
  invalidatePluginList,
} from "@/hooks/cache-owners/plugin-cache-owner";
import {
  installCatalogPlugin,
  installPlugin,
} from "@/hooks/queries/plugin-catalog-queries";
import { FullTrustWarning, PlaceholderBadge } from "./plugin-ui";

/**
 * Pre-fill for Browse-tab installs: the dialog shows the official catalog
 * entry instead of the free source field.
 */
export type AddPluginInitial = {
  entryId: string;
  displayName: string;
  icon: string | null;
};

export interface AddPluginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled?: (plugin: InstalledPlugin) => void;
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
  onInstalled,
  initial,
}: AddPluginDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <AddPluginDialogContent
            initial={initial ?? null}
            onOpenChange={onOpenChange}
            onInstalled={onInstalled}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function buildRequest(
  initial: AddPluginInitial | null,
  sourceText: string,
):
  | { kind: "catalog"; entryId: string }
  | { kind: "direct"; source: string }
  | null {
  if (initial !== null) {
    return {
      kind: "catalog",
      entryId: initial.entryId,
    };
  }
  const trimmed = sourceText.trim();
  return trimmed.length === 0 ? null : { kind: "direct", source: trimmed };
}

function AddPluginDialogContent({
  initial,
  onOpenChange,
  onInstalled,
}: {
  initial: AddPluginInitial | null;
  onOpenChange: (open: boolean) => void;
  onInstalled?: (plugin: InstalledPlugin) => void;
}) {
  const queryClient = useQueryClient();
  const [sourceText, setSourceText] = useState("");
  const request = buildRequest(initial, sourceText);

  const install = useMutation({
    mutationFn: (body: NonNullable<typeof request>) =>
      body.kind === "catalog"
        ? installCatalogPlugin(fetch, { entryId: body.entryId })
        : installPlugin(fetch, body.source),
    onSuccess: (plugin) => {
      applyInstalledPlugin({ queryClient, plugin });
      invalidatePluginList({ queryClient });
      // Search rows carry installed flags; a fresh install flips them.
      invalidatePluginCatalogSearch({ queryClient });
      appToast.success(`${initial?.displayName ?? "Plugin"} installed`);
      onOpenChange(false);
      onInstalled?.(plugin);
    },
    onError: (error) => {
      appToast.error("Installing the plugin failed", {
        description: pluginAdminErrorMessage(error),
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
            ? "Install this official plugin, bundled with BB."
            : "Install from npm, a Git repository, or a local path."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {initial !== null ? (
          <div className="flex items-center gap-2.5 rounded-md border border-border bg-muted/30 px-3 py-2">
            <PlaceholderBadge
              className="size-6"
              iconName={pluginIconName(initial.icon)}
            />
            <span className="text-sm font-medium text-foreground">
              {initial.displayName}
            </span>
            <span className="ml-auto font-mono text-xs text-subtle-foreground">
              {initial.entryId}
            </span>
          </div>
        ) : (
          <div>
            <Input
              value={sourceText}
              autoFocus
              placeholder="https://github.com/owner/bb-plugin-name"
              aria-label="Plugin source"
              className="h-8 font-mono text-xs"
              onChange={(event) => setSourceText(event.target.value)}
            />
            <p className="mt-1.5 text-2xs text-subtle-foreground">
              GitHub repository URL · npm:package[@version] · ./local/path
            </p>
          </div>
        )}

        {install.isPending ? (
          <div
            className="h-0.5 overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-label="Installing plugin"
          >
            <div className="h-full w-1/3 animate-plugin-install-progress rounded-full bg-muted-foreground" />
          </div>
        ) : (
          <FullTrustWarning />
        )}
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
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
          {install.isPending
            ? `Installing ${initial?.displayName ?? "plugin"}…`
            : `Install ${initial?.displayName ?? "plugin"}`}
        </Button>
      </DialogFooter>
    </>
  );
}
