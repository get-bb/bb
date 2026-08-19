import {
  type CSSProperties,
  type MouseEventHandler,
  type RefObject,
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
  OverflowFade,
  type OverflowFadeTone,
} from "@/components/ui/overflow-fade";
import { TabPill } from "@/components/ui/tab-pill";
import { useDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
} from "@/lib/bb-desktop";
import type {
  SecondaryPanelFileTab,
  SecondaryPanelTabReorderHandler,
} from "./secondaryPanelFileTab";
export type { SecondaryPanelFileTab } from "./secondaryPanelFileTab";

// Roughly one wide tab, so one click reveals the next tab without overshooting.
const CHEVRON_SCROLL_STEP_PX = 140;

// Keep fine-pointer caret columns compact without shrinking touch targets.
const TAB_STRIP_SCROLL_BUTTON_CLASS =
  "h-7 w-5 rounded-md p-0 [&_svg]:size-3.5 max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9 max-md:pointer-coarse:[&_svg]:size-5";

// Slack so sub-pixel scroll offsets don't leave an overflow cue at a hard edge.
const EDGE_EPSILON_PX = 1;

export const SECONDARY_PANEL_TAB_STRIP_FADE_TONE: OverflowFadeTone = "sidebar";

/**
 * Stand-in for dnd-kit's TouchSensor while the panel is closed or has nothing
 * to reorder: same activators (so the sensor slot keeps its shape) but no
 * window `touchmove` listener from `setup`.
 */
class InertTouchSensor extends TouchSensor {
  static override setup(): () => void {
    return () => {};
  }
}

interface TabStripOverflowState {
  /** The intrinsic tab row is wider than the whole strip. */
  hasOverflow: boolean;
  /** Scrolled away from the left edge (content hidden to the left). */
  canScrollLeft: boolean;
  /** More content remains to the right. */
  canScrollRight: boolean;
}

const INITIAL_OVERFLOW_STATE: TabStripOverflowState = {
  hasOverflow: false,
  canScrollLeft: false,
  canScrollRight: false,
};

export interface SecondaryPanelTabStripProps {
  fileTabs: SecondaryPanelFileTab[];
  onReorderTab: SecondaryPanelTabReorderHandler;
  usesDesktopChrome: boolean;
  /**
   * Whether the hosting panel is open. The strip stays mounted inside a closed
   * (retained) panel; touch reorder is only wired while it is open so the
   * dnd-kit touch sensor's scroll-blocking window listener does not exist on
   * every page.
   */
  isPanelOpen: boolean;
  activeTreatment?: "fill" | "underline";
}

interface SortableFileTabProps {
  activeTreatment: "fill" | "underline";
  activeTabRef: RefObject<HTMLDivElement | null>;
  dragDisabled: boolean;
  noDragClass: string | null;
  tab: SecondaryPanelFileTab;
}

/**
 * The middle, horizontally-scrolling region of the secondary panel tab strip.
 *
 * Only the file tabs scroll; the leading Info/Diff controls and trailing
 * new-tab/panel controls stay anchored outside this component. Edge
 * fades and scroll buttons appear only on a side that has more tabs, and the
 * active tab is auto-scrolled into view on mount and whenever it changes
 * (covering pointer, keyboard, and programmatic selection).
 */
