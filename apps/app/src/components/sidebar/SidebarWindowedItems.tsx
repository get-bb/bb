import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  SIDEBAR_CONTENT_SELECTOR,
  useSidebarContentElementRef,
} from "@/components/ui/sidebar.js";
import {
  encodeSidebarWindowedNavigationEntries,
  SIDEBAR_WINDOWED_NAV_ATTRIBUTE,
  type SidebarWindowedNavigationEntry,
} from "./sidebarThreadShortcuts";

// Items within this distance of the scrollport stay mounted, so scrolling
// promotes rows before they become visible.
const WINDOW_VIEWPORT_MARGIN_PX = 240;
// Fallback placeholder row height until a real row height has been measured.
const DEFAULT_ROW_HEIGHT_PX = 30;

interface MeasuredItemHeight {
  height: number;
  // The visible-row count the height was measured under. A collapse toggle
  // inside a placeholder changes its row count, which invalidates the
  // measurement — otherwise the stale height would misplace the scrollbar.
  rows: number;
}

interface SidebarWindowedItemsProps {
  /** Stable per-item keys, aligned with `renderItem` indices. */
  itemKeys: readonly string[];
  /**
   * Rough visible-row count per item under the current collapse state. Only
   * feeds placeholder-height estimates; measured heights take over once an
   * item has been on screen.
   */
  estimateRows: (index: number) => number;
  /**
   * Keys that must stay mounted regardless of visibility — the item holding
   * the active thread, so DOM-driven keyboard navigation keeps a target.
   */
  alwaysMountedKeys?: ReadonlySet<string>;
  /**
   * Threads an item's subtree renders, in visual order. Placeholders expose
   * them via a data attribute so thread.next / thread.previous cover
   * windowed-out rows too.
   */
  getNavigationEntries?: (
    index: number,
  ) => readonly SidebarWindowedNavigationEntry[];
  renderItem: (index: number) => ReactNode;
}

const EMPTY_KEY_SET: ReadonlySet<string> = new Set();

/**
 * Windows a sidebar item list against the sidebar scroll container (#1261).
 *
 * Items near the scrollport render for real; the rest render as fixed-height
 * placeholder divs, so mounted rows scale with the viewport instead of the
 * thread count. Placeholders keep the item's measured (or estimated) height,
 * which keeps the scrollbar and scroll position stable without absolute
 * positioning — rows stay in normal flow, so the CSS sticky-header stack,
 * `space-y` gaps, and drag-and-drop DOM order all behave exactly as in the
 * unwindowed list.
 *
 * Promotion runs in two tiers: a pre-paint layout pass whenever the key list
 * changes (no placeholder flash on mount), then an IntersectionObserver with
 * a generous margin for scrolling. When no usable scrollport exists (jsdom,
 * detached previews), every item renders for real.
 */
