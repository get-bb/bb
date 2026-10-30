import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PluginUpdateCheckEntry } from "@bb/server-contract";
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
import { appToast } from "@/components/ui/app-toast";
import { applyPluginTrackingRange } from "@/hooks/cache-owners/plugin-cache-owner";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import { setPluginTrackingRange } from "@/hooks/queries/plugin-tracking-range-queries";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import { pluginHasUpdateSurfaces } from "./PluginUpdatesCard";

export type PluginTrackingSpec =
  | { kind: "range"; range: string }
  | { kind: "dist-tag"; tag: string }
  | { kind: "latest" }
  | { kind: "none" };

export function pluginTrackingSpec(
  plugin: PluginListItem,
  source:
    | {
        range: string | null;
        npmSpecKind: string | null;
        distTag: string | null;
      }
    | null
    | undefined,
): PluginTrackingSpec | undefined {
  if (
    !pluginHasUpdateSurfaces(plugin) ||
    source === null ||
    source === undefined
  ) {
    return undefined;
  }
  if (source.range !== null) return { kind: "range", range: source.range };
  if (!plugin.source.startsWith("npm:")) return undefined;
  if (source.distTag !== null) return { kind: "dist-tag", tag: source.distTag };
  return source.npmSpecKind === "default"
    ? { kind: "latest" }
    : { kind: "none" };
}

function trackingSpecDescription(tracking: PluginTrackingSpec): string {
  switch (tracking.kind) {
    case "range":
      return `Currently ${tracking.range}.`;
    case "dist-tag":
      return `Currently follows the npm dist-tag ${tracking.tag}.`;
    case "latest":
      return "Currently follows its latest release.";
    case "none":
      return "This install follows no semver range yet.";
  }
}

function TrackingSpecLabel({ tracking }: { tracking: PluginTrackingSpec }) {
  switch (tracking.kind) {
    case "range":
      return (
        <span className="min-w-0 truncate font-mono">{tracking.range}</span>
      );
    case "dist-tag":
      return (
        <span className="min-w-0 truncate">
          <span className="font-mono">{tracking.tag}</span>
          <span className="text-muted-foreground"> dist-tag</span>
        </span>
      );
    case "latest":
      return <span>Latest release</span>;
    case "none":
      return <span className="text-muted-foreground">None</span>;
  }
}

export function trackingRangeCheckSummary(
  check: PluginUpdateCheckEntry,
): string {
  const outside =
    check.outsideRange === undefined
      ? ""
      : ` ${check.outsideRange.version} stays outside this range.`;
  if (check.outcome === "update-available") {
    const offer =
      check.candidate === undefined ? "a newer release" : check.candidate.label;
    return check.candidateBreaking === true
      ? `Offers ${offer}, which may include breaking changes.${outside}`
      : `Offers ${offer}.${outside}`;
  }
  if (check.outcome === "current") {
    return `${check.installed.label} is the newest compatible release in this range.${outside}`;
  }
  if (check.outcome === "incompatible" && check.blocked !== undefined) {
    return `${check.blocked.label} doesn’t run on this bb: ${check.blocked.reasons.join("; ")}`;
  }
  return check.detail ?? "bb couldn’t check this range.";
}

