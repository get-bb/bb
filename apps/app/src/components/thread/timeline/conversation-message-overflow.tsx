import {
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import {
  observeSharedResize,
  settleAfterSharedResizeWrites,
} from "@bb/shared-ui/lib/shared-resize-observer";
import { cn } from "@bb/shared-ui/lib/utils";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body";
import { useTimelinePositionKeeper } from "./TimelineWindowedItems.js";

interface UseOverflowMeasurementArgs {
  elementRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  axis: "horizontal" | "vertical";
  measurementKey: string;
}

function readOverflow(
  element: HTMLElement,
  axis: UseOverflowMeasurementArgs["axis"],
): boolean {
  return axis === "horizontal"
    ? element.scrollWidth > element.clientWidth + 1
    : element.scrollHeight > element.clientHeight + 1;
}

interface ConversationMessageOverflowToggleProps {
  expanded: boolean;
  onToggle: () => void;
}

interface ConversationMessageInlineOverflowToggleProps {
  buttonBackgroundClassName: string;
  fadeFromClassName: string;
  label: string;
  onToggle: () => void;
}

export function useIsOverflowing({
  elementRef,
  enabled,
  axis,
  measurementKey,
}: UseOverflowMeasurementArgs): boolean {
  const [overflowing, setOverflowing] = useState(false);
  const overflowingRef = useRef(false);
  const positionKeeper = useTimelinePositionKeeper();

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!enabled || element === null || typeof ResizeObserver === "undefined") {
      return;
    }
    return observeSharedResize(element, {
      read: () => (element.isConnected ? readOverflow(element, axis) : null),
      write: (next) => {
        if (next === null || next === overflowingRef.current) return;
        overflowingRef.current = next;
        setOverflowing(next);
        if (positionKeeper !== null) {
          settleAfterSharedResizeWrites(positionKeeper.reconcileAfterLayout);
        }
      },
    });
  }, [elementRef, enabled, axis, measurementKey, positionKeeper]);

  return enabled && overflowing;
}

function useContentHoldingToggle(
  expanding: boolean,
  onToggle: () => void,
): (event: MouseEvent<HTMLButtonElement>) => void {
  const bottomAnchor = useBottomAnchoredScroll();
  return (event) => {
    const scrollArea = bottomAnchor?.getScrollElement();
    const row = event.currentTarget.closest<HTMLElement>(
      "[data-timeline-row-id]",
    );
    if (!bottomAnchor || !scrollArea || !row) {
      onToggle();
      return;
    }
    const rowTopVisible =
      row.getBoundingClientRect().top >= scrollArea.getBoundingClientRect().top;
    bottomAnchor.holdContentPosition({
      edge: expanding || rowTopVisible ? "top" : "bottom",
      element: row,
      update: onToggle,
    });
  };
}

export function ConversationMessageOverflowToggle({
  expanded,
  onToggle,
}: ConversationMessageOverflowToggleProps) {
  const handleClick = useContentHoldingToggle(!expanded, onToggle);
  return (
    <div className="mt-1 flex justify-end">
      <button
        type="button"
        onClick={handleClick}
        className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}

export function ConversationMessageInlineOverflowToggle({
  buttonBackgroundClassName,
  fadeFromClassName,
  label,
  onToggle,
}: ConversationMessageInlineOverflowToggleProps) {
  const handleClick = useContentHoldingToggle(true, onToggle);
  return (
    <span className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[1lh] items-stretch justify-end">
      <span
        className={cn(
          "w-12 bg-gradient-to-l to-transparent",
          fadeFromClassName,
        )}
      />
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "pointer-events-auto cursor-pointer whitespace-nowrap pl-1.5 text-xs font-medium text-muted-foreground hover:text-foreground",
          buttonBackgroundClassName,
        )}
        aria-expanded={false}
      >
        {label}
      </button>
    </span>
  );
}
