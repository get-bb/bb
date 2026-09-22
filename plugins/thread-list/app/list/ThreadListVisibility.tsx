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
import type { ThreadListEntry } from "@bb/domain";
import {
  getCollapsedChildActivity,
  type SidebarSectionId,
} from "@bb/client-core";
import { DropdownMenuItem } from "@bb/shared-ui/dropdown-menu";
import { ContextMenuItem } from "@bb/shared-ui/context-menu";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useSidebarThreadDraftIds } from "@get-bb/plugin-sdk/app";
import { ActionMenuSeparator } from "../ui/action-menu-items.js";
import { SidebarContentElementContext } from "../ui/sidebar.js";
import { reorderStoredOrder } from "../model/stored-order.js";
import {
  sidebarExpandedOverflowGroupsAtom,
  sidebarHiddenGroupsAtom,
} from "../preferences/atoms.js";
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
  threads: readonly ThreadListEntry[];
  renderContent: (close: () => void) => ReactNode;
}

interface ThreadListVisibilityState {
  hiddenGroups: readonly ThreadListVisibilityGroup[];
  hide: (id: string) => void;
  restore: (id: string) => void;
  customize: () => void;
  label: string;
}

const VisibilityContext = createContext<ThreadListVisibilityState | null>(null);
const GroupContext = createContext<string | null>(null);

export function ThreadListVisibility({
  groups,
  order,
  onOrderChange,
  label,
  children,
}: {
  groups: readonly ThreadListVisibilityGroup[];
  order: readonly SidebarSectionId[];
  onOrderChange: (order: SidebarSectionId[]) => void;
  label: string;
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
}: {
  surface?: "dropdown" | "context";
}) {
  const state = useContext(VisibilityContext);
  const id = useContext(GroupContext);
  if (!state) return null;
  const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
  return (
    <>
      <ActionMenuSeparator surface={surface} />
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

function GroupActivity({ threads }: { threads: readonly ThreadListEntry[] }) {
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
  close,
  restore,
}: {
  group: ThreadListVisibilityGroup;
  close: () => void;
  restore: (id: string) => void;
}) {
  const [expandedGroups, setExpandedGroups] = useAtom(
    sidebarExpandedOverflowGroupsAtom,
  );
  const expanded = expandedGroups.includes(group.id);
  return (
    <SidebarOverflowItem
      item={group}
      onClose={close}
      onAddToSidebar={restore}
      expanded={expanded}
      onExpandedChange={(nextExpanded) => {
        setExpandedGroups((current) =>
          nextExpanded
            ? current.includes(group.id)
              ? current
              : [...current, group.id]
            : current.filter((id) => id !== group.id),
        );
      }}
      activity={<GroupActivity threads={group.threads} />}
      testIdPrefix="sidebar-thread-list"
    >
      {group.renderContent(close)}
    </SidebarOverflowItem>
  );
}

export function ThreadListMore() {
  const state = useContext(VisibilityContext);
  if (!state || state.hiddenGroups.length === 0) return null;
  const groups = state.hiddenGroups;
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