export function PluginTrackingRangeControl({
  plugin,
  tracking,
}: {
  plugin: PluginListItem;
  tracking: PluginTrackingSpec;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <TrackingSpecLabel tracking={tracking} />
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto shrink-0 p-0 text-xs"
        aria-label={`Change the update range of ${plugin.name ?? plugin.id}`}
        onClick={() => setOpen(true)}
      >
        Change range…
      </Button>
      <ChangeTrackingRangeDialog
        plugin={plugin}
        tracking={tracking}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}

interface ChangeTrackingRangeDialogProps {
  plugin: PluginListItem;
  tracking: PluginTrackingSpec;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangeTrackingRangeDialog({
  plugin,
  tracking,
  open,
  onOpenChange,
}: ChangeTrackingRangeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <ChangeTrackingRangeDialogContent
            plugin={plugin}
            tracking={tracking}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ChangeTrackingRangeDialogContent({
  plugin,
  tracking,
  onOpenChange,
}: {
  plugin: PluginListItem;
  tracking: PluginTrackingSpec;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const name = plugin.name ?? plugin.id;
  const [suggestion] = useState(() =>
    plugin.updateState.outsideRange?.suggestedRange === undefined
      ? null
      : plugin.updateState.outsideRange,
  );
  const [rangeText, setRangeText] = useState(
    suggestion?.suggestedRange ??
      (tracking.kind === "range" ? tracking.range : `^${plugin.version}`),
  );
  const range = rangeText.trim();
  const preview = useMutation({
    meta: { showErrorToast: false },
    mutationFn: (value: string) =>
      setPluginTrackingRange(fetch, {
        pluginId: plugin.id,
        range: value,
        dryRun: true,
      }),
  });
  const change = useMutation({
    meta: { showErrorToast: false },
    mutationFn: (value: string) =>
      setPluginTrackingRange(fetch, {
        pluginId: plugin.id,
        range: value,
        dryRun: false,
      }),
    onSuccess: async (result) => {
      await applyPluginTrackingRange({ queryClient, pluginId: plugin.id });
      appToast.success(`${name} now tracks ${result.range}`, {
        description: trackingRangeCheckSummary(result.check),
      });
      onOpenChange(false);
    },
  });
  const previewed =
    preview.isSuccess && preview.variables === range ? preview.data : null;
  const previewError =
    preview.isError && preview.variables === range ? preview.error : null;
  const unchanged =
    previewed !== null && previewed.previousRange === previewed.range;
  const busy = preview.isPending || change.isPending;
  const startPreview = () => {
    change.reset();
    preview.mutate(range);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Change the update range of {name}</DialogTitle>
        <DialogDescription>
          {`${trackingSpecDescription(tracking)} Choose which releases bb offers as updates.`}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Input
            value={rangeText}
            autoFocus
            aria-label="Update range"
            className="h-8 font-mono text-xs"
            onChange={(event) => {
              change.reset();
              setRangeText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && range.length > 0 && !busy) {
                event.preventDefault();
                startPreview();
              }
            }}
          />
          <p className="mt-1.5 text-2xs text-subtle-foreground">
            {suggestion === null ? (
              <>
                For example ^1.2.0, or &gt;=0.2.0 &lt;1.0.0 to follow every 0.x
                release (a 0.x minor may break).
              </>
            ) : (
              `Suggested to include ${suggestion.version}, the newest release outside ${suggestion.range}.`
            )}
          </p>
        </div>
        {previewed !== null ? (
          <div
            role="status"
            aria-label="Range preview"
            className="rounded-md border border-border bg-muted/30 px-3 py-2"
          >
            <p className="break-words text-xs text-foreground">
              {unchanged
                ? `${name} already tracks ${previewed.range}.`
                : trackingRangeCheckSummary(previewed.check)}
            </p>
            {previewed.openEnded && !unchanged ? (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning-text">
                <Icon
                  name="AlertTriangle"
                  className="mt-px size-3.5 shrink-0"
                  aria-hidden
                />
                <span className="min-w-0 break-words">
                  This range has no upper bound, so every future major release
                  will be offered as an update.
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
        {previewError !== null || change.isError ? (
          <p
            role="alert"
            className="whitespace-pre-wrap break-words text-xs text-warning-text"
          >
            {pluginAdminErrorMessage(
              change.isError ? change.error : previewError,
            )}
          </p>
        ) : null}
        <p className="text-2xs text-subtle-foreground">
          Settings, secrets, schedules, and data are kept. bb installs nothing
          until you update.
        </p>
      </div>
      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={change.isPending}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={range.length === 0 || busy}
          aria-busy={preview.isPending}
          onClick={startPreview}
        >
          {preview.isPending ? (
            <Icon name="Spinner" className="animate-spin" />
          ) : null}
          Preview
        </Button>
        <Button
          type="button"
          disabled={previewed === null || unchanged || busy}
          aria-busy={change.isPending}
          onClick={() => change.mutate(range)}
        >
          {change.isPending ? (
            <Icon name="Spinner" className="animate-spin" />
          ) : null}
          Change range
        </Button>
      </DialogFooter>
    </>
  );
}
