import {
  type CSSProperties,
  type MouseEventHandler,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { TabPill } from "@/components/ui/tab-pill";
import { useDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
} from "@/lib/bb-desktop";
import type {
  SecondaryPanelRenderableTab,
  SecondaryPanelTabReorderHandler,
} from "./secondaryPanelTab";

import { PANEL_TAB_CONTROL_CLASS } from "./panelChromeClasses";

const TAB_STRIP_SCROLL_BUTTON_CLASS = `${PANEL_TAB_CONTROL_CLASS} rounded-md`;

const EDGE_EPSILON_PX = 1;

class InertTouchSensor extends TouchSensor {
  static override setup(): () => void {
    return () => {};
  }
}

interface TabStripOverflowState {
  hasOverflow: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

const INITIAL_OVERFLOW_STATE: TabStripOverflowState = {
  hasOverflow: false,
  canScrollLeft: false,
  canScrollRight: false,
};

export interface SecondaryPanelTabStripProps {
  activeTabId: string | null;
  tabs: readonly SecondaryPanelRenderableTab[];
  leadingTabs?: ReactNode;
  newTabControl?: ReactNode;
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

interface SortablePanelTabProps {
  isActive: boolean;
  contextMenuDisabled: boolean;
  dragDisabled: boolean;
  noDragClass: string | null;
  onCloseTabs: (tabId: string, scope: SecondaryPanelTabCloseScope) => void;
  tabs: readonly SecondaryPanelRenderableTab[];
  onBeginTabDrag?: (
    tabId: string,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  tab: SecondaryPanelRenderableTab;
}

export function SecondaryPanelTabStrip({
  activeTabId,
  tabs,
  leadingTabs,
  newTabControl,
  onBeginTabDrag,
  onReorderTab,
  usesDesktopChrome,
  isPanelOpen,
}: SecondaryPanelTabStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const newTabControlRef = useRef<HTMLDivElement>(null);
  const leftScrollButtonRef = useRef<HTMLButtonElement>(null);
  const rightScrollButtonRef = useRef<HTMLButtonElement>(null);
  const [overflow, setOverflow] = useState<TabStripOverflowState>(
    INITIAL_OVERFLOW_STATE,
  );
  const [contentWidth, setContentWidth] = useState<number>();
  const maxScrollLeftRef = useRef(0);
  const measuredWidthRef = useRef(0);
  const resizeRevealFrameRef = useRef<number | null>(null);
  const hasOverflowRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
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

  const applyEdgeFlags = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    const maxScrollLeft = maxScrollLeftRef.current;
    const hasOverflow = hasOverflowRef.current;
    const isScrollable = hasOverflow && maxScrollLeft > EDGE_EPSILON_PX;
    const { scrollLeft } = viewport;
    const canScrollLeft = isScrollable && scrollLeft > EDGE_EPSILON_PX;
    const canScrollRight =
      isScrollable && scrollLeft < maxScrollLeft - EDGE_EPSILON_PX;
    setOverflow((prev) =>
      prev.hasOverflow === hasOverflow &&
      prev.canScrollLeft === canScrollLeft &&
      prev.canScrollRight === canScrollRight
        ? prev
        : { hasOverflow, canScrollLeft, canScrollRight },
    );
  }, []);

  const measureCapacity = useCallback(() => {
    const strip = stripRef.current;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (strip === null || viewport === null || content === null) {
      return;
    }
    setContentWidth(content.scrollWidth);
    if (measuredWidthRef.current !== strip.clientWidth) {
      measuredWidthRef.current = strip.clientWidth;
      const reveal = () =>
        content
          .querySelector<HTMLElement>('button[aria-pressed="true"]')
          ?.parentElement?.scrollIntoView({
            inline: "nearest",
            block: "nearest",
          });
      reveal();
      if (resizeRevealFrameRef.current !== null)
        window.cancelAnimationFrame(resizeRevealFrameRef.current);
      resizeRevealFrameRef.current = window.requestAnimationFrame(() => {
        resizeRevealFrameRef.current = null;
        reveal();
        applyEdgeFlags();
      });
    }
    const hasOverflow =
      content.scrollWidth >
      strip.clientWidth -
        (newTabControlRef.current?.getBoundingClientRect().width ?? 0) +
        EDGE_EPSILON_PX;
    hasOverflowRef.current = hasOverflow;
    maxScrollLeftRef.current = hasOverflow
      ? Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      : 0;
    applyEdgeFlags();
  }, [applyEdgeFlags]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    const handleScroll = () => {
      if (scrollFrameRef.current !== null) {
        return;
      }
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        applyEdgeFlags();
      });
    };
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    const resizeObserver = new ResizeObserver(measureCapacity);
    if (stripRef.current !== null) {
      resizeObserver.observe(stripRef.current);
    }
    resizeObserver.observe(viewport);
    if (contentRef.current !== null) {
      resizeObserver.observe(contentRef.current);
    }
    return () => {
      viewport.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
      if (resizeRevealFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeRevealFrameRef.current);
        resizeRevealFrameRef.current = null;
      }
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [applyEdgeFlags, measureCapacity]);

  useLayoutEffect(() => {
    measureCapacity();
  }, [tabs, measureCapacity]);

  useEffect(() => {
    void document.fonts?.ready?.then(() => measureCapacity());
  }, [measureCapacity]);

  useLayoutEffect(() => {
    const activeTabElement = contentRef.current?.querySelector<HTMLElement>(
      'button[aria-pressed="true"]',
    )?.parentElement;
    if (!activeTabElement) {
      return;
    }
    const reveal = () => {
      activeTabElement.scrollIntoView({ inline: "nearest", block: "nearest" });
      applyEdgeFlags();
    };
    reveal();
    const frame = window.requestAnimationFrame(reveal);
    return () => window.cancelAnimationFrame(frame);
  }, [activeTabId, overflow.hasOverflow, applyEdgeFlags]);

  useLayoutEffect(() => {
    const focusedElement = document.activeElement;
    const activeTabButton =
      contentRef.current?.querySelector<HTMLButtonElement>(
        'button[aria-pressed="true"]',
      ) ?? null;
    if (
      !overflow.canScrollLeft &&
      focusedElement === leftScrollButtonRef.current
    ) {
      (overflow.canScrollRight
        ? rightScrollButtonRef.current
        : activeTabButton
      )?.focus();
      return;
    }
    if (
      !overflow.canScrollRight &&
      focusedElement === rightScrollButtonRef.current
    ) {
      (overflow.canScrollLeft
        ? leftScrollButtonRef.current
        : activeTabButton
      )?.focus();
    }
  }, [overflow.canScrollLeft, overflow.canScrollRight]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      if (
        event.deltaY === 0 ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY)
      ) {
        return;
      }
      const maxScrollLeft = maxScrollLeftRef.current;
      if (maxScrollLeft <= EDGE_EPSILON_PX) {
        return;
      }
      const { scrollLeft } = viewport;
      const canScrollInWheelDirection =
        event.deltaY > 0
          ? scrollLeft < maxScrollLeft - EDGE_EPSILON_PX
          : scrollLeft > EDGE_EPSILON_PX;
      if (!canScrollInWheelDirection) {
        return;
      }
      viewport.scrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, scrollLeft + event.deltaY),
      );
      event.preventDefault();
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
    };
  }, []);

  const scrollByStep = useCallback((direction: -1 | 1) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const left = viewport.getBoundingClientRect().left;
    const tabs = Array.from(
      contentRef.current?.querySelectorAll<HTMLElement>(
        "[data-secondary-panel-tab]",
      ) ?? [],
    );
    const target =
      direction > 0
        ? tabs.find(
            (tab) => tab.getBoundingClientRect().left > left + EDGE_EPSILON_PX,
          )
        : tabs
            .reverse()
            .find(
              (tab) =>
                tab.getBoundingClientRect().left < left - EDGE_EPSILON_PX,
            );
    target?.scrollIntoView({
      inline: "start",
      block: "nearest",
      behavior: "smooth",
    });
  }, []);

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

  const noDragClass = usesDesktopChrome ? MACOS_WINDOW_NO_DRAG_CLASS : null;
  const chevronNoDragClass = usesDesktopChrome
    ? MACOS_APP_REGION_NO_DRAG_CLASS
    : null;
  const dndTabs = useMemo(
    () => (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={tabIds}
          strategy={horizontalListSortingStrategy}
        >
          {tabs.map((tab) => (
            <SortablePanelTab
              key={tab.tab.id}
              contextMenuDisabled={isCompactViewport}
              dragDisabled={dragDisabled}
              isActive={tab.tab.id === activeTabId}
              noDragClass={noDragClass}
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
    ),
    [
      sensors,
      handleDragStart,
      handleDragCancel,
      handleDragEnd,
      tabIds,
      tabs,
      dragDisabled,
      isCompactViewport,
      noDragClass,
      onBeginTabDrag,
      handleCloseTabs,
      draggingTab,
      activeTabId,
    ],
  );

  return (
    <div
      ref={stripRef}
      data-testid="secondary-panel-tab-strip"
      className="group relative flex min-w-0 flex-1 items-center [&_[data-tab-pill-close]]:text-muted-foreground/70 [&_[data-tab-pill-close]:hover]:text-foreground [&_[data-tab-pill-close]_[data-icon-root]]:size-3 max-md:pointer-coarse:[&_[data-tab-pill-close]_[data-icon-root]]:size-3.5"
    >
      <TabStripScrollButton
        buttonRef={leftScrollButtonRef}
        direction="left"
        canScroll={overflow.canScrollLeft}
        className={chevronNoDragClass}
        onClick={() => scrollByStep(-1)}
      />
      <div
        data-secondary-panel-tab-scroll-region
        className="relative min-w-0 flex-1 [container-type:inline-size]"
        style={{ maxWidth: contentWidth }}
      >
        <div
          ref={viewportRef}
          onClickCapture={handleClickCapture}
          className={cn(
            "no-scrollbar min-w-0 overflow-x-auto overflow-y-hidden",
            usesDesktopChrome && MACOS_APP_REGION_NO_DRAG_CLASS,
          )}
        >
          <div
            ref={contentRef}
            data-secondary-panel-tab-content
            className="flex w-max items-center gap-1"
          >
            {leadingTabs}
            {dndTabs}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        <TabStripScrollButton
          buttonRef={rightScrollButtonRef}
          direction="right"
          canScroll={overflow.canScrollRight}
          className={chevronNoDragClass}
          onClick={() => scrollByStep(1)}
        />
        {newTabControl ? (
          <div ref={newTabControlRef} className="flex shrink-0 pl-1">
            {newTabControl}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SortablePanelTab({
  contextMenuDisabled,
  dragDisabled,
  isActive,
  noDragClass,
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
  const style = useMemo<CSSProperties>(
    () => ({
      transform: CSS.Translate.toString(transform),
      transition,
    }),
    [transform, transition],
  );

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
          data-secondary-panel-tab
          style={style}
          className={cn(
            "max-w-[min(144px,100cqw)] shrink-0",
            !dragDisabled && "cursor-grab active:cursor-grabbing",
            isDragging && "opacity-40",
            noDragClass,
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

interface TabStripScrollButtonProps {
  buttonRef: RefObject<HTMLButtonElement | null>;
  direction: "left" | "right";
  canScroll: boolean;
  className: string | null;
  onClick: () => void;
}

function TabStripScrollButton({
  buttonRef,
  direction,
  canScroll,
  className,
  onClick,
}: TabStripScrollButtonProps) {
  const label = direction === "left" ? "Scroll tabs left" : "Scroll tabs right";
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="sm"
      tabIndex={canScroll ? 0 : -1}
      aria-hidden={!canScroll}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "z-20 shrink-0 bg-sidebar text-muted-foreground/70 shadow-none hover:bg-surface-raised-solid hover:text-foreground focus-visible:bg-sidebar",
        canScroll
          ? TAB_STRIP_SCROLL_BUTTON_CLASS
          : "h-7 w-0 overflow-hidden p-0 max-md:pointer-coarse:h-9",
        canScroll && (direction === "left" ? "mr-1" : "ml-1"),
        "transition-opacity",
        canScroll
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0",
        className,
      )}
    >
      <Icon name={direction === "left" ? "ChevronLeft" : "ChevronRight"} />
    </Button>
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
    <TabPill
      label={tab.label}
      leadingVisual={tab.leadingVisual}
      secondaryLabel={tab.statusLabel === null ? null : `(${tab.statusLabel})`}
      title={title}
      isActive={isActive}
      onSelect={tab.onSelect}
      labelMaxWidthClass="max-w-full"
      enlargeCloseTargetOnCoarsePointer={
        tab.tab.kind === "workspace-file-preview" ||
        tab.tab.kind === "host-file-preview" ||
        tab.tab.kind === "thread-storage-file-preview"
      }
      closeAction={
        tab.isPinned
          ? null
          : {
              onClose: tab.onClose,
              closeLabel: `Close ${tab.label}`,
            }
      }
    />
  );
}
