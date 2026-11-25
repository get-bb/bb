import { useMemo, useState } from "react";
import type { ExperimentalThreadRailProps } from "@get-bb/plugin-sdk";
import { useAtomValue } from "jotai";
import { useMeasuredValue } from "@bb/shared-ui/hooks/use-measured-value";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
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
      {outline === null ? null : (
        <PluginSlotMount
          key={`${outline.pluginId}/${outline.id}/${outline.generation}/${threadId}`}
          pluginId={outline.pluginId}
          slotKind="threadRailOutline"
          slotId={outline.id}
          instanceId={threadId}
          crashFallback={
            outline === BUILT_IN_THREAD_RAIL_OUTLINE ? null : (
              <BuiltInThreadRailOutline {...props} />
            )
          }
        >
          <outline.component {...props} />
        </PluginSlotMount>
      )}
      {sortRailItems(items).map(
        ({ pluginId, id, generation, component: Component }) => (
          <PluginSlotMount
            key={`${pluginId}/${id}/${generation}/${threadId}`}
            pluginId={pluginId}
            slotKind="threadRail"
            slotId={id}
            instanceId={threadId}
            crashFallback={null}
          >
            <Component {...props} />
          </PluginSlotMount>
        ),
      )}
    </div>
  );
}