export function SecondaryPanelTabStrip({
  fileTabs,
  onReorderTab,
  usesDesktopChrome,
  isPanelOpen,
  activeTreatment = "fill",
}: SecondaryPanelTabStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLDivElement>(null);
  const leftScrollButtonRef = useRef<HTMLButtonElement>(null);
  const rightScrollButtonRef = useRef<HTMLButtonElement>(null);
  const [overflow, setOverflow] = useState<TabStripOverflowState>(
    INITIAL_OVERFLOW_STATE,
  );
  // Scroll capacity (max scrollLeft). Measured only on resize / tab-list change,
  // never per scroll: reading scrollWidth/clientWidth in a scroll handler forces
  // a synchronous reflow, which thrashes at narrow widths where every edge
  // crossing (and its fade/chevron repaint) re-dirties layout. The scroll handler
  // then reads only scrollLeft, which is cheap and doesn't flush layout.
  const maxScrollLeftRef = useRef(0);
  const hasOverflowRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const {
    beginDragClickSuppression,
    clearDragClickSuppressionSoon,
    consumeDragClickSuppression,
  } = useDragClickSuppression();
  const dragDisabled = fileTabs.length < 2;
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: { distance: 4 },
  });
  // dnd-kit's TouchSensor keeps a NON-passive window `touchmove` listener
  // installed while any DndContext using it is mounted, which makes every
  // scroll start on phones wait for the main thread. Only wire the real
  // sensor while there is something to reorder in an open panel. The sensor
  // list must keep a constant length: DndContext's setup effect uses the
  // sensor classes as its dependency array, and React skips an effect whose
  // dependency array merely changed size, so swapping the CLASS (rather than
  // dropping the entry) is what makes the listener install on open and go
  // away on close.
  const touchSensor = useSensor(
    isPanelOpen && !dragDisabled ? TouchSensor : InertTouchSensor,
    { activationConstraint: { delay: 200, tolerance: 6 } },
  );
  const sensors = useSensors(mouseSensor, touchSensor);
  const tabIds = useMemo(() => fileTabs.map((tab) => tab.id), [fileTabs]);
  const draggingTab =
    draggingTabId === null
      ? null
      : (fileTabs.find((tab) => tab.id === draggingTabId) ?? null);

  // Cheap: reads only scrollLeft (no layout flush) against the cached capacity.
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
    // Return the existing state object when neither flag changed so React bails
    // out of re-rendering. With the tab tree memoized, a real change only
    // repaints the always-mounted edge fades/chevrons (an opacity toggle).
    setOverflow((prev) =>
      prev.hasOverflow === hasOverflow &&
      prev.canScrollLeft === canScrollLeft &&
      prev.canScrollRight === canScrollRight
        ? prev
        : { hasOverflow, canScrollLeft, canScrollRight },
    );
  }, []);

  // Expensive (reads scrollWidth/clientWidth): run only on resize / tab change,
  // then re-derive the edge flags from the fresh capacity.
  const measureCapacity = useCallback(() => {
    const strip = stripRef.current;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (strip === null || viewport === null || content === null) {
      return;
    }
    // Decide whether controls are needed against the whole strip width, not the
    // narrower viewport between those controls. Otherwise the control slots can
    // make themselves permanently necessary after the tabs would fit again.
    const hasOverflow =
      content.scrollWidth > strip.clientWidth + EDGE_EPSILON_PX;
    hasOverflowRef.current = hasOverflow;
    maxScrollLeftRef.current = hasOverflow
      ? Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      : 0;
    applyEdgeFlags();
  }, [applyEdgeFlags]);

  // Track the viewport's own scrolling and both dimensions that determine its
  // capacity. The content row can change intrinsic width without the viewport
  // resizing (for example, when an async browser title replaces "Browser").
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    // rAF-throttle: a trackpad fires a burst of scroll events; coalesce them into
    // one edge-flag check per frame.
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
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [applyEdgeFlags, measureCapacity]);

  // The set of tabs can change width without resizing the viewport (open/close,
  // rename), so re-measure capacity whenever the tab list changes.
  useEffect(() => {
    measureCapacity();
  }, [fileTabs, measureCapacity]);

  // A web-font swap changes the tabs' intrinsic width (and so scrollWidth)
  // without resizing the viewport or changing the tab list, which would leave the
  // cached capacity stale. Re-measure once fonts settle. (document.fonts is
  // absent in jsdom, hence the optional chain.)
  useEffect(() => {
    void document.fonts?.ready?.then(() => measureCapacity());
  }, [measureCapacity]);

  // Bring the active tab into view on mount, on every active-tab change, and
  // after the overflow control slots enter or leave the row. The last case
  // keeps a tab that was aligned to the old viewport edge from being clipped
  // when the controls reserve space. jsdom doesn't implement scrollIntoView,
  // so guard the call.
  const activeTabId = fileTabs.find((tab) => tab.isActive)?.id ?? null;
  useLayoutEffect(() => {
    const activeTabElement = activeTabRef.current;
    if (activeTabElement === null) {
      return;
    }
    activeTabElement.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeTabId, overflow.hasOverflow]);

  // A scroll button can reach its edge while it has keyboard focus. Move focus
  // before the button becomes an invisible, aria-hidden control.
  useLayoutEffect(() => {
    const focusedElement = document.activeElement;
    const activeTabButton =
      activeTabRef.current?.querySelector<HTMLButtonElement>("button") ?? null;
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

  // A plain mouse wheel over the strip should move it sideways. React registers
  // its onWheel listener as passive, so a synthetic handler can't call
  // preventDefault; attach a non-passive native listener instead. Only consume
  // the gesture (and suppress the page's vertical scroll) when the strip can
  // actually move horizontally in the wheel's direction — at a horizontal edge
  // we let the event bubble so the page keeps scrolling normally. Trackpad
  // horizontal gestures arrive as deltaX and scroll natively, so only deltaY is
  // translated here.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      // Let native horizontal trackpad gestures scroll the strip themselves; only
      // translate a primarily-vertical wheel into horizontal movement. (A mostly
      // horizontal swipe can carry small deltaY noise — don't hijack it.)
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
      // Clamp against the cached capacity instead of re-reading scrollWidth.
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
    viewportRef.current?.scrollBy({
      left: direction * CHEVRON_SCROLL_STEP_PX,
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

  const noDragClass = usesDesktopChrome ? MACOS_WINDOW_NO_DRAG_CLASS : null;
  const chevronNoDragClass = usesDesktopChrome
    ? MACOS_APP_REGION_NO_DRAG_CLASS
    : null;
  // Memoize the sortable tab tree so the directional overflow flags — which
  // flip every time you reach a scroll edge, i.e. constantly at narrow widths —
  // re-render only the edge controls, never the tabs. Without this, each edge
  // crossing reconciles the whole list and re-runs useSortable for every tab,
  // which is what kept narrow-width scrolling stuttery.
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
          {fileTabs.map((tab) => (
            <SortableFileTab
              key={tab.id}
              activeTreatment={activeTreatment}
              activeTabRef={activeTabRef}
              dragDisabled={dragDisabled}
              noDragClass={noDragClass}
              tab={tab}
            />
          ))}
        </SortableContext>
        {/* The lifted tab follows the pointer on both axes and must not be
            clipped by the viewport's `overflow` or stretch its scroll width, so
            render it as a fixed-position clone portaled out of the strip rather
            than translating the in-place tab. */}
        {createPortal(
          <DragOverlay className="cursor-grabbing">
            {draggingTab === null ? null : (
              <FileTab tab={draggingTab} activeTreatment={activeTreatment} />
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
      fileTabs,
      dragDisabled,
      noDragClass,
      draggingTab,
      activeTreatment,
    ],
  );

  return (
    // Hugs its tabs (no `flex-1`) and shrinks (`min-w-0`) when they overflow.
    // The New Tab button follows this strip as an anchored sibling, while the
    // in-flow scroll controls reserve their own space on either side of the tab
    // viewport instead of covering its contents.
    <div
      ref={stripRef}
      data-testid="secondary-panel-tab-strip"
      className="group relative flex min-w-0 items-center"
    >
      <TabStripScrollButton
        buttonRef={leftScrollButtonRef}
        direction="left"
        hasOverflow={overflow.hasOverflow}
        canScroll={overflow.canScrollLeft}
        className={chevronNoDragClass}
        onClick={() => scrollByStep(-1)}
      />
      <div data-secondary-panel-tab-scroll-region className="relative min-w-0">
        {/* The fades are scoped to the tab viewport, so neither they nor the
            scrolling pills extend into the in-flow caret slots. */}
        <OverflowFade
          placement="left"
          tone={SECONDARY_PANEL_TAB_STRIP_FADE_TONE}
          className={cn(
            "z-10",
            overflow.canScrollLeft ? "opacity-100" : "opacity-0",
          )}
        />
        <OverflowFade
          placement="right"
          tone={SECONDARY_PANEL_TAB_STRIP_FADE_TONE}
          className={cn(
            "z-10",
            overflow.canScrollRight ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          ref={viewportRef}
          onClickCapture={handleClickCapture}
          // No `scroll-smooth` here: wheel translation assigns scrollLeft
          // directly (see the wheel handler), and CSS smooth-scroll would turn
          // each wheel notch into its own ~150ms animation — the strip advances,
          // sits frozen between notches, then jumps. Letting it track 1:1 matches
          // native horizontal trackpad scrolling.
          className="no-scrollbar min-w-0 overflow-x-auto overflow-y-hidden"
        >
          <div
            ref={contentRef}
            data-secondary-panel-tab-content
            className="flex w-max items-center gap-1"
          >
            {dndTabs}
          </div>
        </div>
      </div>
      <TabStripScrollButton
        buttonRef={rightScrollButtonRef}
        direction="right"
        hasOverflow={overflow.hasOverflow}
        canScroll={overflow.canScrollRight}
        className={chevronNoDragClass}
        onClick={() => scrollByStep(1)}
      />
    </div>
  );
}

function SortableFileTab({
  activeTreatment,
  activeTabRef,
  dragDisabled,
  noDragClass,
  tab,
}: SortableFileTabProps) {
  const { isDragging, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: tab.id,
      disabled: dragDisabled,
    });
  const setTabRef = useCallback(
    (element: HTMLDivElement | null) => {
      setNodeRef(element);
      if (tab.isActive) {
        activeTabRef.current = element;
      }
    },
    [activeTabRef, setNodeRef, tab.isActive],
  );
  const style = useMemo<CSSProperties>(
    () => ({
      transform: CSS.Translate.toString(transform),
      transition,
    }),
    [transform, transition],
  );

  return (
    <div
      ref={setTabRef}
      style={style}
      className={cn(
        "shrink-0",
        !dragDisabled && "cursor-grab active:cursor-grabbing",
        // The lifted clone renders in the DragOverlay; fade the in-place source
        // to a placeholder marking where the tab will land.
        isDragging && "opacity-40",
        noDragClass,
      )}
      {...listeners}
    >
      <FileTab tab={tab} activeTreatment={activeTreatment} />
    </div>
  );
}

interface TabStripScrollButtonProps {
  buttonRef: RefObject<HTMLButtonElement | null>;
  direction: "left" | "right";
  hasOverflow: boolean;
  canScroll: boolean;
  className: string | null;
  onClick: () => void;
}

function TabStripScrollButton({
  buttonRef,
  direction,
  hasOverflow,
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
        "z-20 shrink-0 bg-sidebar text-muted-foreground shadow-none hover:bg-surface-raised-solid hover:text-foreground focus-visible:bg-sidebar",
        hasOverflow
          ? TAB_STRIP_SCROLL_BUTTON_CLASS
          : "h-7 w-0 overflow-hidden p-0 max-md:pointer-coarse:h-9",
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

function FileTab({
  tab,
  activeTreatment,
}: {
  tab: SecondaryPanelFileTab;
  activeTreatment: "fill" | "underline";
}) {
  const title =
    tab.statusLabel === null
      ? tab.filename
      : `${tab.filename} (${tab.statusLabel})`;
  return (
    <TabPill
      label={tab.filename}
      leadingVisual={tab.leadingVisual}
      secondaryLabel={tab.statusLabel === null ? null : `(${tab.statusLabel})`}
      title={title}
      isActive={tab.isActive}
      activeTreatment={activeTreatment}
      onSelect={tab.onSelect}
      labelMaxWidthClass="max-w-[160px]"
      closeAction={
        tab.isPinned
          ? null
          : {
              onClose: tab.onClose,
              closeLabel: `Close ${tab.filename}`,
              closeTooltip: "Close tab",
            }
      }
    />
  );
}
