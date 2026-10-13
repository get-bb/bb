import {
  type PointerEvent as ReactPointerEvent,
  type MouseEventHandler,
  useCallback,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  verticalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useDragClickSuppression } from "@bb/shared-ui/use-drag-click-suppression";
import { cn } from "@bb/shared-ui/lib/utils";
import { VerticalTabIcon } from "./VerticalTabIcon";
import type {
  SecondaryPanelRenderableTab,
  SecondaryPanelTabReorderHandler,
} from "./secondaryPanelTab";

class InertTouchSensor extends TouchSensor {
  static override setup(): () => void {
    return () => {};
  }
}

export interface SecondaryPanelTabStripProps {
  activeTabId: string | null;
  tabs: readonly SecondaryPanelRenderableTab[];
  onBeginTabDrag?: (
    tabId: string,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  onReorderTab: SecondaryPanelTabReorderHandler;
  usesDesktopChrome: boolean;
  isPanelOpen: boolean;
}

export type SecondaryPanelTabCloseScope = "self" | "others" | "right";

export function secondaryPanelTabsToClose(
  tabs: readonly SecondaryPanelRenderableTab[],
  tabId: string,
  scope: SecondaryPanelTabCloseScope,
): SecondaryPanelRenderableTab[] {
  const index = tabs.findIndex((tab) => tab.tab.id === tabId);
  if (index === -1) {
    return [];
  }
  const candidates =
    scope === "self"
      ? tabs.slice(index, index + 1)
      : scope === "right"
        ? tabs.slice(index + 1)
        : tabs.filter((tab) => tab.tab.id !== tabId);
  return candidates.filter((tab) => !tab.isPinned);
}

export function SecondaryPanelTabStrip({
  activeTabId,
  tabs,
  onBeginTabDrag,
  onReorderTab,
  isPanelOpen,
}: SecondaryPanelTabStripProps) {
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const {
    beginDragClickSuppression,
    clearDragClickSuppressionSoon,
    consumeDragClickSuppression,
  } = useDragClickSuppression();
  const dragDisabled = tabs.length < 2;
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: { distance: 4 },
  });
  const touchSensor = useSensor(
    isPanelOpen && !dragDisabled ? TouchSensor : InertTouchSensor,
    { activationConstraint: { delay: 200, tolerance: 6 } },
  );
  const sensors = useSensors(mouseSensor, touchSensor);
  const tabIds = useMemo(() => tabs.map((tab) => tab.tab.id), [tabs]);
  const draggingTab =
    draggingTabId === null
      ? null
      : (tabs.find((tab) => tab.tab.id === draggingTabId) ?? null);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setDraggingTabId(String(event.active.id));
      beginDragClickSuppression();
    },
    [beginDragClickSuppression],
  );
  const handleDragCancel = useCallback(() => {
    setDraggingTabId(null);
    clearDragClickSuppressionSoon();
  }, [clearDragClickSuppressionSoon]);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingTabId(null);
      clearDragClickSuppressionSoon();
      if (!event.over) {
        return;
      }
      const activeTabId = String(event.active.id);
      const overTabId = String(event.over.id);
      if (activeTabId === overTabId) {
        return;
      }
      onReorderTab({ activeTabId, overTabId });
    },
    [clearDragClickSuppressionSoon, onReorderTab],
  );
  const handleClickCapture = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      if (!consumeDragClickSuppression()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeDragClickSuppression],
  );

  const isCompactViewport = useIsCompactViewport();
  const handleCloseTabs = useCallback(
    (tabId: string, scope: SecondaryPanelTabCloseScope) => {
      const tabsToClose = secondaryPanelTabsToClose(tabs, tabId, scope);
      const closesActiveTab = tabsToClose.some(
        (tab) => tab.tab.id === activeTabId,
      );
      if (scope !== "self" && closesActiveTab) {
        tabs.find((tab) => tab.tab.id === tabId)?.onSelect();
      }
      for (const tab of tabsToClose) {
        tab.onClose();
      }
    },
    [activeTabId, tabs],
  );

  return (
    <div
      data-testid="secondary-panel-tab-strip"
      onClickCapture={handleClickCapture}
      className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={tabIds} strategy={verticalListSortingStrategy}>
          {tabs.map((tab) => (
            <SortablePanelTab
              key={tab.tab.id}
              contextMenuDisabled={isCompactViewport}
              dragDisabled={dragDisabled}
              isActive={tab.tab.id === activeTabId}
              onBeginTabDrag={onBeginTabDrag}
              onCloseTabs={handleCloseTabs}
              tab={tab}
              tabs={tabs}
            />
          ))}
        </SortableContext>
        {createPortal(
          <DragOverlay className="cursor-grabbing">
            {draggingTab === null ? null : (
              <PanelTab
                isActive={draggingTab.tab.id === activeTabId}
                tab={draggingTab}
              />
            )}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </div>
  );
}

interface SortablePanelTabProps {
  isActive: boolean;
  contextMenuDisabled: boolean;
  dragDisabled: boolean;
  onCloseTabs: (tabId: string, scope: SecondaryPanelTabCloseScope) => void;
  tabs: readonly SecondaryPanelRenderableTab[];
  onBeginTabDrag?: (
    tabId: string,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  tab: SecondaryPanelRenderableTab;
}

function SortablePanelTab({
  contextMenuDisabled,
  dragDisabled,
  isActive,
  onBeginTabDrag,
  onCloseTabs,
  tab,
  tabs,
}: SortablePanelTabProps) {
  const { isDragging, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: tab.tab.id,
      disabled: dragDisabled,
    });
  const { onPointerDown: sortablePointerDown, ...sortableListeners } =
    listeners ?? {};

  const tabId = tab.tab.id;
  const canCloseSelf =
    secondaryPanelTabsToClose(tabs, tabId, "self").length > 0;
  const canCloseOthers =
    secondaryPanelTabsToClose(tabs, tabId, "others").length > 0;
  const canCloseRight =
    secondaryPanelTabsToClose(tabs, tabId, "right").length > 0;

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild disabled={contextMenuDisabled}>
        <div
          ref={setNodeRef}
          style={{
            transform: CSS.Translate.toString(transform),
            transition,
          }}
          className={cn(
            "shrink-0",
            !dragDisabled && "cursor-grab active:cursor-grabbing",
            isDragging && "opacity-40",
          )}
          onPointerDown={(event) => {
            onBeginTabDrag?.(tabId, event);
            sortablePointerDown?.(event);
          }}
          {...sortableListeners}
        >
          <PanelTab tab={tab} isActive={isActive} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`${tab.label} tab actions`}>
        <ContextMenuItem
          disabled={!canCloseSelf}
          onSelect={() => onCloseTabs(tabId, "self")}
        >
          Close tab
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!canCloseOthers}
          onSelect={() => onCloseTabs(tabId, "others")}
        >
          Close other tabs
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canCloseRight}
          onSelect={() => onCloseTabs(tabId, "right")}
        >
          Close tabs to the right
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function PanelTab({
  tab,
  isActive,
}: {
  tab: SecondaryPanelRenderableTab;
  isActive: boolean;
}) {
  const title =
    tab.statusLabel === null ? tab.label : `${tab.label} (${tab.statusLabel})`;
  return (
    <VerticalTabIcon
      label={tab.label}
      leadingVisual={tab.leadingVisual}
      colorTag={tab.colorTag ?? null}
      title={title}
      isActive={isActive}
      onSelect={tab.onSelect}
      onSetColorTag={tab.onSetColorTag ?? null}
      onClose={tab.isPinned ? null : tab.onClose}
    />
  );
}
