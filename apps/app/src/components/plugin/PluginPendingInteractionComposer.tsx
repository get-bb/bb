import { useCallback, useMemo, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import type { JsonValue, PluginPendingInteraction } from "@bb/domain";
import { PluginSlotMount } from "./PluginSlotMount";
import { resolvePendingInteraction } from "@/lib/plugin-slot-resolvers";
import { usePluginSlots } from "@/lib/plugin-slots";
import { sdk } from "@/lib/sdk";

interface PluginPendingInteractionComposerProps {
  interaction: PluginPendingInteraction;
}

export function PluginPendingInteractionComposer({
  interaction,
}: PluginPendingInteractionComposerProps) {
  const { pendingInteractions } = usePluginSlots();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const origin = interaction.origin;
  const slot = useMemo(
    () =>
      resolvePendingInteraction(
        pendingInteractions,
        origin.pluginId,
        origin.rendererId,
      ),
    [origin.pluginId, origin.rendererId, pendingInteractions],
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
      await sdk.threads.interactions.cancel({
        interactionId: interaction.id,
        threadId: interaction.threadId,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      setSubmitting(false);
    }
  }, [interaction.id, interaction.threadId]);

  return (
    <section className="mb-2 rounded-lg border border-border bg-surface-recessed px-4 py-3 text-xs text-muted-foreground">
      <header className="mb-4 min-w-0">
        <h3 className="text-pretty text-sm font-semibold text-foreground">
          {interaction.payload.title}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Requested by <span className="capitalize">{origin.pluginId}</span>
        </p>
      </header>
      {slot ? (
        <PluginSlotMount
          pluginId={slot.pluginId}
          slotKind="pendingInteraction"
          slotId={slot.id}
          crashFallback={
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                The plugin form crashed. Cancel this request to continue.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void cancel()}
                disabled={submitting}
              >
                Cancel
              </Button>
            </div>
          }
        >
          <fieldset disabled={submitting}>
            <slot.component
              interaction={{
                id: interaction.id,
                threadId: interaction.threadId,
                title: interaction.payload.title,
                payload: interaction.payload.data,
                createdAt: interaction.createdAt,
                expiresAt: interaction.expiresAt ?? null,
              }}
              submit={submit}
              cancel={cancel}
            />
          </fieldset>
        </PluginSlotMount>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The plugin form is unavailable. Cancel this request to continue.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void cancel()}
            disabled={submitting}
          >
            Cancel
          </Button>
        </div>
      )}
      {error ? (
        <p
          className="mt-3 rounded-md border border-surface-destructive-border bg-surface-destructive px-2 py-1 text-xs text-destructive-text"
          aria-live="polite"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
