import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { useComposedRefs } from "@radix-ui/react-compose-refs";
import {
  defaultRangeExtractor,
  observeElementOffset,
  useVirtualizer,
  type Range,
  type Virtualizer,
} from "@tanstack/react-virtual";
import {
  DEFAULT_WINDOWING_MIN_ITEM_COUNT,
  recordTimelineMeasurement,
  type TimelineWindowedItemsProps,
  type TimelineWindowInitialScroll,
} from "./TimelineWindowedItemsLoader.js";

const TIMELINE_WINDOW_OVERSCAN_ITEMS = 8;
const TIMELINE_WINDOW_MAX_INTERACTION_PINS = 24;

const EMPTY_KEY_SET: ReadonlySet<string> = new Set();
const GET_NO_SCROLL_ELEMENT = () => null;

let lastKnownScrollViewportHeight = 800;

function readScrollViewportHeight(scrollElement: HTMLElement | null): number {
  if (scrollElement === null) return lastKnownScrollViewportHeight;
  const height = scrollElement.clientHeight;
  if (height > 0) lastKnownScrollViewportHeight = height;
  return height;
}

interface ResolveInitialWindowOffsetArgs {
  estimateSize: (index: number) => number;
  gap: number;
  indexByKey: ReadonlyMap<string, number>;
  initialScroll: TimelineWindowInitialScroll;
  itemCount: number;
  scrollMargin: number;
  viewportHeight: number;
}

function resolveInitialWindowOffset({
  estimateSize,
  gap,
  indexByKey,
  initialScroll,
  itemCount,
  scrollMargin,
  viewportHeight,
}: ResolveInitialWindowOffsetArgs): number {
  const targetIndex =
    initialScroll.kind === "item"
      ? indexByKey.get(initialScroll.key)
      : undefined;
  const endIndex = targetIndex ?? itemCount;
  let offset = scrollMargin;
  for (let index = 0; index < endIndex; index += 1) {
    offset += estimateSize(index) + gap;
  }
  if (targetIndex !== undefined) return offset;
  return Math.max(0, offset - (itemCount > 0 ? gap : 0) - viewportHeight);
}

function measureBorderBox(
  element: HTMLElement,
  entry: ResizeObserverEntry | undefined,
): number {
  const observedHeight = entry?.borderBoxSize[0]?.blockSize;
  return observedHeight ?? element.getBoundingClientRect().height;
}

function findOwnedWindowKey(
  target: EventTarget | null,
  container: HTMLElement,
  indexByKey: ReadonlyMap<string, number>,
): string | null {
  let element = target instanceof Element ? target : null;
  while (element !== null && element !== container) {
    const key = element.getAttribute("data-timeline-window-key");
    if (key !== null && indexByKey.has(key)) return key;
    element = element.parentElement;
  }
  return null;
}

