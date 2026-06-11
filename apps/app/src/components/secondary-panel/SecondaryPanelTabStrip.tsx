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

  const recomputeOverflow = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    const { scrollLeft, scrollWidth, clientWidth } = viewport;
    const maxScrollLeft = scrollWidth - clientWidth;
    const isScrollable = maxScrollLeft > EDGE_EPSILON_PX;
    setOverflow({
      canScrollLeft: isScrollable && scrollLeft > EDGE_EPSILON_PX,
      canScrollRight:
        isScrollable && scrollLeft < maxScrollLeft - EDGE_EPSILON_PX,
    });
  }, []);

  // Track the viewport's own scrolling and resizing. The ResizeObserver also
  // fires once on observe, seeding the initial overflow state.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    viewport.addEventListener("scroll", recomputeOverflow, { passive: true });
    const resizeObserver = new ResizeObserver(recomputeOverflow);
    resizeObserver.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", recomputeOverflow);
      resizeObserver.disconnect();
    };
  }, [recomputeOverflow]);

  // The set of tabs can change width without resizing the viewport (open/close,
  // rename), so recompute whenever the tab list changes.
  useEffect(() => {
    recomputeOverflow();
  }, [fileTabs, recomputeOverflow]);

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
      if (event.deltaY === 0) {
        return;
      }
      const { scrollLeft, scrollWidth, clientWidth } = viewport;
      const maxScrollLeft = scrollWidth - clientWidth;
      if (maxScrollLeft <= EDGE_EPSILON_PX) {
        return;
      }
      const canScrollInWheelDirection =
        event.deltaY > 0
          ? scrollLeft < maxScrollLeft - EDGE_EPSILON_PX
          : scrollLeft > EDGE_EPSILON_PX;
      if (!canScrollInWheelDirection) {
        return;
      }
      viewport.scrollLeft += event.deltaY;
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

  return (
    // Sized to its tabs (no `flex-1`) so the New Tab button that follows it
    // stays immediately to the right of the last tab instead of being pushed to
    // the far panel edge by leftover space. It still shrinks (`min-w-0`) when the
    // tabs overflow, scrolling them under the edge fades/chevrons.
    <div
      data-testid="secondary-panel-tab-strip"
      className="group relative flex min-w-0 items-center"
    >
      {overflow.canScrollLeft ? (
        <OverflowFade placement="left" className="z-10" />
      ) : null}
      {overflow.canScrollRight ? (
        <OverflowFade placement="right" className="z-10" />
      ) : null}
      <div
        ref={viewportRef}
        onClickCapture={handleClickCapture}
        className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden scroll-smooth"
      >
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
                activeTabRef={activeTabRef}
                dragDisabled={dragDisabled}
                noDragClass={noDragClass}
                tab={tab}
              />
            ))}
          </SortableContext>
          {/* The lifted tab follows the pointer on both axes and must not be
              clipped by the viewport's `overflow` or stretch its scroll width,
              so render it as a fixed-position clone portaled out of the strip
              rather than translating the in-place tab. */}
          {createPortal(
            <DragOverlay className="cursor-grabbing">
              {draggingTab === null ? null : <FileTab tab={draggingTab} />}
            </DragOverlay>,
            document.body,
          )}
        </DndContext>
      </div>
      {overflow.canScrollLeft ? (
        <TabStripScrollChevron
          direction="left"
          className={chevronNoDragClass}
          onClick={() => scrollByStep(-1)}
        />
      ) : null}
      {overflow.canScrollRight ? (
        <TabStripScrollChevron
          direction="right"
          className={chevronNoDragClass}
          onClick={() => scrollByStep(1)}
        />
      ) : null}
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
  className: string | null;
  onClick: () => void;
}

function TabStripScrollChevron({
  direction,
  className,
  onClick,
}: TabStripScrollChevronProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      // Decorative scroll control: every tab is already reachable via Tab, so
      // keep the chevron out of the tab order to avoid duplicate stops.
      tabIndex={-1}
      onClick={onClick}
      aria-label={
        direction === "left" ? "Scroll tabs left" : "Scroll tabs right"
      }
      className={cn(
        // Solid panel-surface fills, so the chevron fully occludes the tab
        // labels beneath it instead of letting them bleed through. The normal
        // state matches the fade edge; hover/focus use `bg-muted` rather than
        // translucent state overlays because these controls sit on top of
        // partially hidden tab content.
        "absolute z-50 shrink-0 bg-background hover:bg-muted focus-visible:bg-muted",
        COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
        // Revealed only while the strip is hovered (or the chevron itself is
        // focused) so the chevrons don't permanently cover the edge tabs;
        // `pointer-events` follow visibility so a hidden chevron never
        // intercepts clicks meant for the tab beneath it.
        "pointer-events-none opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
        direction === "left" ? "left-0" : "right-0",
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
