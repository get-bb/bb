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
import { appToast } from "@/components/ui/app-toast.js";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  applyPluginUpdate,
  type PluginUpdateResult,
} from "@/hooks/queries/plugin-marketplace-queries";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import {
  DetailsDisclosure,
  KeyValueGrid,
  RollbackNote,
  SUCCESS_TEXT_STYLE,
  UPDATE_POLICY_LABELS,
} from "./plugin-ui";

export interface UpdatePluginDialogProps {
  plugin: PluginListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Layer 3 update confirmation (sketch v2, dialogs C): verdict first, checks
 * collapsed, rollback promise always visible. The incompatible variant
 * arrives with details pre-expanded and Update disabled — the details are
 * the story. A "rolled-back" outcome renders in place instead of closing,
 * pointing at the row's Needs-attention state.
 */
export function UpdatePluginDialog({
  plugin,
  open,
  onOpenChange,
}: UpdatePluginDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <UpdatePluginDialogContent
            plugin={plugin}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function UpdatePluginDialogContent({
  plugin,
  onOpenChange,
}: {
  plugin: PluginListItem;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const displayName = plugin.displayName ?? plugin.id;
  const state = plugin.updateState;
  const [rolledBack, setRolledBack] = useState<PluginUpdateResult | null>(null);

  const update = useMutation({
    mutationFn: () => applyPluginUpdate(fetch, plugin.id),
    onSuccess: (result) => {
      invalidatePluginList({ queryClient });
      if (result.outcome === "rolled-back") {
        setRolledBack(result);
        return;
      }
      if (result.applied) {
        appToast.success(`${displayName} updated`, {
          description:
            result.to !== null ? `Now running ${result.to.display}.` : undefined,
        });
      } else {
        appToast.message(`${displayName} is already up to date`);
      }
      onOpenChange(false);
    },
    onError: (error) => {
      appToast.error(`Updating ${displayName} failed`, {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const fromLine =
    plugin.marketplaceName !== null
      ? `Currently ${plugin.version} · from ${plugin.marketplaceName}`
      : `Currently ${plugin.version}`;

  if (rolledBack !== null) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Update failed — rolled back</DialogTitle>
          <DialogDescription>{fromLine}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-start gap-2 text-sm text-destructive-text">
            <Icon name="AlertCircle" className="mt-0.5 size-4 shrink-0" />
            <span>
              {state.availableVersion ?? "The new version"} failed to start.
              bb restored {plugin.version} and its data automatically.
            </span>
          </div>
          {rolledBack.detail !== null ? (
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs text-muted-foreground">
              {rolledBack.detail}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            The plugin is marked &ldquo;Needs attention&rdquo; in the installed
            list until an update succeeds.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }

  if (state.availableVersion !== null) {
    const candidate = state.availableVersion;
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            Update {displayName} to {candidate}?
          </DialogTitle>
          <DialogDescription>{fromLine}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium" style={SUCCESS_TEXT_STYLE}>
              ✓
            </span>
            <span>Compatible with your bb and plugin SDK</span>
          </div>
          <DetailsDisclosure summary="Details — source, versions, policy">
            <KeyValueGrid
              entries={[
                ...(plugin.sourceDisplay !== null
                  ? [{ key: "Source", value: plugin.sourceDisplay }]
                  : []),
                { key: "Current", value: plugin.version },
                { key: "Candidate", value: candidate },
                ...(plugin.updatePolicy !== null
                  ? [
                      {
                        key: "Update policy",
                        value: UPDATE_POLICY_LABELS[plugin.updatePolicy],
                        mono: false,
                      },
                    ]
                  : []),
              ]}
            />
          </DetailsDisclosure>
          <RollbackNote fromVersion={plugin.version} toVersion={candidate} />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={update.isPending}
            onClick={() => onOpenChange(false)}
          >
            Not now
          </Button>
          <Button
            type="button"
            disabled={update.isPending}
            aria-busy={update.isPending}
            onClick={() => update.mutate()}
          >
            {update.isPending ? (
              <Icon name="Spinner" className="animate-spin" />
            ) : null}
            Update
          </Button>
        </DialogFooter>
      </>
    );
  }

  if (state.blockedVersion !== null) {
    const blocked = state.blockedVersion;
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            Update {displayName} to {blocked}?
          </DialogTitle>
          <DialogDescription>{fromLine}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-warning-text">
            <span aria-hidden="true">✕</span>
            <span>{blocked} isn&rsquo;t compatible with this bb</span>
          </div>
          {/* Failure case: the details ARE the story, so they arrive open. */}
          <DetailsDisclosure summary="Details" defaultExpanded>
            <div className="space-y-1.5">
              {state.blockedReasons.length > 0 ? (
                <ul className="space-y-1">
                  {state.blockedReasons.map((reason) => (
                    <li key={reason} className="text-foreground">
                      {reason}
                    </li>
                  ))}
                </ul>
              ) : null}
              <KeyValueGrid
                entries={[
                  {
                    key: "Newest compatible",
                    value: `${plugin.version} — already installed`,
                  },
                ]}
              />
            </div>
          </DetailsDisclosure>
          <p className="text-xs text-subtle-foreground">
            {blocked} will install automatically once this bb meets its
            requirements.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" disabled>
            Update
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{displayName} is up to date</DialogTitle>
        <DialogDescription>{fromLine}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}
