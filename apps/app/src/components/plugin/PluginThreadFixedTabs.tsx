import { hasThreadId } from "@/lib/thread-id";
import { pluginCommandId, type PluginCommandId } from "@bb/domain";
import type { SecondaryPanelFixedTab } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { PluginItemIcon } from "./PluginIcon";
import type { AppShortcutPresentation } from "@/lib/app-keybindings";
import { useMemo } from "react";
import {
  createPluginFixedPanelTab,
  type FixedPanelViewTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  AppFixedTabTargetProvider,
  getThreadFixedTabOwnerId,
  useFixedTabTargetState,
} from "@/lib/app-fixed-tab-navigation";
import type {
  ExperimentalThreadFixedTabProps,
  JsonValue,
} from "@get-bb/plugin-sdk";
import type { AppFixedTabReference } from "@/lib/app-navigation-host";
import { isThreadTab, type PluginThreadFixedTabSlot } from "@/lib/plugin-slots";
import {
  PluginTabScope,
  usePluginTabs,
  type PluginTabContext,
} from "./PluginTabs";

export interface ThreadFixedTabEntry {
  slot: PluginThreadFixedTabSlot;
  tab: FixedPanelViewTab;
  reference: AppFixedTabReference;
}

export type ThreadFixedTabEnvironment = Omit<
  ExperimentalThreadFixedTabProps,
  "threadId" | "isOpen"
>;

function ThreadFixedTabContent({
  entry,
  threadId,
  environment,
  isOpen,
}: {
  entry: ThreadFixedTabEntry;
  threadId: string;
  environment: ThreadFixedTabEnvironment;
  isOpen: boolean;
}) {
  const targetState = useFixedTabTargetState({
    stateKey: threadId,
    ownerId: entry.reference.ownerId,
    tabId: entry.reference.tabId,
  });
  const Component = entry.slot.component;
  return (
    <PluginTabScope slot={entry.slot} instanceId={threadId}>
      <AppFixedTabTargetProvider state={targetState}>
        <Component threadId={threadId} {...environment} isOpen={isOpen} />
      </AppFixedTabTargetProvider>
    </PluginTabScope>
  );
}

export function acceptsFixedTabTarget(
  entry: ThreadFixedTabEntry,
  target: JsonValue,
): boolean {
  const contract = entry.slot.experimental_target;
  if (contract === undefined) return false;
  try {
    return contract.validate(target);
  } catch {
    return false;
  }
}

export function threadFixedTabShortcutCommand(
  entry: ThreadFixedTabEntry,
): PluginCommandId | null {
  const commandId =
    entry.slot.availability === "fixed"
      ? entry.slot.experimental_shortcutCommandId
      : undefined;
  return commandId === undefined
    ? null
    : pluginCommandId(entry.slot.pluginId, commandId);
}

export function createThreadFixedTabDescriptor(
  entry: ThreadFixedTabEntry,
  threadId: string,
  environment: ThreadFixedTabEnvironment,
  open: (reference: AppFixedTabReference) => void,
  shortcut: AppShortcutPresentation | null,
) {
  const tooltip = entry.slot.tooltip ?? entry.slot.title;
  return {
    ariaLabel: `Show ${tooltip.toLowerCase()} panel`,
    label: entry.slot.title,
    leadingVisual: (
      <PluginItemIcon pluginId={entry.slot.pluginId} icon={entry.slot.icon} />
    ),
    onSelect: () => open(entry.reference),
    shortcut,
    tab: entry.tab,
    title: tooltip,
    contentFillsRegion: entry.slot.layout === "flush",
    renderContent: (pane) => (
      <ThreadFixedTabContent
        entry={entry}
        threadId={threadId}
        environment={environment}
        isOpen={pane.isOpen}
      />
    ),
  } satisfies SecondaryPanelFixedTab;
}

export function useThreadFixedTabs({
  threadId,
  environment,
}: {
  threadId: string | null;
  environment: ThreadFixedTabEnvironment;
}) {
  const environmentId = environment.environment?.id ?? null;
  const { environmentState, threadArchived } = environment;
  const context = useMemo<PluginTabContext | null>(
    () =>
      hasThreadId(threadId)
        ? {
            kind: "thread",
            threadId,
            environment: environmentId === null ? null : { id: environmentId },
            environmentState,
            threadArchived,
          }
        : null,
    [threadId, environmentId, environmentState, threadArchived],
  );
  const { slots, observers, isReady } = usePluginTabs(context);
  const entries = useMemo<readonly ThreadFixedTabEntry[]>(
    () =>
      slots
        .filter(isThreadTab)
        .filter(
          (slot): slot is PluginThreadFixedTabSlot =>
            slot.availability === "fixed",
        )
        .map((slot) => ({
          slot,
          tab: createPluginFixedPanelTab({
            pluginId: slot.pluginId,
            tabId: slot.id,
          }),
          reference: {
            ownerId: getThreadFixedTabOwnerId(slot.pluginId),
            tabId: slot.id,
          },
        })),
    [slots],
  );
  const actions = useMemo(
    () =>
      slots
        .filter(isThreadTab)
        .filter(
          (slot): slot is Extract<typeof slot, { availability: "action" }> =>
            slot.availability === "action",
        ),
    [slots],
  );
  return { entries, actions, observers, isReady };
}
