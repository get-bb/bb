import { useCallback, useMemo, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import type { JsonValue, PluginPendingInteraction } from "@bb/domain";
import { PluginSlotMount } from "./PluginSlotMount";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  cancelThreadPluginInteraction,
  respondToThreadPluginInteraction,
} from "@/lib/api";

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
      pendingInteractions.find(
        (candidate) =>
          candidate.pluginId === origin.pluginId &&
          candidate.id === origin.rendererId,
      ),
    [origin.pluginId, origin.rendererId, pendingInteractions],
  );

  const submit = useCallback(
    async (value: JsonValue) => {
      setSubmitting(true);
      setError(null);
      try {
        await respondToThreadPluginInteraction(
          interaction.threadId,
          interaction.id,
          value,
        );
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
      await cancelThreadPluginInteraction(interaction.threadId, interaction.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      setSubmitting(false);
    }
  }, [interaction.id, interaction.threadId]);

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <div className="text-sm font-medium text-foreground">
          {interaction.payload.title}
        </div>
        <div className="text-xs capitalize text-muted-foreground">
          Requested by {origin.pluginId}
        </div>
      </div>
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
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
