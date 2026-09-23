import {
  PendingInteractionShell,
  type PendingInteractionSourceThread,
} from "@/components/thread/pending-interactions/PendingInteractionShell";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import type { JsonValue, PendingInteraction } from "@bb/domain";
import { PluginSlotMount } from "./PluginSlotMount";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { resolvePendingInteraction } from "@/lib/plugin-slot-resolvers";
import { usePluginDisplayName } from "@/lib/plugin-logos";
import { usePluginFrontendsSettled } from "@/lib/plugin-frontend-boot-state";
import { usePluginSlots } from "@/lib/plugin-slots";
import { useStopThread } from "@/hooks/mutations/thread-runtime-mutations";
import { sdk } from "@/lib/sdk";

export interface PluginPendingInteractionRequest {
  pluginId: string;
  rendererId: string;
  title: string;
  data: JsonValue;
}

interface PluginPendingInteractionComposerProps {
  interaction: Pick<
    PendingInteraction,
    "id" | "threadId" | "createdAt" | "expiresAt"
  >;
  request: PluginPendingInteractionRequest;
  origin: "plugin" | "provider";
  sourceThread?: PendingInteractionSourceThread;
}

export function PluginPendingInteractionComposer({
  interaction,
  request,
  origin,
  sourceThread,
}: PluginPendingInteractionComposerProps) {
  const { pendingInteractions } = usePluginSlots();
  const pluginName = usePluginDisplayName(request.pluginId);
  const pluginsSettled = usePluginFrontendsSettled();
  const stopThread = useStopThread();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const slot = useMemo(
    () =>
      resolvePendingInteraction(
        pendingInteractions,
        request.pluginId,
        request.rendererId,
      ),
    [request.pluginId, request.rendererId, pendingInteractions],
  );
  const submit = useCallback(
    async (value: JsonValue) => {
      setSubmitting(true);
      setError(null);
      try {
        await sdk.threads.interactions.respond({
          interactionId: interaction.id,
          threadId: interaction.threadId,
          value,
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      } finally {
        setSubmitting(false);
      }
    },
    [interaction.id, interaction.threadId],
  );

  const cancel = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (origin === "provider") {
        await stopThread.mutateAsync(interaction.threadId);
      } else {
        await sdk.threads.interactions.cancel({
          interactionId: interaction.id,
          threadId: interaction.threadId,
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      setSubmitting(false);
    }
  }, [origin, interaction.id, interaction.threadId, stopThread]);
  const dismissLabel = origin === "plugin" ? "Cancel" : "Stop turn";

  return (
    <PendingInteractionShell
      key={interaction.id}
      label={request.title}
      initiallyExpanded
      errorMessage={error}
      sourceThread={sourceThread}
      testId="plugin-interaction-shell"
    >
      {() => (
        <>
          <p className="mb-4 text-xs text-muted-foreground">
            {origin === "plugin"
              ? `Requested by ${pluginName}`
              : `Asked by the agent through ${pluginName}`}
          </p>
          {slot ? (
            <PluginSlotMount
              pluginId={slot.pluginId}
              slotKind="pendingInteraction"
              slotId={slot.id}
              crashFallback={
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    The plugin form crashed. {dismissLabel} to continue.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void cancel()}
                    disabled={submitting}
                  >
                    {dismissLabel}
                  </Button>
                </div>
              }
            >
              <fieldset disabled={submitting}>
                <slot.component
                  interaction={{
                    id: interaction.id,
                    threadId: interaction.threadId,
                    title: request.title,
                    payload: request.data,
                    createdAt: interaction.createdAt,
                    expiresAt: interaction.expiresAt ?? null,
                  }}
                  submit={submit}
                  cancel={cancel}
                />
              </fieldset>
            </PluginSlotMount>
          ) : pluginsSettled ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                The plugin form is unavailable. {dismissLabel} to continue.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void cancel()}
                disabled={submitting}
              >
                {dismissLabel}
              </Button>
            </div>
          ) : (
            <div
              className="space-y-3"
              aria-busy="true"
              aria-label={`Loading the ${pluginName} form`}
              data-testid="plugin-interaction-loading"
            >
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-9 w-full" />
            </div>
          )}
        </>
      )}
    </PendingInteractionShell>
  );
}
