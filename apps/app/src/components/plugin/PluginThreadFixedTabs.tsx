import type { JsonValue } from "@get-bb/plugin-sdk";
import { hasThreadId } from "@/lib/thread-id";
import type { SecondaryPanelFixedTab } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { PluginItemIcon } from "./PluginIcon";
import { usePluginFrontendsSettled } from "@/lib/plugin-frontend-boot-state";
import { coreThreadFixedTabs } from "@/components/secondary-panel/thread-info-registration";
import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import {
  createPluginFixedPanelTab,
  createThreadInfoFixedPanelTab,
  type FixedPanelViewTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  type AppFixedTabDestination,
  AppFixedTabTargetProvider,
  createValidatedFixedTabDestination,
  threadFixedTabTargetKey,
  useFixedTabSessionTarget,
  getThreadFixedTabOwnerId,
} from "@/lib/app-fixed-tab-navigation";
import type { AppFixedTabReference } from "@/lib/app-navigation-host";
import {
  usePluginSlots,
  type PluginThreadFixedTabSlot,
} from "@/lib/plugin-slots";
import { THREAD_INFO_FIXED_TAB_REFERENCE } from "@/components/secondary-panel/thread-info-fixed-tab-navigation";
import { PluginSlotMount } from "./PluginSlotMount";

export interface ThreadFixedTabEntry {
  slot: PluginThreadFixedTabSlot;
  tab: FixedPanelViewTab;
  reference: AppFixedTabReference;
}

export function createThreadFixedTabDestination(
  entry: ThreadFixedTabEntry,
  select: (entry: ThreadFixedTabEntry, toggle: boolean) => void,
  deliver?: (target: JsonValue) => void,
): AppFixedTabDestination {
  return createValidatedFixedTabDestination({
    tab: entry.reference,
    contract:
      deliver === undefined ? undefined : entry.slot.experimental_target,
    deliver: (target) => deliver?.(target),
    select: (toggle) => select(entry, toggle),
  });
}

export function buildThreadFixedPanelViewTabs({
  entries,
}: {
  entries: readonly ThreadFixedTabEntry[];
}): readonly FixedPanelViewTab[] {
  return [...entries.map((entry) => entry.tab)];
}

export function createThreadFixedTabDescriptor(
  entry: ThreadFixedTabEntry,
  threadId: string,
  open: (reference: AppFixedTabReference) => void,
): SecondaryPanelFixedTab {
  const tooltip = entry.slot.tooltip ?? entry.slot.title;
  return {
    ariaLabel: `Show ${tooltip.toLowerCase()} panel`,
    label: entry.slot.title,
    leadingVisual: (
      <PluginItemIcon pluginId={entry.slot.pluginId} icon={entry.slot.icon} />
    ),
    onSelect: () => open(entry.reference),
    tab: entry.tab,
    title: tooltip,
    ...(entry.slot.experimental_shortcutCommandId === undefined
      ? {}
      : {
          shortcutCommandId:
            `plugin:${entry.slot.pluginId}/${entry.slot.experimental_shortcutCommandId}` as const,
        }),
    contentFillsRegion: entry.slot.layout === "flush",
    renderContent: () => (
      <ThreadFixedTabContent entry={entry} threadId={threadId} />
    ),
  };
}

function SlotScope({
  slot,
  threadId,
  children,
  crashFallback,
}: {
  crashFallback?: ReactNode;
  slot: PluginThreadFixedTabSlot;
  threadId: string;
  children: ReactNode;
}) {
  return (
    <PluginSlotMount
      pluginId={slot.pluginId}
      slotKind="threadFixedTab"
      slotId={slot.id}
      instanceId={threadId}
      crashResetKey={String(slot.generation)}
      {...(crashFallback === undefined ? {} : { crashFallback })}
    >
      {children}
    </PluginSlotMount>
  );
}

export function ThreadFixedTabContent({
  entry,
  threadId,
}: {
  entry: ThreadFixedTabEntry;
  threadId: string;
}) {
  const targetState = useFixedTabSessionTarget(
    threadFixedTabTargetKey(threadId, entry.reference),
    entry.reference,
  );
  if (!hasThreadId(threadId)) return null;
  const Component = entry.slot.component;
  return (
    <SlotScope slot={entry.slot} threadId={threadId}>
      <AppFixedTabTargetProvider state={targetState}>
        <Component threadId={threadId} />
      </AppFixedTabTargetProvider>
    </SlotScope>
  );
}

interface VisibilityProps {
  slot: PluginThreadFixedTabSlot;
  threadId: string;
  onVisibility(
    slot: PluginThreadFixedTabSlot,
    threadId: string,
    visible: boolean | null,
  ): void;
}

function VisibilityResult({
  slot,
  threadId,
  onVisibility,
  visible,
}: VisibilityProps & { visible: boolean }) {
  useLayoutEffect(() => {
    onVisibility(slot, threadId, visible);
    return () => onVisibility(slot, threadId, null);
  }, [slot, threadId, visible, onVisibility]);
  return null;
}

function Visibility(props: VisibilityProps) {
  const useVisible = props.slot.useVisible;
  const visible = useVisible?.({ threadId: props.threadId }) ?? true;
  return <VisibilityResult {...props} visible={visible} />;
}

export function useThreadFixedTabs({ threadId }: { threadId: string | null }) {
  const { threadFixedTabs } = usePluginSlots();
  const [visibility, setVisibility] = useState<
    ReadonlyMap<
      PluginThreadFixedTabSlot,
      { threadId: string; visible: boolean }
    >
  >(() => new Map());
  const [onVisibility] = useState(
    () =>
      (
        slot: PluginThreadFixedTabSlot,
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
          if (visible !== null) next.set(slot, { threadId, visible });
          else next.delete(slot);
          return next;
        });
      },
  );
  const entries = useMemo<readonly ThreadFixedTabEntry[]>(
    () =>
      !hasThreadId(threadId)
        ? []
        : threadFixedTabs
            .filter(
              (slot) =>
                slot.useVisible === undefined ||
                (visibility.get(slot)?.threadId === threadId &&
                  visibility.get(slot)?.visible === true),
            )
            .map((slot) => ({
              slot,
              tab: coreThreadFixedTabs.includes(slot)
                ? createThreadInfoFixedPanelTab()
                : createPluginFixedPanelTab({
                    pluginId: slot.pluginId,
                    tabId: slot.id,
                  }),
              reference: coreThreadFixedTabs.includes(slot)
                ? THREAD_INFO_FIXED_TAB_REFERENCE
                : {
                    ownerId: getThreadFixedTabOwnerId(slot.pluginId),
                    tabId: slot.id,
                  },
            })),
    [threadFixedTabs, visibility, threadId],
  );
  const observers = !hasThreadId(threadId)
    ? []
    : threadFixedTabs
        .filter((slot) => slot.useVisible !== undefined)
        .map((slot) => (
          <SlotScope
            key={`${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}/visibility`}
            slot={slot}
            threadId={`${threadId}/visibility`}
            crashFallback={
              <VisibilityResult
                slot={slot}
                threadId={threadId}
                onVisibility={onVisibility}
                visible={false}
              />
            }
          >
            <Visibility
              slot={slot}
              threadId={threadId}
              onVisibility={onVisibility}
            />
          </SlotScope>
        ));
  const frontendsSettled = usePluginFrontendsSettled();
  const isReady =
    hasThreadId(threadId) &&
    frontendsSettled &&
    threadFixedTabs.every(
      (slot) =>
        slot.useVisible === undefined ||
        visibility.get(slot)?.threadId === threadId,
    );
  return { entries, observers, isReady };
}
