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
import { Button } from "@/components/ui/button.js";
import { COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { Icon } from "@/components/ui/icon.js";
import { OverflowFade } from "@/components/ui/overflow-fade";
import { TabPill } from "@/components/ui/tab-pill";
import { useDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import { cn } from "@/lib/utils";
import {
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
} from "@/lib/bb-desktop";
import type {
  SecondaryPanelFileTab,
  SecondaryPanelTabReorderHandler,
} from "./secondaryPanelFileTab";
export type { SecondaryPanelFileTab } from "./secondaryPanelFileTab";

// How far a chevron click nudges the strip, in CSS pixels. Roughly one wide
// file tab so a click reveals the next tab without overshooting.
const CHEVRON_SCROLL_STEP_PX = 140;

// Slack so sub-pixel scroll offsets don't leave a fade/chevron stuck on at a
// hard edge.
const EDGE_EPSILON_PX = 1;

interface TabStripOverflowState {
  /** Scrolled away from the left edge (content hidden to the left). */
  canScrollLeft: boolean;
  /** More content remains to the right. */
  canScrollRight: boolean;
}

const INITIAL_OVERFLOW_STATE: TabStripOverflowState = {
  canScrollLeft: false,
  canScrollRight: false,
};

export interface SecondaryPanelTabStripProps {
  fileTabs: SecondaryPanelFileTab[];
  onReorderTab: SecondaryPanelTabReorderHandler;
  usesDesktopChrome: boolean;
}

interface SortableFileTabProps {
  activeTabRef: RefObject<HTMLDivElement | null>;
  dragDisabled: boolean;
  noDragClass: string | null;
  tab: SecondaryPanelFileTab;
}

/**
 * The middle, horizontally-scrolling region of the secondary panel tab strip.
 *
 * Only the file tabs scroll; the leading Info/Diff controls and the trailing
 * new-tab + panel-toggle controls stay anchored outside this component. Edge
 * fades and scroll chevrons appear only on a side that has more tabs, and the
 * active tab is auto-scrolled into view on mount and whenever it changes
 * (covering pointer, keyboard, and programmatic selection).
 */
export function SecondaryPanelTabStrip({
  fileTabs,
  onReorderTab,
  usesDesktopChrome,
}: SecondaryPanelTabStripProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<TabStripOverflowState>(
    INITIAL_OVERFLOW_STATE,
  );
  // Scroll capacity (max scrollLeft). Measured only on resize / tab-list change,
  // never per scroll: reading scrollWidth/clientWidth in a scroll handler forces
  // a synchronous reflow, which thrashes at narrow widths where every edge
  // crossing (and its fade/chevron repaint) re-dirties layout. The scroll handler
  // then reads only scrollLeft, which is cheap and doesn't flush layout.
  const maxScrollLeftRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const {
    beginDragClickSuppression,
    clearDragClickSuppressionSoon,
    consumeDragClickSuppression,
  } = useDragClickSuppression();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
  );
  const tabIds = useMemo(() => fileTabs.map((tab) => tab.id), [fileTabs]);
  const dragDisabled = fileTabs.length < 2;
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
    const isScrollable = maxScrollLeft > EDGE_EPSILON_PX;
    const { scrollLeft } = viewport;
    const canScrollLeft = isScrollable && scrollLeft > EDGE_EPSILON_PX;
    const canScrollRight =
      isScrollable && scrollLeft < maxScrollLeft - EDGE_EPSILON_PX;
    // Return the existing state object when neither flag changed so React bails
    // out of re-rendering. With the tab tree memoized, a real change only
    // repaints the always-mounted edge fades/chevrons (an opacity toggle).
    setOverflow((prev) =>
      prev.canScrollLeft === canScrollLeft &&
      prev.canScrollRight === canScrollRight
        ? prev
        : { canScrollLeft, canScrollRight },
    );
  }, []);

  // Expensive (reads scrollWidth/clientWidth): run only on resize / tab change,
  // then re-derive the edge flags from the fresh capacity.
  const measureCapacity = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    maxScrollLeftRef.current = viewport.scrollWidth - viewport.clientWidth;
    applyEdgeFlags();
  }, [applyEdgeFlags]);

  // Track the viewport's own scrolling and resizing. The ResizeObserver fires
  // once on observe (seeding the initial capacity + flags) and on every resize
  // (including the panel's drag-resize, which changes clientWidth).
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
    resizeObserver.observe(viewport);
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

  // Bring the active tab into view on mount and on every active-tab change. This
  // is the single hook that covers click, keyboard focus, and programmatic
  // selection. jsdom doesn't implement scrollIntoView, so guard the call.
  const activeTabId = fileTabs.find((tab) => tab.isActive)?.id ?? null;
  useLayoutEffect(() => {
    const activeTabElement = activeTabRef.current;
    if (activeTabElement === null) {
      return;
    }
    activeTabElement.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeTabId]);

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

  const scrollByStep = (direction: -1 | 1) => {
    viewportRef.current?.scrollBy({
      left: direction * CHEVRON_SCROLL_STEP_PX,
      behavior: "smooth",
    });
  };
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

  // Memoize the sortable tab tree so the overflow-flag state — which flips every
  // time you reach a scroll edge, i.e. constantly at narrow widths — re-renders
  // only the edge fades/chevrons, never the tabs. Without this, each edge
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
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          {fileTabs.map((tab) => (
            <SortableFileTab
              key={tab.id}
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
            {draggingTab === null ? null : <FileTab tab={draggingTab} />}
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
    ],
  );

  return (
    // Hugs its tabs (no `flex-1`) and shrinks (`min-w-0`) to scroll them under
    // the edge fades/chevrons when they overflow. The New Tab button is pinned
    // ahead of the strip (left-aligned), so it holds a fixed position instead of
    // riding the last tab rightward as tabs are added.
    <div
      data-testid="secondary-panel-tab-strip"
      className="group relative flex min-w-0 items-center"
    >
      {/* Fades + chevrons stay mounted and just toggle opacity as you reach an
          edge — mounting/unmounting them mid-scroll committed DOM and dirtied
          layout every edge crossing, which at narrow widths is constant. */}
      <OverflowFade
        placement="left"
        className={cn(
          "z-10 transition-opacity",
          overflow.canScrollLeft ? "opacity-100" : "opacity-0",
        )}
      />
      <OverflowFade
        placement="right"
        className={cn(
          "z-10 transition-opacity",
          overflow.canScrollRight ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={viewportRef}
        onClickCapture={handleClickCapture}
        // No `scroll-smooth` here: wheel translation assigns scrollLeft directly
        // (see the wheel handler), and CSS smooth-scroll would turn each wheel
        // notch into its own ~150ms animation — the strip advances, sits frozen
        // between notches, then jumps. Letting it track 1:1 matches native
        // horizontal trackpad scrolling. The chevron buttons opt back into smooth
        // per-call via `scrollBy({ behavior: "smooth" })`.
        className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden"
      >
        {dndTabs}
      </div>
      <TabStripScrollChevron
        direction="left"
        canScroll={overflow.canScrollLeft}
        className={chevronNoDragClass}
        onClick={() => scrollByStep(-1)}
      />
      <TabStripScrollChevron
        direction="right"
        canScroll={overflow.canScrollRight}
        className={chevronNoDragClass}
        onClick={() => scrollByStep(1)}
      />
    </div>
  );
}

function SortableFileTab({
  activeTabRef,
  dragDisabled,
  noDragClass,
  tab,
}: SortableFileTabProps) {
  const {
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
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
      <FileTab tab={tab} />
    </div>
  );
}

interface TabStripScrollChevronProps {
  direction: "left" | "right";
  canScroll: boolean;
  className: string | null;
  onClick: () => void;
}

function TabStripScrollChevron({
  direction,
  canScroll,
  className,
  onClick,
}: TabStripScrollChevronProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      // Decorative scroll control: every tab is already reachable via Tab, so
      // keep the chevron out of the tab order (tabIndex -1) to avoid duplicate
      // stops. It stays mounted (so reaching an edge is an opacity toggle, not a
      // DOM commit); when there's nothing to scroll, aria-hidden +
      // pointer-events-none + opacity-0 (below) make it inert and invisible.
      // Deliberately NOT the `disabled` attribute: Button carries
      // `disabled:opacity-50`, which would beat the `opacity-0` hide and leave
      // both chevrons painted at half opacity on every strip that doesn't
      // overflow. aria-hidden already removes it from assistive tech, so
      // `disabled` would add no a11y here anyway.
      tabIndex={-1}
      aria-hidden={!canScroll}
      onClick={onClick}
      aria-label={
        direction === "left" ? "Scroll tabs left" : "Scroll tabs right"
      }
      className={cn(
        // The chevron rides the edge fade instead of occluding the tab beneath
        // it: its backdrop is the same transparent→surface gradient as the
        // OverflowFade (stacked over the always-on fade), so the edge tab
        // dissolves smoothly under the arrow rather than being hard-cut by a
        // solid tile. The ghost hover fill is suppressed so hovering never
        // re-introduces that opaque block; the arrow brightens on hover instead.
        // The arrow is edge-aligned (justify-start/end) so it hugs the opaque
        // edge of the fade and clears the central tabs — rather than nudging the
        // button itself outward, which a clipping ancestor would cut off.
        "absolute z-50 shrink-0 text-muted-foreground hover:bg-transparent focus-visible:bg-transparent",
        direction === "left"
          ? "left-0 justify-start bg-gradient-to-l from-transparent to-background"
          : "right-0 justify-end bg-gradient-to-r from-transparent to-background",
        COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
        // Always mounted (so reaching an edge toggles opacity rather than
        // committing/removing DOM mid-scroll), revealed only while the strip is
        // hovered/focused AND there is actually more to scroll in this direction.
        // `pointer-events` follow visibility so a hidden chevron never intercepts
        // clicks meant for the tab beneath it.
        "pointer-events-none opacity-0 transition-opacity",
        canScroll &&
          "group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
        className,
      )}
    >
      <Icon name={direction === "left" ? "ChevronLeft" : "ChevronRight"} />
    </Button>
  );
}

function FileTab({ tab }: { tab: SecondaryPanelFileTab }) {
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
