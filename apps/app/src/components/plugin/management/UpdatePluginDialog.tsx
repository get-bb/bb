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
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  applyPluginUpdate,
  type PluginUpdateResult,
} from "@/hooks/queries/plugin-catalog-queries";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import {
  DetailsDisclosure,
  formatAbsoluteDate,
  KeyValueGrid,
  RollbackNote,
  SUCCESS_TEXT_STYLE,
} from "./plugin-ui";

export interface UpdatePluginDialogProps {
  plugin: PluginListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Copy naming the row state a failed update lands in. Required because the
   * two surfaces disagree — the Tools Hub row says "Update failed", the legacy
   * Settings row says "Needs attention" — and a default would let a call site
   * silently point the user at copy that surface never shows.
   */
  failureStateLabel: string;
}

/**
 * Layer 3 update confirmation (sketch v2, dialogs C): verdict first, checks
 * collapsed, rollback promise always visible. The incompatible variant
 * arrives with details pre-expanded and Update disabled — the details are
 * the story. Persisted and in-session rolled-back outcomes render in place
 * with their recovery action instead of being reduced to tooltip history.
 */
export function UpdatePluginDialog({
  plugin,
  open,
  onOpenChange,
  failureStateLabel,
}: UpdatePluginDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <UpdatePluginDialogContent
            plugin={plugin}
            onOpenChange={onOpenChange}
            failureStateLabel={failureStateLabel}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function UpdatePluginDialogContent({
  plugin,
  onOpenChange,
  failureStateLabel,
}: {
  plugin: PluginListItem;
  onOpenChange: (open: boolean) => void;
  failureStateLabel: string;
}) {
  const queryClient = useQueryClient();
  const name = plugin.name ?? plugin.id;
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
        appToast.success(`${name} updated`, {
          description:
            result.to !== null
              ? `Now running ${result.to.display}.`
              : undefined,
        });
      } else {
        appToast.message(`${name} is already up to date`);
      }
      onOpenChange(false);
    },
    onError: (error) => {
      appToast.error(`Updating ${name} failed`, {
        description: pluginAdminErrorMessage(error),
      });
    },
  });

  const fromLine = `Currently ${plugin.version}`;
  const persistedFailure = state.lastFailure;
  const failure =
    rolledBack !== null
      ? {
          version:
            rolledBack.to?.display ??
            state.availableVersion ??
            "The new version",
          at: null,
          detail: rolledBack.detail ?? "",
        }
      : persistedFailure === null
        ? null
        : persistedFailure;

  if (failure !== null) {
    const retryVersion = state.availableVersion;
    return (
      <>
        <DialogHeader>
          <DialogTitle>Update failed</DialogTitle>
          <DialogDescription>
            {failure.at === null
              ? "The update couldn’t be completed."
              : `Failed on ${formatAbsoluteDate(failure.at)}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-start gap-2 text-sm">
            <Icon
              name="CircleX"
              className="mt-0.5 size-4 shrink-0 text-destructive"
              aria-hidden
            />
            <span>
              bb couldn&rsquo;t activate {failure.version}. It restored{" "}
              {plugin.version} and its data.
            </span>
          </div>
          {failure.detail.length > 0 ? (
            <DetailsDisclosure
              key="failure-details"
              summary="Technical details"
              defaultExpanded
            >
              <p className="break-words font-mono text-foreground">
                {failure.detail}
              </p>
            </DetailsDisclosure>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {retryVersion === null
              ? `The restored version can keep running. Try again when a compatible update becomes available.`
              : `A compatible update to ${retryVersion} is still available. Retry when you’re ready.`}
          </p>
          {rolledBack === null ? null : (
            <p className="text-xs text-subtle-foreground">
              The plugin is marked &ldquo;{failureStateLabel}&rdquo; in the
              installed list until an update succeeds.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          {retryVersion === null ? null : (
            <Button
              type="button"
              disabled={update.isPending}
              aria-busy={update.isPending}
              aria-label={`Retry update to ${retryVersion}`}
              onClick={() => update.mutate()}
            >
              {update.isPending ? (
                <Icon name="Spinner" className="animate-spin" />
              ) : null}
              Retry update
            </Button>
          )}
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
            Update {name} to {candidate}?
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
          <DetailsDisclosure summary="Details — source, versions">
            <KeyValueGrid
              entries={[
                { key: "Source", value: plugin.sourceDisplay },
                { key: "Current", value: plugin.version },
                { key: "Candidate", value: candidate },
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
            Update {name} to {blocked}?
          </DialogTitle>
          <DialogDescription>{fromLine}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Icon
              name="AlertTriangle"
              className="size-4 shrink-0 text-warning"
              aria-hidden
            />
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
            You can update to {blocked} once this bb meets its requirements.
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
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
        <DialogTitle>{name} is up to date</DialogTitle>
        <DialogDescription>{fromLine}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          Close
        </Button>
      </DialogFooter>
    </>
  );
}
