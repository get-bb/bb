import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";
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
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  installPlugin,
  previewPluginInstall,
  type PluginInstallPreview,
  type PluginInstallRequest,
} from "@/hooks/queries/plugin-marketplace-queries";
import {
  DetailsDisclosure,
  FullTrustWarning,
  KeyValueGrid,
  LetterBadge,
  SUCCESS_BANNER_STYLE,
  SUCCESS_TEXT_STYLE,
  UPDATE_POLICY_CONSEQUENCE,
  UPDATE_POLICY_LABELS,
} from "./plugin-ui";

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
 * The two-step Add-plugin dialog (locked design "Install flow"): one smart
 * source field parsed server-side via POST /plugins/install/preview, verdict
 * banner with evidence collapsed (pre-expanded when incompatible or when
 * releases were skipped), then the full-trust confirmation as the commit
 * step. Browse installs open the same dialog pre-filled — one pipeline.
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
  const [step, setStep] = useState<"source" | "confirm">("source");
  const [sourceText, setSourceText] = useState("");
  // Server-side parsing must not fire per keystroke; the preview follows the
  // settled input.
  const [debouncedSource] = useDebounceValue(sourceText, 400);

  const request = buildRequest(initial, debouncedSource);
  const previewQuery = useQuery({
    queryKey: ["plugin-install-preview", request],
    queryFn: () => {
      if (request === null) throw new Error("no source");
      return previewPluginInstall(fetch, request);
    },
    enabled: request !== null,
    staleTime: 30_000,
    retry: false,
  });
  const preview = previewQuery.data;
  const previewError =
    previewQuery.error instanceof Error ? previewQuery.error.message : null;
  const previewPending =
    request !== null && (previewQuery.isPending || previewQuery.isFetching);

  const installable =
    preview !== undefined &&
    (preview.compatibility.outcome === "compatible" ||
      preview.compatibility.devMode);

  const install = useMutation({
    mutationFn: () => {
      const body = buildRequest(initial, debouncedSource);
      if (body === null) throw new Error("no source to install");
      return installPlugin(fetch, body);
    },
    onSuccess: () => {
      invalidatePluginList({ queryClient });
      appToast.success(
        `${preview?.plugin?.displayName ?? preview?.plugin?.id ?? "Plugin"} installed`,
      );
      onOpenChange(false);
    },
    onError: (error) => {
      appToast.error("Installing the plugin failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const pluginLabel =
    preview?.plugin?.displayName ?? preview?.plugin?.id ?? null;

  if (step === "confirm" && preview !== undefined) {
    const sourceLine =
      initial !== null
        ? `${initial.entryId}@${initial.marketplaceName}`
        : debouncedSource.trim();
    return (
      <>
        <DialogHeader>
          <DialogTitle>Install {pluginLabel ?? "plugin"}?</DialogTitle>
          <DialogDescription>Step 2 of 2 — review and confirm</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FullTrustWarning />
          <KeyValueGrid
            entries={[
              ...(preview.plugin !== null
                ? [{ key: "Plugin ID", value: preview.plugin.id }]
                : []),
              { key: "Source", value: sourceLine },
              { key: "Exact resolution", value: preview.resolved.display },
              {
                key: "Provenance",
                value:
                  initial !== null
                    ? `From the ${initial.marketplaceName} marketplace`
                    : "Direct install — no marketplace",
                mono: false,
              },
              {
                key: "Update policy",
                value:
                  preview.updatePolicyDisplay ??
                  UPDATE_POLICY_LABELS[preview.updatePolicy],
                mono: false,
              },
            ]}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={install.isPending}
            onClick={() => setStep("source")}
          >
            Back
          </Button>
          <Button
            type="button"
            disabled={install.isPending}
            aria-busy={install.isPending}
            onClick={() => install.mutate()}
          >
            {install.isPending ? (
              <Icon name="Spinner" className="animate-spin" />
            ) : null}
            Install {pluginLabel ?? "plugin"}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add plugin</DialogTitle>
        <DialogDescription>
          {initial !== null
            ? `Install from the ${initial.marketplaceName} marketplace.`
            : "Install from npm, a Git repository, or a local path."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {initial !== null ? (
          <div className="flex items-center gap-2.5 rounded-md border border-border bg-muted/30 px-3 py-2">
            <LetterBadge label={initial.displayName} className="size-6" />
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

        {previewPending ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon name="Spinner" className="size-3.5 animate-spin" />
            Resolving…
          </p>
        ) : previewError !== null ? (
          <p className="text-xs text-destructive-text" role="alert">
            {previewError}
          </p>
        ) : preview !== undefined ? (
          <PreviewVerdict preview={preview} />
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!installable || previewPending}
          onClick={() => setStep("confirm")}
        >
          Continue
        </Button>
      </DialogFooter>
    </>
  );
}

function PreviewVerdict({ preview }: { preview: PluginInstallPreview }) {
  const compatible = preview.compatibility.outcome === "compatible";
  const surprises =
    preview.skipped.length > 0 || preview.warnings.length > 0;
  const label =
    preview.plugin?.displayName ?? preview.plugin?.id ?? preview.resolved.display;
  const version = preview.resolved.version ?? preview.resolved.commit ?? "";

  return (
    <div className="space-y-2.5" data-testid="install-preview-verdict">
      {compatible ? (
        <div
          className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5"
          style={SUCCESS_BANNER_STYLE}
        >
          <LetterBadge label={label} className="size-6" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {label} {version}{" "}
              <span style={SUCCESS_TEXT_STYLE}>✓ compatible</span>
              {preview.compatibility.devMode ? (
                <span className="ml-1 text-2xs text-subtle-foreground">
                  (dev mode)
                </span>
              ) : null}
            </div>
            <div className="text-2xs text-muted-foreground">
              {preview.updatePolicyDisplay ??
                UPDATE_POLICY_CONSEQUENCE[preview.updatePolicy]}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-warning-text">
          <span aria-hidden="true">✕</span>
          <span>
            {label} {version} isn&rsquo;t compatible with this bb
            {preview.compatibility.devMode ? " (dev-mode override allowed)" : ""}
          </span>
        </div>
      )}

      {/* Auto-expands when a check failed or something surprising happened —
          in the failure case the details are the story (locked design). */}
      <DetailsDisclosure
        summary="Details — version, requirements, what was skipped"
        defaultExpanded={!compatible || surprises}
      >
        <div className="space-y-1.5">
          <KeyValueGrid
            entries={[
              { key: "Will install", value: preview.resolved.display },
            ]}
          />
          {preview.compatibility.problems.map((problem) => (
            <p key={problem} className="text-warning-text">
              {problem}
            </p>
          ))}
          {preview.skipped.map((skip) => (
            <p key={skip.version} className="text-warning-text">
              Skipped {skip.version} — {skip.reason}
            </p>
          ))}
          {preview.warnings.map((warning) => (
            <p key={warning} className="text-muted-foreground">
              {warning}
            </p>
          ))}
        </div>
      </DetailsDisclosure>
    </div>
  );
}
