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
} from "../ui/sidebar.js";
import {
  encodeSidebarWindowedNavigationEntries,
  SIDEBAR_WINDOWED_NAV_ATTRIBUTE,
  type SidebarWindowedNavigationEntry,
} from "./sidebarThreadShortcuts.js";

const WINDOW_VIEWPORT_MARGIN_PX = 240;
const DEFAULT_ROW_HEIGHT_PX = 30;

interface MeasuredItemHeight {
  height: number;
  rows: number;
}

interface SidebarWindowedItemsProps {
  itemKeys: readonly string[];
  focusItemKey?: string;
  estimateRows: (index: number) => number;
  alwaysMountedKeys?: ReadonlySet<string>;
  getNavigationEntries?: (
    index: number,
  ) => readonly SidebarWindowedNavigationEntry[];
  renderItem: (index: number) => ReactNode;
}

const EMPTY_KEY_SET: ReadonlySet<string> = new Set();

function mergeRealizedKeys(
  previous: ReadonlySet<string>,
  {
    add,
    remove,
    retain,
  }: {
    add?: ReadonlySet<string> | readonly string[];
    remove?: ReadonlySet<string> | readonly string[];
    retain?: ReadonlySet<string>;
  },
): ReadonlySet<string> {
  let next: Set<string> | null = null;
  const current = () => next ?? previous;
  if (retain) {
    for (const key of previous) {
      if (!retain.has(key)) {
        next ??= new Set(previous);
        next.delete(key);
      }
    }
  }
  for (const key of remove ?? EMPTY_KEY_SET) {
    if (current().has(key)) {
      next ??= new Set(previous);
      next.delete(key);
    }
  }
  for (const key of add ?? EMPTY_KEY_SET) {
    if (!current().has(key)) {
      next ??= new Set(previous);
      next.add(key);
    }
  }
  return next ?? previous;
}

export function SidebarWindowedItems({
  itemKeys,
  focusItemKey,
  estimateRows,
  alwaysMountedKeys = EMPTY_KEY_SET,
  getNavigationEntries,
  renderItem,
}: SidebarWindowedItemsProps) {
  const scrollElementRef = useSidebarContentElementRef();
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

  useLayoutEffect(() => {
    if (!focusItemKey) return;
    const wrapper = wrapperByKeyRef.current.get(focusItemKey);
    const target = wrapper?.querySelector<HTMLElement>(
      "a[data-sidebar-thread-id], button[aria-expanded]",
    );
    target?.focus();
  }, [focusItemKey]);

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
      const perRow = height / rows;
      if (perRow >= 20 && perRow <= 80) {
        rowHeightRef.current = perRow;
      }
    }
  }, []);

  useLayoutEffect(() => {
    if (!windowingEnabled) {
      setRealizedKeys((previous) =>
        previous.size > 0 ? EMPTY_KEY_SET : previous,
      );
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

    const promoted = new Set<string>();
    if (promoteAll) {
      for (const key of itemKeys) {
        promoted.add(key);
      }
    } else {
      const viewport = scrollElement.getBoundingClientRect();
      const viewportTop = viewport.top - WINDOW_VIEWPORT_MARGIN_PX;
      const viewportBottom = viewport.bottom + WINDOW_VIEWPORT_MARGIN_PX;
      for (const [key, element] of wrapperByKeyRef.current) {
        if (promoted.has(key) || !keySet.has(key)) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.bottom >= viewportTop && rect.top <= viewportBottom) {
          promoted.add(key);
        }
      }
    }

    setRealizedKeys((previous) =>
      mergeRealizedKeys(previous, { add: promoted, retain: keySet }),
    );

    const observer = observerRef.current;
    if (observer) {
      for (const element of wrapperByKeyRef.current.values()) {
        observer.unobserve(element);
        observer.observe(element);
      }
    }
    // oxlint-disable-next-line react/exhaustive-deps
  }, [windowingEnabled, keySignature]);

  useEffect(() => {
    if (!windowingEnabled || typeof IntersectionObserver === "undefined") {
      return;
    }
    const scrollElement = resolveScrollElement();
    if (!scrollElement) {
      return;
    }

    let observer: IntersectionObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const connect = () => {
      if (observer || scrollElement.clientHeight === 0) {
        return;
      }
      observer = new IntersectionObserver(
        (entries) => {
          const intended = new Map<string, boolean>();
          for (const entry of entries) {
            const key = keyByWrapperRef.current.get(entry.target);
            if (key === undefined) {
              continue;
            }
            if (entry.isIntersecting) {
              intended.set(key, true);
            } else if (!alwaysMountedKeysRef.current.has(key)) {
              intended.set(key, false);
              recordMeasuredHeight(key, entry.boundingClientRect.height);
            }
          }
          if (intended.size === 0) {
            return;
          }
          const entering: string[] = [];
          const leaving: string[] = [];
          for (const [key, isEntering] of intended) {
            (isEntering ? entering : leaving).push(key);
          }
          startTransition(() =>
            setRealizedKeys((previous) =>
              mergeRealizedKeys(previous, { add: entering, remove: leaving }),
            ),
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
      resizeObserver?.disconnect();
      resizeObserver = null;
    };

    connect();
    if (!observer && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => connect());
      resizeObserver.observe(scrollElement);
    }

    return () => {
      resizeObserver?.disconnect();
      observerRef.current = null;
      observer?.disconnect();
    };
  }, [windowingEnabled, resolveScrollElement, recordMeasuredHeight]);

  return (
    <>
      {itemKeys.map((key, index) => {
        const isRealized =
          !windowingEnabled ||
          realizedKeys.has(key) ||
          alwaysMountedKeys.has(key) ||
          focusItemKey === key;
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
