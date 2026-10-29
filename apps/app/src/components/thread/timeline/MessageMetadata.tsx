import { memo, Suspense, useMemo } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import type {
  ExperimentalMessageMetadataContext,
  ExperimentalMessageMetadataPlacement,
} from "@get-bb/plugin-sdk";
import type { PluginMessageMetadataSlot } from "@/lib/plugin-slots.js";
import { PluginSlotMount } from "../../plugin/PluginSlotMount.js";
import {
  ACTION_ROW_METADATA_CLASS,
  BUBBLE_ALIGN_INSET_CLASS,
  PROSE_COLUMN_INSET_CLASS,
} from "./MessageActionBar.js";

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
    (slot) => (slot.placement ?? "above") === placement,
  );
  if (contributions.length === 0) return null;
  return (
    <div
      className={
        placement === "actionRow"
          ? ACTION_ROW_METADATA_CLASS
          : cn(
              "flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground",
              role === "user"
                ? cn("justify-end", BUBBLE_ALIGN_INSET_CLASS)
                : cn("justify-start", PROSE_COLUMN_INSET_CLASS),
              "has-[>*>*]:mb-1",
            )
      }
      aria-label="Message metadata"
      data-message-action-metadata={placement === "actionRow" ? "" : undefined}
    >
      {contributions.map((slot) =>
        slot.pluginId === "core" ? (
          <div key={`core/${slot.id}`} className="contents">
            <slot.component message={message} />
          </div>
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
