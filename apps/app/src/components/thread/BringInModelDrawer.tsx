import { useCallback, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PersistentResponsiveDrawerShell,
  useResponsiveDrawerRealization,
} from "@bb/shared-ui/responsive-overlay";
import { Button } from "@bb/shared-ui/button";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { PermissionMode, ThreadWithRuntime } from "@bb/domain";
import { ExecutionControls } from "@/components/promptbox/ExecutionControls";
import { useThreadHandoff } from "@/hooks/mutations/thread-handoff-mutations";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";

type BringInModelStep = "choose" | "takeover";

export interface BringInModelDrawerProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  thread: ThreadWithRuntime;
}

function createTakeoverIdempotencyKey(): string {
  return `app-handoff-${crypto.randomUUID()}`;
}

export function BringInModelDrawer({
  onOpenChange,
  open,
  thread,
}: BringInModelDrawerProps) {
  const navigate = useNavigate();
  const titleId = useId();
  const [step, setStep] = useState<BringInModelStep>("choose");
  const idempotencyKeyRef = useRef<string | null>(null);
  const { isContentRealized } = useResponsiveDrawerRealization({
    open,
    enabled: true,
  });
  const handoff = useThreadHandoff();
  const creation = useThreadCreationOptions({
    enabled: open,
    environmentId: thread.environmentId ?? undefined,
    initialProviderId: thread.providerId,
    scope: "component-local",
  });
  const selectedModelLabel =
    creation.selectedModel.length > 0 ? creation.selectedModel : "this model";

  const resetDrawer = useCallback(() => {
    setStep("choose");
    idempotencyKeyRef.current = null;
    handoff.reset();
  }, [handoff]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetDrawer();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetDrawer],
  );

  const handleTakeover = useCallback(async () => {
    const idempotencyKey =
      idempotencyKeyRef.current ?? createTakeoverIdempotencyKey();
    idempotencyKeyRef.current = idempotencyKey;
    const result = await handoff.mutateAsync({
      archiveSource: true,
      idempotencyKey,
      model: creation.selectedModel,
      permissionMode: creation.permissionMode,
      providerId: creation.selectedProviderId,
      reasoningLevel: creation.reasoningLevel,
      sourceThreadId: thread.id,
      ...(creation.serviceTier === undefined
        ? {}
        : { serviceTier: creation.serviceTier }),
    });
    handleOpenChange(false);
    navigate(
      getThreadRoutePath({
        projectId: thread.projectId,
        threadId: result.replacementThreadId,
      }),
    );
  }, [
    creation.permissionMode,
    creation.reasoningLevel,
    creation.selectedModel,
    creation.selectedProviderId,
    creation.serviceTier,
    handleOpenChange,
    handoff,
    navigate,
    thread.id,
    thread.projectId,
  ]);

  return (
    <PersistentResponsiveDrawerShell
      open={open}
      onOpenChange={handleOpenChange}
      labelledBy={titleId}
      srLabel="Bring in another model"
      contentClassName="h-[92dvh] max-h-[92dvh]"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4">
        <h2 id={titleId} className="text-base font-medium text-foreground">
          Bring in another model
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Continue {getThreadDisplayTitle(thread)} with a different model, or
          keep this thread and ask for a review later.
        </p>
        {isContentRealized ? (
          step === "choose" ? (
            <div className="mt-4 flex flex-col gap-3">
              <button
                type="button"
                aria-label="Take over this thread"
                className="rounded-lg border border-border bg-surface-raised-solid px-4 py-3 text-left"
                onClick={() => setStep("takeover")}
              >
                <div className="text-sm font-medium text-foreground">
                  Take over this thread
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Continue with another model. This thread is archived only
                  after the replacement actually starts.
                </div>
              </button>
              <button
                type="button"
                aria-label="Review this work"
                disabled
                className="rounded-lg border border-border bg-surface-raised-solid px-4 py-3 text-left opacity-60"
              >
                <div className="text-sm font-medium text-foreground">
                  Review this work
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Coming soon. Get an independent challenge without leaving
                  this thread.
                </div>
              </button>
            </div>
          ) : (
            <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
              <ExecutionControls
                providerRouting={creation.executionOptionsRouting}
                provider={{
                  options: creation.providerOptions,
                  selectedId: creation.selectedProviderId,
                  hasMultiple: creation.hasMultipleProviders,
                  displayName: creation.selectedProviderDisplayName,
                  onChange: creation.setSelectedProviderId,
                }}
                model={{
                  active: creation.activeModel
                    ? { model: creation.activeModel.model }
                    : { model: creation.selectedModel },
                  selected: creation.selectedModel,
                  options: creation.modelOptions,
                  moreOptions: creation.moreModelOptions,
                  isLoading: creation.isLoadingModels,
                  loadFailed: creation.modelLoadFailed,
                  loadError: creation.modelLoadError,
                  onChange: creation.setSelectedModel,
                }}
                serviceTier={{
                  value: creation.serviceTier,
                  onChange: creation.setServiceTier,
                  supported: creation.supportsServiceTier,
                  supportByProvider: creation.serviceTierSupportByProvider,
                }}
                reasoning={{
                  value: creation.reasoningLevel,
                  options: creation.reasoningOptions,
                  onChange: creation.setReasoningLevel,
                }}
              />
              {creation.supportsPermissionModeSelection ? (
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Permission
                  <select
                    aria-label="Permission mode"
                    className="h-8 rounded-md border border-border bg-surface-raised-solid px-2 text-sm text-foreground"
                    value={creation.permissionMode}
                    onChange={(event) =>
                      creation.setPermissionMode(
                        event.currentTarget.value as PermissionMode,
                      )
                    }
                  >
                    {creation.permissionModeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="mt-auto flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep("choose")}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={
                    handoff.isPending || creation.selectedModel.length === 0
                  }
                  onClick={() => {
                    void handleTakeover();
                  }}
                >
                  {handoff.isPending
                    ? "Continuing…"
                    : `Continue with ${selectedModelLabel}`}
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <Skeleton className="h-20 rounded-lg" />
            <Skeleton className="h-20 rounded-lg" />
          </div>
        )}
      </div>
    </PersistentResponsiveDrawerShell>
  );
}
