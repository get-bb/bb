import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import { observeSharedResize } from "@/lib/shared-resize-observer";

export const ROW_WINDOW_THRESHOLD = 120;
const ROW_WINDOW_OVERSCAN_PX = 800;
const ROW_WINDOW_FALLBACK_ROWS = 60;
const ROW_WINDOW_SCROLL_STEP_PX = 200;

export interface RowWindowInput {
  counts: readonly number[];
  headerHeight: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
}

export type RowRange = readonly [start: number, end: number];

export function rowWindows({
  counts,
  headerHeight,
  rowHeight,
  scrollTop,
  viewportHeight,
}: RowWindowInput): RowRange[] {
  const ranges: RowRange[] = [];
  let top = 0;
  for (const count of counts) {
    top += headerHeight;
    if (count < ROW_WINDOW_THRESHOLD) {
      ranges.push([0, count]);
    } else if (viewportHeight <= 0 || rowHeight <= 0) {
      ranges.push([0, Math.min(count, ROW_WINDOW_FALLBACK_ROWS)]);
    } else {
      const from = scrollTop - ROW_WINDOW_OVERSCAN_PX - top;
      const to = scrollTop + viewportHeight + ROW_WINDOW_OVERSCAN_PX - top;
      const start = Math.min(count, Math.max(0, Math.floor(from / rowHeight)));
      const end = Math.min(count, Math.max(start, Math.ceil(to / rowHeight)));
      ranges.push([start, end]);
    }
    top += count * rowHeight;
  }
  return ranges;
}

interface Viewport {
  scrollTop: number;
  height: number;
  rowHeight: number;
  headerHeight: number;
}

interface MeasuredViewport {
  scrollTop: number;
  height: number;
  rowHeight: number | null;
  headerHeight: number | null;
}

export function useRowWindowViewport(
  scrollRef: RefObject<HTMLElement | null>,
  measureKey: unknown,
): Viewport {
  const [viewport, setViewport] = useState<Viewport>({
    scrollTop: 0,
    height: 0,
    rowHeight: 0,
    headerHeight: 0,
  });
  const frame = useRef<number | null>(null);

  const measure = useCallback((): MeasuredViewport | null => {
    const element = scrollRef.current;
    if (element === null) return null;
    const row = element.querySelector<HTMLElement>("[data-task-key]");
    const header = element.querySelector<HTMLElement>(
      "[data-status-group-header]",
    );
    return {
      scrollTop:
        Math.floor(element.scrollTop / ROW_WINDOW_SCROLL_STEP_PX) *
        ROW_WINDOW_SCROLL_STEP_PX,
      height: element.clientHeight,
      rowHeight: row?.offsetHeight ?? null,
      headerHeight: header?.offsetHeight ?? null,
    };
  }, [scrollRef]);

  const apply = useCallback((measured: MeasuredViewport | null) => {
    if (measured === null) return;
    setViewport((current) => {
      const next: Viewport = {
        scrollTop: measured.scrollTop,
        height: measured.height,
        rowHeight: measured.rowHeight ?? current.rowHeight,
        headerHeight: measured.headerHeight ?? current.headerHeight,
      };
      return next.scrollTop === current.scrollTop &&
        next.height === current.height &&
        next.rowHeight === current.rowHeight &&
        next.headerHeight === current.headerHeight
        ? current
        : next;
    });
  }, []);

  const read = useCallback(() => apply(measure()), [apply, measure]);

  useLayoutEffect(() => {
    read();
  }, [read, measureKey]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const onScroll = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        read();
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    const unobserve =
      typeof ResizeObserver === "function"
        ? observeSharedResize(element, { read: measure, write: apply })
        : null;
    return () => {
      element.removeEventListener("scroll", onScroll);
      unobserve?.();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [scrollRef, read, measure, apply]);

  return viewport;
}