export function SidebarWindowedItems({
  itemKeys,
  estimateRows,
  alwaysMountedKeys = EMPTY_KEY_SET,
  getNavigationEntries,
  renderItem,
}: SidebarWindowedItemsProps) {
  const scrollElementRef = useSidebarContentElementRef();
  // A sidebar can contain many short sibling lists. Rendering each short list
  // in full makes their aggregate offscreen subtree large, so every non-empty
  // list participates in the shared-scrollport window.
  const windowingEnabled = itemKeys.length > 0 && scrollElementRef !== null;

  const [realizedKeys, setRealizedKeys] =
    useState<ReadonlySet<string>>(EMPTY_KEY_SET);
  const measuredHeightsRef = useRef(new Map<string, MeasuredItemHeight>());
  const rowHeightRef = useRef(DEFAULT_ROW_HEIGHT_PX);
  const wrapperByKeyRef = useRef(new Map<string, HTMLDivElement>());
  const keyByWrapperRef = useRef(new Map<Element, string>());
  const wrapperRefCallbacksRef = useRef(
    new Map<string, (node: HTMLDivElement | null) => void>(),
  );
  const observerRef = useRef<IntersectionObserver | null>(null);
  const alwaysMountedKeysRef = useRef(alwaysMountedKeys);
  alwaysMountedKeysRef.current = alwaysMountedKeys;
  const estimateRowsRef = useRef(estimateRows);
  estimateRowsRef.current = estimateRows;
  const rowsByKeyRef = useRef(new Map<string, number>());

  const keySignature = useMemo(() => itemKeys.join("\u0000"), [itemKeys]);

  const getWrapperRefCallback = useCallback((key: string) => {
    const callbacks = wrapperRefCallbacksRef.current;
    let callback = callbacks.get(key);
    if (!callback) {
      callback = (node: HTMLDivElement | null) => {
        const previous = wrapperByKeyRef.current.get(key);
        if (previous && previous !== node) {
          keyByWrapperRef.current.delete(previous);
          observerRef.current?.unobserve(previous);
        }
        if (node) {
          wrapperByKeyRef.current.set(key, node);
          keyByWrapperRef.current.set(node, key);
          observerRef.current?.observe(node);
        } else {
          wrapperByKeyRef.current.delete(key);
        }
      };
      callbacks.set(key, callback);
    }
    return callback;
  }, []);

  // React attaches a host element's ref after its descendants' layout effects
  // have run, so when this list commits in the same pass as `SidebarContent`
  // (warm boot, direct thread-route load, mobile deferred realization) the
  // context ref is still empty here. The wrapper divs are our own children,
  // so their refs are already populated; walk up from one of them instead of
  // falling into promote-all and demoting every row a moment later.
  const resolveScrollElement = useCallback((): Element | null => {
    const fromRef = scrollElementRef?.current ?? null;
    if (fromRef) {
      return fromRef;
    }
    const firstWrapper = wrapperByKeyRef.current.values().next();
    return firstWrapper.done
      ? null
      : firstWrapper.value.closest(SIDEBAR_CONTENT_SELECTOR);
  }, [scrollElementRef]);

  const recordMeasuredHeight = useCallback((key: string, height: number) => {
    if (height <= 0) {
      return;
    }
    const rows = rowsByKeyRef.current.get(key) ?? 0;
    measuredHeightsRef.current.set(key, { height, rows });
    if (rows > 0) {
      // Calibrate the per-row estimate from real rows so never-measured
      // placeholders track coarse-pointer row heights too.
      const perRow = height / rows;
      if (perRow >= 20 && perRow <= 80) {
        rowHeightRef.current = perRow;
      }
    }
  }, []);

  // Pre-paint promotion whenever the item set changes: mount everything that
  // sits inside the scrollport plus margin before the browser paints, so the
  // initial view never flashes placeholders. Also prunes state for keys that
  // left the list. With no usable viewport (jsdom, previews) it promotes
  // everything.
  useLayoutEffect(() => {
    if (!windowingEnabled) {
      if (realizedKeys.size > 0) {
        setRealizedKeys(EMPTY_KEY_SET);
      }
      return;
    }

    const keySet = new Set(itemKeys);
    for (const staleMap of [
      measuredHeightsRef.current,
      rowsByKeyRef.current,
      wrapperRefCallbacksRef.current,
    ] as const) {
      for (const key of staleMap.keys()) {
        if (!keySet.has(key)) {
          staleMap.delete(key);
        }
      }
    }

    const scrollElement = resolveScrollElement();
    const promoteAll =
      !scrollElement ||
      scrollElement.clientHeight === 0 ||
      typeof IntersectionObserver === "undefined";

    const next = new Set<string>();
    for (const key of realizedKeys) {
      if (keySet.has(key)) {
        next.add(key);
      }
    }

    if (promoteAll) {
      for (const key of itemKeys) {
        next.add(key);
      }
    } else {
      const viewport = scrollElement.getBoundingClientRect();
      const viewportTop = viewport.top - WINDOW_VIEWPORT_MARGIN_PX;
      const viewportBottom = viewport.bottom + WINDOW_VIEWPORT_MARGIN_PX;
      for (const [key, element] of wrapperByKeyRef.current) {
        if (next.has(key) || !keySet.has(key)) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.bottom >= viewportTop && rect.top <= viewportBottom) {
          next.add(key);
        }
      }
    }

    if (
      next.size !== realizedKeys.size ||
      ![...next].every((key) => realizedKeys.has(key))
    ) {
      setRealizedKeys(next);
    }
    // The pass re-runs only when the key list (or windowing mode) changes;
    // scroll-driven changes are the observer's job.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [windowingEnabled, keySignature]);

  useEffect(() => {
    if (!windowingEnabled || typeof IntersectionObserver === "undefined") {
      return;
    }
    const scrollElement = resolveScrollElement();
    if (!scrollElement || scrollElement.clientHeight === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // Scroll-driven promotion runs 240px ahead of the viewport, so it
        // can afford to be interruptible: a transition lets React slice the
        // row mounts across frames instead of blocking the scroll.
        startTransition(() =>
          setRealizedKeys((previous) => {
            let next: Set<string> | null = null;
            for (const entry of entries) {
              const key = keyByWrapperRef.current.get(entry.target);
              if (key === undefined) {
                continue;
              }
              if (entry.isIntersecting) {
                if (!previous.has(key) && !next?.has(key)) {
                  next ??= new Set(previous);
                  next.add(key);
                }
              } else if (
                (next?.has(key) ?? previous.has(key)) &&
                !alwaysMountedKeysRef.current.has(key)
              ) {
                recordMeasuredHeight(key, entry.boundingClientRect.height);
                next ??= new Set(previous);
                next.delete(key);
              }
            }
            return next ?? previous;
          }),
        );
      },
      {
        root: scrollElement,
        rootMargin: `${WINDOW_VIEWPORT_MARGIN_PX}px 0px`,
      },
    );
    observerRef.current = observer;
    for (const element of wrapperByKeyRef.current.values()) {
      observer.observe(element);
    }
    return () => {
      observerRef.current = null;
      observer.disconnect();
    };
  }, [windowingEnabled, resolveScrollElement, recordMeasuredHeight]);

  if (!windowingEnabled) {
    return <>{itemKeys.map((_, index) => renderItem(index))}</>;
  }

  return (
    <>
      {itemKeys.map((key, index) => {
        const isRealized = realizedKeys.has(key) || alwaysMountedKeys.has(key);
        const rows = Math.max(1, estimateRowsRef.current(index));
        rowsByKeyRef.current.set(key, rows);
        let placeholderHeight: number | undefined;
        let navigationValue: string | undefined;
        if (!isRealized) {
          const measured = measuredHeightsRef.current.get(key);
          placeholderHeight =
            measured && measured.rows === rows
              ? measured.height
              : rows * rowHeightRef.current;
          const entries = getNavigationEntries?.(index);
          navigationValue =
            entries && entries.length > 0
              ? encodeSidebarWindowedNavigationEntries(entries)
              : undefined;
        }
        return (
          <div
            key={key}
            ref={getWrapperRefCallback(key)}
            data-sidebar-windowed-item=""
            {...(navigationValue !== undefined
              ? { [SIDEBAR_WINDOWED_NAV_ATTRIBUTE]: navigationValue }
              : undefined)}
            style={isRealized ? undefined : { height: placeholderHeight }}
          >
            {isRealized ? renderItem(index) : null}
          </div>
        );
      })}
    </>
  );
}
