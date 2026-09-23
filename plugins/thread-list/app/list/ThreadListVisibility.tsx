import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAtom } from "jotai";
import type { SidebarThread } from "../model/sidebar-thread.js";
import type { SidebarSectionId } from "../model/sidebar-section-id.js";
import { getCollapsedChildActivity } from "../model/thread-activity.js";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { useSidebarThreadDraftIds } from "@get-bb/plugin-sdk/app";
import { ActionMenuSeparator } from "../ui/action-menu-items.js";
import { SidebarContentElementContext } from "../ui/sidebar.js";
import { reorderStoredOrder } from "../model/stored-order.js";
import { sidebarHiddenGroupsAtom } from "../preferences/atoms.js";
import { CollapsedThreadStatusGlyph } from "../rows/ThreadRow.js";
import { usePluginThreadRowStatusForThreads } from "./groupRollups.js";
import {
  SidebarMore,
  SidebarOverflowItem,
  SidebarVisibilityCustomize,
  SidebarVisibilityActionContent,
  SidebarCustomizeActionContent,
  type SidebarVisibilityItem,
} from "./SidebarVisibilityControls.js";

export interface ThreadListVisibilityGroup extends SidebarVisibilityItem {
  id: SidebarSectionId;
  threads: readonly SidebarThread[];
  renderContent: (close: () => void) => ReactNode;
  onNewThread?: () => void;
}

interface ThreadListVisibilityState {
  hiddenGroups: readonly ThreadListVisibilityGroup[];
  hide: (id: string) => void;
  restore: (id: string) => void;
  customize: () => void;
  label: string;
  selectedThreadId?: string;
}

const VisibilityContext = createContext<ThreadListVisibilityState | null>(null);
const GroupContext = createContext<string | null>(null);