export function TimelineWindowedItems({
  alwaysMountedKeys = EMPTY_KEY_SET,
  estimateItemHeight,
  gap,
  getScrollElement,
  initialScroll,
  itemKeys,
  measurements,
  minItemCount = DEFAULT_WINDOWING_MIN_ITEM_COUNT,
  renderItem,
}: TimelineWindowedItemsProps) {
  const configured =
    itemKeys.length >= minItemCount && getScrollElement !== null;
  const resolvedGetScrollElement = getScrollElement ?? GET_NO_SCROLL_ELEMENT;
  const [scrollRootUsable, setScrollRootUsable] = useState(true);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [interactionPins, setInteractionPins] = useState<readonly string[]>([]);
  const [scrollElementAvailable, setScrollElementAvailable] = useState(
    () => resolvedGetScrollElement() !== null,
  );
  const [initialRect] = useState(() => ({
    width: 0,
    height: readScrollViewportHeight(resolvedGetScrollElement()),
  }));
  const initialScrollPendingRef = useRef(initialScroll !== undefined);
  const readDomOffsetOnAttachRef = useRef(
    initialScroll !== undefined && !scrollElementAvailable,
  );
  const containerElementRef = useRef<HTMLDivElement>(null);
  const windowingEnabled = configured && scrollRootUsable;

  const indexByKey = useMemo(
    () => new Map(itemKeys.map((key, index) => [key, index])),
    [itemKeys],
  );
  const forcedIndexes = useMemo(() => {
    const indexes = new Set<number>();
    for (const key of alwaysMountedKeys) {
      const index = indexByKey.get(key);
      if (index !== undefined) indexes.add(index);
    }
    for (const key of interactionPins) {
      const index = indexByKey.get(key);
      if (index !== undefined) indexes.add(index);
    }
    return indexes;
  }, [alwaysMountedKeys, indexByKey, interactionPins]);

  const getItemKey = useCallback(
    (index: number) => itemKeys[index] ?? index,
    [itemKeys],
  );
  const estimateSize = useCallback(
    (index: number) => {
      const key = itemKeys[index];
      return key === undefined
        ? Math.max(1, estimateItemHeight(index))
        : (measurements.get(key) ?? Math.max(1, estimateItemHeight(index)));
    },
    [estimateItemHeight, itemKeys, measurements],
  );
  const measureElement = useCallback(
    (
      element: HTMLDivElement,
      entry: ResizeObserverEntry | undefined,
    ): number => {
      const index = Number(element.dataset.index);
      const height = measureBorderBox(element, entry);
      const key = Number.isInteger(index) ? itemKeys[index] : undefined;
      if (
        key !== undefined &&
        height > 0 &&
        element.dataset.timelineWindowedRealized === "true"
      ) {
        recordTimelineMeasurement(measurements, key, height);
      }
      return height > 0 ? height : estimateSize(index);
    },
    [estimateSize, itemKeys, measurements],
  );
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = new Set(defaultRangeExtractor(range));
      for (const index of forcedIndexes) indexes.add(index);
      return [...indexes].sort((left, right) => left - right);
    },
    [forcedIndexes],
  );
  const initialOffset = useCallback(() => {
    const scrollElement = resolvedGetScrollElement();
    if (initialScroll === undefined || !initialScrollPendingRef.current) {
      return scrollElement?.scrollTop ?? 0;
    }
    return resolveInitialWindowOffset({
      estimateSize,
      gap,
      indexByKey,
      initialScroll,
      itemCount: itemKeys.length,
      scrollMargin,
      viewportHeight: readScrollViewportHeight(scrollElement),
    });
  }, [
    estimateSize,
    gap,
    indexByKey,
    initialScroll,
    itemKeys.length,
    resolvedGetScrollElement,
    scrollMargin,
  ]);
  const observeScrollOffset = useCallback(
    (
      instance: Virtualizer<HTMLElement, HTMLDivElement>,
      onOffset: (offset: number, isScrolling: boolean) => void,
    ) => {
      const unsubscribe = observeElementOffset(instance, onOffset);
      const scrollElement = instance.scrollElement;
      if (readDomOffsetOnAttachRef.current && scrollElement !== null) {
        readDomOffsetOnAttachRef.current = false;
        onOffset(scrollElement.scrollTop, false);
      }
      return unsubscribe;
    },
    [],
  );

  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: itemKeys.length,
    directDomUpdates: true,
    directDomUpdatesMode: "position",
    enabled: windowingEnabled,
    estimateSize,
    gap,
    getItemKey,
    getScrollElement: resolvedGetScrollElement,
    initialOffset,
    initialRect,
    measureElement,
    observeElementOffset: observeScrollOffset,
    overscan: TIMELINE_WINDOW_OVERSCAN_ITEMS,
    rangeExtractor,
    scrollMargin,
    useFlushSync: false,
  });
  const containerRef = useComposedRefs(
    containerElementRef,
    virtualizer.containerRef,
  );

  const updateScrollGeometry = useCallback(() => {
    if (!configured) return;
    const container = containerElementRef.current;
    const scrollElement = resolvedGetScrollElement();
    if (container === null || scrollElement === null) return;
    const nextMargin =
      container.getBoundingClientRect().top -
      scrollElement.getBoundingClientRect().top +
      scrollElement.scrollTop -
      scrollElement.clientTop;
    setScrollMargin((previous) =>
      Math.abs(previous - nextMargin) < 0.5 ? previous : nextMargin,
    );
  }, [configured, resolvedGetScrollElement]);

  useLayoutEffect(() => {
    if (!configured) return;
    const updateRootUsability = () => {
      const scrollElement = resolvedGetScrollElement();
      if (scrollElement !== null) {
        setScrollRootUsable(scrollElement.clientHeight > 0);
      }
    };
    const scrollElement = resolvedGetScrollElement();
    if (scrollElement === null) return;
    updateRootUsability();
    updateScrollGeometry();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      updateRootUsability();
      updateScrollGeometry();
    });
    observer.observe(scrollElement);
    const containerParent = containerElementRef.current?.parentElement;
    if (containerParent !== null && containerParent !== undefined) {
      observer.observe(containerParent);
    }
    return () => observer.disconnect();
  }, [
    configured,
    resolvedGetScrollElement,
    scrollElementAvailable,
    updateScrollGeometry,
  ]);

  useEffect(() => {
    if (!configured || scrollElementAvailable) return;
    if (resolvedGetScrollElement() !== null) {
      setScrollElementAvailable(true);
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (resolvedGetScrollElement() !== null) {
        setScrollElementAvailable(true);
        return;
      }
      setScrollRootUsable(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [configured, resolvedGetScrollElement, scrollElementAvailable]);

  useLayoutEffect(() => {
    initialScrollPendingRef.current = false;
  }, []);

  useLayoutEffect(updateScrollGeometry);

  const retainInteractedItem = useCallback(
    (event: SyntheticEvent<HTMLDivElement>) => {
      const container = containerElementRef.current;
      if (container === null) return;
      const key = findOwnedWindowKey(event.target, container, indexByKey);
      if (key === null) return;
      setInteractionPins((previous) => {
        const next = previous.filter((candidate) => candidate !== key);
        next.push(key);
        return next.slice(-TIMELINE_WINDOW_MAX_INTERACTION_PINS);
      });
    },
    [indexByKey],
  );

  const virtualItemsByIndex = new Map(
    virtualizer.getVirtualItems().map((item) => [item.index, item]),
  );
  for (const index of forcedIndexes) {
    const item = virtualizer.measurementsCache[index];
    if (item !== undefined) virtualItemsByIndex.set(index, item);
  }
  const virtualItems = [...virtualItemsByIndex.values()].sort(
    (left, right) => left.index - right.index,
  );
  const renderWindow = windowingEnabled && virtualizer.range !== null;
  const indexes = renderWindow
    ? virtualItems.map((item) => item.index)
    : itemKeys.map((_, index) => index);
  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={renderWindow ? undefined : { display: "contents" }}
      data-timeline-items=""
      data-timeline-virtual-spacer={renderWindow ? "" : undefined}
      onClickCapture={retainInteractedItem}
      onFocusCapture={retainInteractedItem}
    >
      {indexes.map((index) =>
        renderItem(index, {
          isRealized: true,
          itemIndex: index,
          itemRef: renderWindow
            ? virtualizer.measureElement
            : (element) => {
                if (element === null) return;
                const key = itemKeys[index];
                const height = element.getBoundingClientRect().height;
                if (key !== undefined && height > 0) {
                  recordTimelineMeasurement(measurements, key, height);
                }
              },
          itemStyle: renderWindow
            ? { position: "absolute", left: 0, width: "100%" }
            : undefined,
          windowingEnabled: renderWindow,
        }),
      )}
    </div>
  );
}
