import { hasThreadId } from "@/lib/thread-id";
import {
  memo,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  PluginThreadAction,
  PluginThreadActionsInlineItem,
  PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  usePluginSlots,
  type PluginThreadHeaderActionSlot,
} from "@/lib/plugin-slots";
import { useCoreThreadHeaderActions } from "@/components/thread/core-thread-header-actions";

const OverflowCollector = memo(function OverflowCollector({
  slot,
  input,
  onActions,
}: {
  slot: PluginThreadHeaderActionSlot;
  input: PluginThreadHeaderActionProps;
  onActions(
    slot: PluginThreadHeaderActionSlot,
    threadId: string,
    actions: readonly PluginThreadAction[] | null,
  ): void;
}) {
  const useOverflowActions = slot.experimental_useOverflowActions;
  const actions = useOverflowActions?.(input);
  if (
    !Array.isArray(actions) ||
    actions.some(
      (action) =>
        action === null ||
        typeof action !== "object" ||
        typeof action.icon !== "string" ||
        typeof action.label !== "string" ||
        typeof action.run !== "function",
    )
  )
    throw new Error("Invalid header overflow actions");
  useLayoutEffect(() => {
    if (actions) onActions(slot, input.threadId, actions);
    return () => onActions(slot, input.threadId, null);
  }, [actions, input.threadId, onActions, slot]);
  return null;
});

function HeaderControl({
  slot,
  input,
}: {
  slot: PluginThreadHeaderActionSlot;
  input: PluginThreadHeaderActionProps;
}) {
  const Content = slot.component;
  return (
    <PluginSlotMount
      pluginId={slot.pluginId}
      slotKind="threadHeaderAction"
      slotId={slot.id}
      instanceId={input.threadId}
      crashResetKey={String(slot.generation)}
      crashFallback={null}
    >
      <span
        role="group"
        aria-label={slot.title}
        className="flex max-h-7 max-w-64 shrink-0 items-center"
      >
        <Content {...input} />
      </span>
    </PluginSlotMount>
  );
}

export function PluginThreadHeaderActions({
  threadId,
  projectId,
  children,
}: {
  threadId: string;
  projectId: string;
  children(input: {
    actions: readonly PluginThreadActionsInlineItem[];
    controls(overflow: boolean): ReactNode;
  }): ReactNode;
}) {
  const { threadHeaderActions } = usePluginSlots();
  const isCompactViewport = useIsCompactViewport();
  const input = useMemo(
    () => ({ threadId, projectId, isCompactViewport }),
    [threadId, projectId, isCompactViewport],
  );
  const [results, setResults] = useState<
    ReadonlyMap<
      PluginThreadHeaderActionSlot,
      { threadId: string; actions: readonly PluginThreadAction[] }
    >
  >(() => new Map());
  const [onActions] = useState(
    () =>
      (
        slot: PluginThreadHeaderActionSlot,
        threadId: string,
        actions: readonly PluginThreadAction[] | null,
      ) =>
        setResults((current) => {
          if (
            actions === null
              ? !current.has(slot)
              : current.get(slot)?.threadId === threadId &&
                current.get(slot)?.actions === actions
          )
            return current;
          const next = new Map(current);
          if (actions === null) next.delete(slot);
          else next.set(slot, { threadId, actions });
          return next;
        }),
  );
  const coreActions = useCoreThreadHeaderActions();
  const slots = hasThreadId(threadId)
    ? [...threadHeaderActions, ...coreActions]
    : [];
  const actions = slots.flatMap((slot) =>
    results.get(slot)?.threadId === threadId
      ? (results.get(slot)?.actions ?? []).map((action, index) => ({
          key: `${slot.pluginId}/${slot.id}/${index}`,
          group: "0_header",
          action,
        }))
      : [],
  );
  return (
    <>
      {slots
        .filter((slot) => slot.experimental_useOverflowActions)
        .map((slot) => (
          <PluginSlotMount
            key={`${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}/overflow`}
            pluginId={slot.pluginId}
            slotKind="threadHeaderAction/overflow"
            wrapRoot={false}
            slotId={slot.id}
            instanceId={threadId}
            crashResetKey={String(slot.generation)}
            crashFallback={null}
          >
            <OverflowCollector
              slot={slot}
              input={input}
              onActions={onActions}
            />
          </PluginSlotMount>
        ))}
      {children({
        actions,
        controls: (overflow) =>
          slots
            .filter(
              (slot) => !overflow || !slot.experimental_useOverflowActions,
            )
            .map((slot) => (
              <HeaderControl
                key={`${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}`}
                slot={slot}
                input={input}
              />
            )),
      })}
    </>
  );
}
