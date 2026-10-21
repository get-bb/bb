import { useState, useLayoutEffect } from "react";
import type { ExperimentalThreadContextSegmentProps } from "@get-bb/plugin-sdk";
import { hasThreadId } from "@/lib/thread-id";
import {
  usePluginSlots,
  type PluginThreadContextSegmentSlot,
} from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

function Visibility({
  slot,
  threadId,
  onVisible,
}: {
  slot: PluginThreadContextSegmentSlot;
  threadId: string;
  onVisible(
    slot: PluginThreadContextSegmentSlot,
    threadId: string,
    visible: boolean | null,
  ): void;
}) {
  const visible = slot.useVisible ? slot.useVisible({ threadId }) : true;
  if (typeof visible !== "boolean")
    throw new Error("Invalid thread context visibility");
  useLayoutEffect(() => {
    onVisible(slot, threadId, visible);
    return () => onVisible(slot, threadId, null);
  }, [slot, threadId, visible, onVisible]);
  return null;
}

export function ThreadContextSegment({
  slot,
  ...props
}: ExperimentalThreadContextSegmentProps & {
  slot: PluginThreadContextSegmentSlot;
}) {
  if (!hasThreadId(props.threadId)) return null;
  const Content = slot.component;
  return (
    <PluginSlotMount
      pluginId={slot.pluginId}
      slotKind={`threadContextSegment/${props.part}`}
      slotId={slot.id}
      instanceId={props.threadId}
      crashResetKey={String(slot.generation)}
      crashFallback={null}
    >
      <span
        role={props.part === "summary" ? "group" : undefined}
        aria-label={props.part === "summary" ? slot.title : undefined}
        className="contents"
      >
        <Content {...props} />
      </span>
    </PluginSlotMount>
  );
}

export function useThreadContextSegments(
  threadId: string | null,
  core: readonly PluginThreadContextSegmentSlot[],
) {
  const { threadContextSegments } = usePluginSlots();
  const slots = [...core, ...threadContextSegments];
  const [visibility, setVisibility] = useState<
    ReadonlyMap<
      PluginThreadContextSegmentSlot,
      { threadId: string; visible: boolean }
    >
  >(() => new Map());
  const [onVisible] = useState(
    () =>
      (
        slot: PluginThreadContextSegmentSlot,
        threadId: string,
        visible: boolean | null,
      ) => {
        setVisibility((current) => {
          const previous = current.get(slot);
          if (
            visible === null
              ? previous?.threadId !== threadId
              : previous?.threadId === threadId && previous.visible === visible
          )
            return current;
          const next = new Map(current);
          if (visible === null) next.delete(slot);
          else next.set(slot, { threadId, visible });
          return next;
        });
      },
  );
  if (!hasThreadId(threadId)) return { slots: [], observers: null };
  return {
    slots: slots.filter(
      (slot) =>
        slot.useVisible === undefined ||
        (visibility.get(slot)?.threadId === threadId &&
          visibility.get(slot)?.visible),
    ),
    observers: slots
      .filter((slot) => slot.useVisible !== undefined)
      .map((slot) => (
        <PluginSlotMount
          key={`${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}`}
          pluginId={slot.pluginId}
          slotKind="threadContextSegment/visibility"
          wrapRoot={false}
          slotId={slot.id}
          instanceId={threadId}
          crashResetKey={String(slot.generation)}
          crashFallback={null}
          onCrash={() => onVisible(slot, threadId, false)}
        >
          <Visibility slot={slot} threadId={threadId} onVisible={onVisible} />
        </PluginSlotMount>
      )),
  };
}