export function ThreadListVisibility({
  groups,
  order,
  onOrderChange,
  label,
  selectedThreadId,
  children,
}: {
  groups: readonly ThreadListVisibilityGroup[];
  order: readonly SidebarSectionId[];
  onOrderChange: (order: SidebarSectionId[]) => void;
  label: string;
  selectedThreadId?: string;
  children: ReactNode;
}) {
  const [hidden, setHidden] = useAtom(sidebarHiddenGroupsAtom);
  const [customizing, setCustomizing] = useState(false);
  const compact = useIsCompactViewport();
  const container = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<string | null>(null);
  const hiddenIds = useMemo(() => new Set(hidden), [hidden]);
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const orderedGroups = order.flatMap((id) => {
    const group = groupsById.get(id);
    return group ? [group] : [];
  });
  const setVisible = (id: string, visible: boolean) => {
    setHidden((current) =>
      visible
        ? current.filter((key) => key !== id)
        : current.includes(id)
          ? current
          : [...current, id],
    );
  };
  useEffect(() => {
    if (focusTarget.current === null || customizing) return;
    const id = focusTarget.current;
    focusTarget.current = null;
    const frame = requestAnimationFrame(() => {
      const root = container.current;
      const target =
        id === "more"
          ? root?.querySelector<HTMLElement>(
              '[data-testid="sidebar-thread-list-more-trigger"]',
            )
          : Array.from(
              root?.querySelectorAll<HTMLElement>(
                "[data-sidebar-visibility-group]",
              ) ?? [],
            )
              .find((element) => element.dataset.sidebarVisibilityGroup === id)
              ?.querySelector<HTMLElement>(
                'button[aria-label$=" actions"], button',
              );
      (target ?? root)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [hidden, customizing]);
  const value: ThreadListVisibilityState = {
    hiddenGroups: orderedGroups.filter((group) => hiddenIds.has(group.id)),
    label,
    selectedThreadId,
    customize: () => setCustomizing(true),
    hide: (id) => {
      focusTarget.current = "more";
      setVisible(id, false);
    },
    restore: (id) => {
      focusTarget.current = id;
      setVisible(id, true);
    },
  };
  return (
    <VisibilityContext.Provider value={value}>
      <div ref={container} tabIndex={-1} className="min-w-0 outline-none">
        {customizing ? (
          <SidebarVisibilityCustomize
            items={orderedGroups}
            visibleIds={orderedGroups
              .filter((group) => !hiddenIds.has(group.id))
              .map((group) => group.id)}
            onVisibleChange={setVisible}
            onReorder={(activeId, overId) => {
              const groupIds = orderedGroups.map((group) => group.id);
              const next = reorderStoredOrder({
                activeId,
                overId,
                order: groupIds,
                visibleIds: groupIds,
              });
              if (next) onOrderChange(next);
            }}
            onDone={() => {
              focusTarget.current = "more";
              setCustomizing(false);
            }}
            title="Customize list"
            listLabel={label}
            variant={compact ? "compact" : "card"}
            testIdPrefix="sidebar-thread-list"
          />
        ) : (
          children
        )}
      </div>
    </VisibilityContext.Provider>
  );
}

export function ThreadListVisibilityGroupScope({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <GroupContext.Provider value={id}>
      <div data-sidebar-visibility-group={id}>{children}</div>
    </GroupContext.Provider>
  );
}

export function ThreadListVisibilityMenuItems({
  surface = "dropdown",
  leadingSeparator = true,
}: {
  surface?: "dropdown" | "context";
  leadingSeparator?: boolean;
}) {
  const state = useContext(VisibilityContext);
  const id = useContext(GroupContext);
  if (!state) return null;
  const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
  return (
    <>
      {leadingSeparator && <ActionMenuSeparator surface={surface} />}
      {id !== null && (
        <Item onSelect={() => state.hide(id)}>
          <SidebarVisibilityActionContent visible label="Hide from list" />
        </Item>
      )}
      <Item onSelect={state.customize}>
        <SidebarCustomizeActionContent label="Customize list" />
      </Item>
    </>
  );
}

function GroupActivity({ threads }: { threads: readonly SidebarThread[] }) {
  const drafts = useSidebarThreadDraftIds();
  const pluginStatus = usePluginThreadRowStatusForThreads(threads);
  return (
    <CollapsedThreadStatusGlyph
      activity={getCollapsedChildActivity(threads, drafts)}
      pluginStatus={pluginStatus}
    />
  );
}

function HiddenGroup({
  group,
  selected,
  close,
  restore,
}: {
  group: ThreadListVisibilityGroup;
  selected: boolean;
  close: () => void;
  restore: (id: string) => void;
}) {
  return (
    <SidebarOverflowItem
      item={group}
      selected={selected}
      empty={group.threads.length === 0}
      onClose={close}
      onAddToSidebar={restore}
      onNewThread={group.onNewThread}
      activity={<GroupActivity threads={group.threads} />}
    >
      {(closeSection) => group.renderContent(closeSection)}
    </SidebarOverflowItem>
  );
}

export function ThreadListMore() {
  const state = useContext(VisibilityContext);
  if (!state || state.hiddenGroups.length === 0) return null;
  const groups = state.hiddenGroups;
  const selectedGroupId = groups.find((group) =>
    group.threads.some((thread) => thread.id === state.selectedThreadId),
  )?.id;
  const threads = [
    ...new Map(
      groups
        .flatMap((group) => group.threads)
        .map((thread) => [thread.id, thread]),
    ).values(),
  ];
  return (
    <div className="mt-4">
      <SidebarMore
        ariaLabel={`More ${state.label.toLowerCase()}`}
        listLabel={`Hidden ${state.label.toLowerCase()}`}
        customizeLabel="Customize list"
        onCustomize={state.customize}
        selected={selectedGroupId !== undefined}
        activity={<GroupActivity threads={threads} />}
        testIdPrefix="sidebar-thread-list"
      >
        {(close) => (
          <SidebarContentElementContext.Provider value={null}>
            <div data-sidebar-overflow="true">
              {groups.map((group) => (
                <HiddenGroup
                  key={group.id}
                  group={group}
                  selected={group.id === selectedGroupId}
                  close={close}
                  restore={state.restore}
                />
              ))}
            </div>
          </SidebarContentElementContext.Provider>
        )}
      </SidebarMore>
    </div>
  );
}
