import { memo, Suspense, useMemo } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import type {
  ExperimentalMessageMetadataContext,
  ExperimentalMessageMetadataPlacement,
} from "@get-bb/plugin-sdk";
import type { PluginMessageMetadataSlot } from "@/lib/plugin-slots.js";
import { PluginSlotMount } from "../../plugin/PluginSlotMount.js";
import { ACTION_ROW_METADATA_CLASS } from "./MessageActionBar.js";

export type MessageMetadataProps = {
  slots: readonly PluginMessageMetadataSlot[];
  id: string;
  threadId: string;
  createdAt: number;
  turnId: string | null;
} & (
  | { role: "user"; initiator: "user" | "agent" | "system" }
  | { role: "assistant"; initiator?: never }
);

export const MessageMetadata = memo(function MessageMetadata({
  slots,
  placement,
  id,
  threadId,
  role,
  createdAt,
  turnId,
  initiator,
}: MessageMetadataProps & {
  placement: ExperimentalMessageMetadataPlacement;
}) {
  const message = useMemo<ExperimentalMessageMetadataContext>(
    () => ({
      id,
      threadId,
      createdAt,
      turnId,
      ...(role === "user" ? { role, initiator } : { role }),
    }),
    [id, threadId, role, createdAt, turnId, initiator],
  );
  const contributions = slots.filter(
    (slot) => (slot.placement ?? "below") === placement,
  );
  if (contributions.length === 0) return null;
  return (
    <div
      className={
        placement === "actions"
          ? ACTION_ROW_METADATA_CLASS
          : cn(
              "flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground",
              role === "user" ? "justify-end" : "justify-start",
              placement === "above" && "mb-1",
            )
      }
      aria-label="Message metadata"
      data-message-action-metadata={placement === "actions" ? "" : undefined}
    >
      {contributions.map((slot) =>
        slot.pluginId === "core" ? (
          <slot.component key={`core/${slot.id}`} message={message} />
        ) : (
          <PluginSlotMount
            key={`${slot.pluginId}/${slot.id}/${slot.generation}`}
            pluginId={slot.pluginId}
            slotKind="messageMetadata"
            slotId={slot.id}
            instanceId={id}
            crashFallback={null}
          >
            <Suspense fallback={null}>
              <slot.component message={message} />
            </Suspense>
          </PluginSlotMount>
        ),
      )}
    </div>
  );
});
