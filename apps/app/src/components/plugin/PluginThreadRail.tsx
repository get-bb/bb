import { useMemo, useState } from "react";
import type { ExperimentalThreadRailProps } from "@get-bb/plugin-sdk";
import { useAtomValue } from "jotai";
import { useMeasuredValue } from "@bb/shared-ui/hooks/use-measured-value";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
import { useOrderedReveal } from "@/lib/lazy-parts";
import coreThreadOutline from "@/core-contributions/thread-outline";
import { collectCoreContributionSlots } from "@/lib/core-contributions";
import {
  REPLACEMENT_RULE,
  useExclusiveResolution,
  type ExclusiveResolution,
} from "@/lib/plugin-replacement-preference";
import { threadRailOutlineProviderAtom } from "@/components/plugin/thread-rail-outline-pick";
import {
  usePluginSlotKind,
  type PluginThreadRailOutlineSlot,
  type PluginThreadRailSlot,
} from "@/lib/plugin-slots";

export const THREAD_RAIL_MIN_VISIBLE_WIDTH_PX = 56 * 16;

const [BUILT_IN_THREAD_RAIL_OUTLINE] = collectCoreContributionSlots(
  coreThreadOutline,
  "threadRailOutlines",
);
if (BUILT_IN_THREAD_RAIL_OUTLINE === undefined) {
  throw new Error("core-contributions/thread-outline registers no outline");
}

function contentInlineSize(element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  return (
    element.clientWidth -
    (Number.parseFloat(style.paddingLeft) || 0) -
    (Number.parseFloat(style.paddingRight) || 0)
  );
}

function readRailVisible(host: HTMLElement): boolean {
  return contentInlineSize(host) >= THREAD_RAIL_MIN_VISIBLE_WIDTH_PX;
}

function useThreadRailVisible(rootElement: HTMLElement | null): boolean {
  const host =
    rootElement?.closest<HTMLElement>("[data-scroll-overlay]") ?? null;
  const visible = useMeasuredValue(host, readRailVisible, false);
  return typeof ResizeObserver === "undefined" || (host !== null && visible);
}

function sortRailItems(
  slots: readonly PluginThreadRailSlot[],
): PluginThreadRailSlot[] {
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((left, right) =>
      compareGroupedPlacement(
        { group: "", order: left.slot.order },
        left.index,
        { group: "", order: right.slot.order },
        right.index,
      ),
    )
    .map(({ slot }) => slot);
}

export function usePluginThreadRailOutline(): ExclusiveResolution<PluginThreadRailOutlineSlot> {
  return useExclusiveResolution(
    usePluginSlotKind("threadRailOutlines"),
    useAtomValue(threadRailOutlineProviderAtom),
    REPLACEMENT_RULE,
  );
}

function useThreadRailOutline(): PluginThreadRailOutlineSlot | null {
  const resolution = usePluginThreadRailOutline();
  switch (resolution.kind) {
    case "plugin":
      return resolution.registration;
    case "builtin":
      return BUILT_IN_THREAD_RAIL_OUTLINE;
    case "loading":
    case "contested":
      return null;
  }
}

function BuiltInThreadRailOutline(props: ExperimentalThreadRailProps) {
  const { pluginId, id, component: Component } = BUILT_IN_THREAD_RAIL_OUTLINE;
  return (
    <PluginSlotMount
      pluginId={pluginId}
      slotKind="threadRailOutline"
      slotId={id}
      instanceId={props.threadId}
      crashFallback={null}
    >
      <Component {...props} />
    </PluginSlotMount>
  );
}

type RailEntry =
  | { kind: "outline"; slot: PluginThreadRailOutlineSlot }
  | { kind: "item"; slot: PluginThreadRailSlot };

const ORDERED_RAIL_ENTRIES = {
  key: (entry: RailEntry) =>
    `${entry.kind}/${entry.slot.pluginId}/${entry.slot.id}/${entry.slot.generation}`,
  parts: (entry: RailEntry) => [entry.slot.component],
};

interface PluginThreadRailProps {
  threadId: string;
  projectId: string;
  environmentId: string | null;
}

export function PluginThreadRail({
  threadId,
  projectId,
  environmentId,
}: PluginThreadRailProps) {
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null);
  const visible = useThreadRailVisible(rootElement);
  const outline = useThreadRailOutline();
  const items = usePluginSlotKind("threadRails");
  const entries = useOrderedReveal<RailEntry>(
    [
      ...(outline === null
        ? []
        : [{ kind: "outline" as const, slot: outline }]),
      ...sortRailItems(items).map((slot) => ({ kind: "item" as const, slot })),
    ],
    ORDERED_RAIL_ENTRIES,
  );
  const props = useMemo<ExperimentalThreadRailProps>(
    () => ({
      threadId,
      projectId,
      environment: environmentId === null ? null : { id: environmentId },
      visible,
    }),
    [environmentId, projectId, threadId, visible],
  );
  return (
    <div
      ref={setRootElement}
      data-thread-rail=""
      className={cn(
        "pointer-events-auto my-auto flex flex-col items-end gap-2",
        !visible && "hidden",
      )}
      inert={!visible}
    >
      {entries.map((entry) =>
        entry.kind === "outline" ? (
          <PluginSlotMount
            key={`${entry.slot.pluginId}/${entry.slot.id}/${entry.slot.generation}/${threadId}`}
            pluginId={entry.slot.pluginId}
            slotKind="threadRailOutline"
            slotId={entry.slot.id}
            instanceId={threadId}
            crashFallback={
              entry.slot === BUILT_IN_THREAD_RAIL_OUTLINE ? null : (
                <BuiltInThreadRailOutline {...props} />
              )
            }
          >
            <entry.slot.component {...props} />
          </PluginSlotMount>
        ) : (
          <PluginSlotMount
            key={`${entry.slot.pluginId}/${entry.slot.id}/${entry.slot.generation}/${threadId}`}
            pluginId={entry.slot.pluginId}
            slotKind="threadRail"
            slotId={entry.slot.id}
            instanceId={threadId}
            crashFallback={null}
          >
            <entry.slot.component {...props} />
          </PluginSlotMount>
        ),
      )}
    </div>
  );
}
