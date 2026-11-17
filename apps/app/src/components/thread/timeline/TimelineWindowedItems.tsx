import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { flushSync } from "react-dom";
import { isIOSWebKit } from "@/lib/ios-webkit";
import {
  observeSharedResize,
  observedBorderBoxBlockSize,
  settleAfterSharedResizeWrites,
} from "@bb/shared-ui/lib/shared-resize-observer";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body";
import type { ScrollPositionKeeper } from "@/components/ui/scroll-position-keeper";

export const DEFAULT_WINDOWING_MIN_ITEM_COUNT = 20;
const MAX_MEASUREMENTS = 2_000;
const OVERSCAN_ITEMS = 8;
const EDGE_MARGIN_ITEMS = 2;
const TOP_MOUNT_VIEWPORTS = 2;
const MAX_INTERACTION_PINS = 24;
const MAX_WINDOW_UPDATES_PER_FRAME = 8;

export function recordTimelineMeasurement(
  measurements: Map<string, number>,
  key: string,
  height: number,
): void {
  measurements.delete(key);
  measurements.set(key, height);
  while (measurements.size > MAX_MEASUREMENTS) {
    const oldestKey = measurements.keys().next().value;
    if (oldestKey === undefined) break;
    measurements.delete(oldestKey);
  }
}

export interface TimelineWindowingScrollRoot {
  getScrollElement: () => HTMLElement | null;
  positionKeeper: ScrollPositionKeeper;
}

export const TimelineWindowingScrollRootContext =
  createContext<TimelineWindowingScrollRoot | null>(null);

export function useTimelinePositionKeeper(): ScrollPositionKeeper | null {
  const detailScrollRoot = useContext(TimelineWindowingScrollRootContext);
  const bottomAnchor = useBottomAnchoredScroll();
  return (
    detailScrollRoot?.positionKeeper ?? bottomAnchor?.positionKeeper ?? null
  );
}

export const TimelineWindowingMeasurementsContext = createContext<Map<
  string,
  number
> | null>(null);

export interface TimelineWindowedItemRenderState {
  itemRef: (node: HTMLDivElement | null) => (() => void) | undefined;
  windowingEnabled: boolean;
}

export interface TimelineWindowAnchor {
  key: string;
  offset: number;
}

export interface TimelineWindowedItemsProps {
  alwaysMountedKeys?: ReadonlySet<string>;
  estimateItemHeight: (index: number) => number;
  gap: number;
  initialWindowAnchor?: TimelineWindowAnchor | null;
  itemKeys: readonly string[];
  measurements: Map<string, number>;
  positionKeeper: ScrollPositionKeeper | null;
  renderItem: (
    index: number,
    state: TimelineWindowedItemRenderState,
  ) => ReactNode;
  pinnedToEnd: boolean;
}

const measurementRevisions = new WeakMap<ReadonlyMap<string, number>, number>();

function measurementRevision(measurements: ReadonlyMap<string, number>) {
  return measurementRevisions.get(measurements) ?? 0;
}

function bumpMeasurementRevision(measurements: ReadonlyMap<string, number>) {
  measurementRevisions.set(measurements, measurementRevision(measurements) + 1);
}

interface LayoutModel {
  heights: number[];
  offsets: number[];
  total: number;
}

interface IndexRange {
  start: number;
  end: number;
}

interface WindowRange {
  first: string;
  last: string;
  throughEnd: boolean;
}

interface WindowState {
  keys: ReadonlySet<string>;
  range: WindowRange | null;
  heights: ReadonlyMap<string, number>;
}

interface IndexWindow {
  keys: Set<string>;
  range: WindowRange | null;
}

const EMPTY_KEY_SET: ReadonlySet<string> = new Set();
const WINDOW_KEY_ATTRIBUTE = "data-timeline-window-key";

function buildModel(
  itemKeys: readonly string[],
  heights: ReadonlyMap<string, number>,
  estimateItemHeight: (index: number) => number,
  gap: number,
): LayoutModel {
  const itemHeights = new Array<number>(itemKeys.length);
  const offsets = new Array<number>(itemKeys.length);
  let top = 0;
  for (let index = 0; index < itemKeys.length; index += 1) {
    const key = itemKeys[index];
    const height =
      (key === undefined ? undefined : heights.get(key)) ??
      Math.max(1, estimateItemHeight(index));
    itemHeights[index] = height;
    offsets[index] = top;
    top += height + gap;
  }
  return {
    heights: itemHeights,
    offsets,
    total: itemKeys.length === 0 ? 0 : top - gap,
  };
}

function indexAtOffset(model: LayoutModel, offset: number): number {
  let low = 0;
  let high = model.offsets.length - 1;
  let found = 0;
  while (low <= high) {
    const index = low + Math.floor((high - low) / 2);
    if ((model.offsets[index] ?? 0) <= offset) {
      found = index;
      low = index + 1;
    } else {
      high = index - 1;
    }
  }
  return found;
}

function visibleRange(
  model: LayoutModel,
  localTop: number,
  viewportHeight: number,
): IndexRange {
  const count = model.offsets.length;
  if (count === 0) return { start: 0, end: -1 };
  const start = indexAtOffset(model, Math.max(0, localTop));
  const end = indexAtOffset(model, Math.max(0, localTop + viewportHeight));
  return { start, end: Math.min(count - 1, Math.max(start, end)) };
}

function reachesListTop(
  model: LayoutModel,
  visible: IndexRange,
  viewportHeight: number,
): boolean {
  return (
    (model.offsets[visible.start] ?? 0) < TOP_MOUNT_VIEWPORTS * viewportHeight
  );
}

function indexWindow(
  itemKeys: readonly string[],
  start: number,
  end: number,
): IndexWindow {
  const keys = new Set<string>();
  for (let index = start; index <= end; index += 1) {
    const key = itemKeys[index];
    if (key !== undefined) keys.add(key);
  }
  const first = itemKeys[start];
  const last = itemKeys[end];
  return {
    keys,
    range:
      first === undefined || last === undefined
        ? null
        : { first, last, throughEnd: end === itemKeys.length - 1 },
  };
}

function windowAround(
  itemKeys: readonly string[],
  visible: IndexRange,
  mountToTop: boolean,
): IndexWindow {
  return indexWindow(
    itemKeys,
    mountToTop ? 0 : Math.max(0, visible.start - OVERSCAN_ITEMS),
    Math.min(itemKeys.length - 1, visible.end + OVERSCAN_ITEMS),
  );
}

function rangeWindowKeys(
  state: WindowState,
  itemKeys: readonly string[],
  indexByKey: ReadonlyMap<string, number>,
): ReadonlySet<string> {
  const range = state.range;
  if (range === null) return state.keys;
  const start = indexByKey.get(range.first);
  const end = range.throughEnd
    ? itemKeys.length - 1
    : indexByKey.get(range.last);
  if (start === undefined || end === undefined) return state.keys;
  let keys: Set<string> | null = null;
  for (let index = start; index <= end; index += 1) {
    const key = itemKeys[index];
    if (key === undefined || state.keys.has(key)) continue;
    keys ??= new Set(state.keys);
    keys.add(key);
  }
  return keys ?? state.keys;
}

function heldKeyOf(positionKeeper: ScrollPositionKeeper): string | null {
  const position = positionKeeper.getPosition();
  return position.kind === "anchor"
    ? position.key
    : positionKeeper.pendingRestoreRowId();
}

function sameKeys(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false;
  for (const key of left) if (!right.has(key)) return false;
  return true;
}

function knownHeights(
  itemKeys: readonly string[],
  measurements: ReadonlyMap<string, number>,
  rendered: ReadonlyMap<string, number>,
): Map<string, number> {
  const heights = new Map<string, number>();
  for (const key of itemKeys) {
    const height = measurements.get(key) ?? rendered.get(key);
    if (height !== undefined) heights.set(key, height);
  }
  return heights;
}

function spacerHeight(model: LayoutModel, first: number, last: number) {
  const top = model.offsets[first] ?? 0;
  const bottom = (model.offsets[last] ?? 0) + (model.heights[last] ?? 0);
  return Math.max(0, bottom - top);
}

function findOwnedWindowKey(
  target: EventTarget | null,
  container: HTMLElement,
  indexByKey: ReadonlyMap<string, number>,
): string | null {
  let element = target instanceof Element ? target : null;
  while (element !== null && element !== container) {
    const key = element.getAttribute(WINDOW_KEY_ATTRIBUTE);
    if (key !== null && indexByKey.has(key)) return key;
    element = element.parentElement;
  }
  return null;
}

export function TimelineWindowedItems({
  alwaysMountedKeys = EMPTY_KEY_SET,
  estimateItemHeight,
  gap,
  initialWindowAnchor = null,
  itemKeys,
  measurements,
  positionKeeper,
  renderItem,
  pinnedToEnd,
}: TimelineWindowedItemsProps) {
  const [windowingSupported] = useState(
    () => typeof navigator === "undefined" || !isIOSWebKit(navigator),
  );
  const [scrollRootUsable, setScrollRootUsable] = useState<boolean | null>(
    null,
  );
  const windowingEnabled =
    windowingSupported &&
    positionKeeper !== null &&
    scrollRootUsable !== false &&
    itemKeys.length >= DEFAULT_WINDOWING_MIN_ITEM_COUNT;
  const containerRef = useRef<HTMLDivElement>(null);
  const [windowState, setWindowState] = useState<WindowState>(() => {
    const heights = new Map(measurements);
    if (itemKeys.length < DEFAULT_WINDOWING_MIN_ITEM_COUNT) {
      return { ...indexWindow(itemKeys, 0, itemKeys.length - 1), heights };
    }
    const model = buildModel(itemKeys, heights, estimateItemHeight, gap);
    const viewportHeight =
      positionKeeper?.getViewportHeight() || window.innerHeight;
    const anchorIndex =
      initialWindowAnchor === null
        ? -1
        : itemKeys.indexOf(initialWindowAnchor.key);
    const localTop =
      anchorIndex >= 0 && initialWindowAnchor !== null
        ? (model.offsets[anchorIndex] ?? 0) - initialWindowAnchor.offset
        : pinnedToEnd
          ? model.total - viewportHeight
          : 0;
    const visible = visibleRange(model, localTop, viewportHeight);
    return {
      ...windowAround(
        itemKeys,
        visible,
        reachesListTop(model, visible, viewportHeight),
      ),
      heights,
    };
  });
  const [interactionPins, setInteractionPins] = useState<readonly string[]>([]);

  const indexByKey = useMemo(
    () => new Map(itemKeys.map((key, index) => [key, index])),
    [itemKeys],
  );
  const windowKeys = useMemo(
    () => rangeWindowKeys(windowState, itemKeys, indexByKey),
    [indexByKey, itemKeys, windowState],
  );
  const renderModel = useMemo(
    () => buildModel(itemKeys, windowState.heights, estimateItemHeight, gap),
    [estimateItemHeight, gap, itemKeys, windowState.heights],
  );
  const mountedIndexes = useMemo(() => {
    if (!windowingEnabled) return itemKeys.map((_, index) => index);
    const indexes = new Set<number>();
    const add = (key: string) => {
      const index = indexByKey.get(key);
      if (index !== undefined) indexes.add(index);
    };
    for (const key of windowKeys) add(key);
    for (const key of alwaysMountedKeys) add(key);
    for (const key of interactionPins) add(key);
    return [...indexes].sort((left, right) => left - right);
  }, [
    alwaysMountedKeys,
    indexByKey,
    interactionPins,
    itemKeys,
    windowKeys,
    windowingEnabled,
  ]);

  const liveRef = useRef({
    estimateItemHeight,
    gap,
    indexByKey,
    itemKeys,
    mountedIndexes,
    renderedHeights: windowState.heights,
    scrollRootUsable,
    windowKeys,
    windowingEnabled,
  });
  useLayoutEffect(() => {
    liveRef.current = {
      estimateItemHeight,
      gap,
      indexByKey,
      itemKeys,
      mountedIndexes,
      renderedHeights: windowState.heights,
      scrollRootUsable,
      windowKeys,
      windowingEnabled,
    };
  });

  const modelCacheRef = useRef<{
    itemKeys: readonly string[];
    mountedIndexes: readonly number[];
    renderedHeights: ReadonlyMap<string, number>;
    revision: number;
    model: LayoutModel;
  } | null>(null);
  const renderedModel = useCallback((): LayoutModel => {
    const live = liveRef.current;
    const cached = modelCacheRef.current;
    if (
      cached !== null &&
      cached.itemKeys === live.itemKeys &&
      cached.mountedIndexes === live.mountedIndexes &&
      cached.renderedHeights === live.renderedHeights &&
      cached.revision === measurementRevision(measurements)
    ) {
      return cached.model;
    }
    const heights = new Map(live.renderedHeights);
    for (const index of live.mountedIndexes) {
      const key = live.itemKeys[index];
      const height = key === undefined ? undefined : measurements.get(key);
      if (key !== undefined && height !== undefined) heights.set(key, height);
    }
    const model = buildModel(
      live.itemKeys,
      heights,
      live.estimateItemHeight,
      live.gap,
    );
    modelCacheRef.current = {
      itemKeys: live.itemKeys,
      mountedIndexes: live.mountedIndexes,
      renderedHeights: live.renderedHeights,
      revision: measurementRevision(measurements),
      model,
    };
    return model;
  }, [measurements]);

  const record = useCallback(
    (key: string, height: number): boolean => {
      if (height <= 0 || measurements.get(key) === height) return false;
      recordTimelineMeasurement(measurements, key, height);
      bumpMeasurementRevision(measurements);
      return true;
    },
    [measurements],
  );

  const observeItemElement = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null) return undefined;
      const key = node.getAttribute(WINDOW_KEY_ATTRIBUTE);
      if (key === null || typeof ResizeObserver === "undefined") {
        return undefined;
      }
      let observed = false;
      return observeSharedResize(node, {
        read: (entry) =>
          entry === undefined ? undefined : observedBorderBoxBlockSize(entry),
        write: (height) => {
          const changed = height !== undefined && record(key, height);
          if ((changed || !observed) && positionKeeper !== null) {
            settleAfterSharedResizeWrites(positionKeeper.reconcileAfterLayout);
          }
          observed = true;
        },
      });
    },
    [positionKeeper, record],
  );

  const frameUpdatesRef = useRef({ count: 0, frame: null as number | null });
  const frameCommitRef = useRef<{
    frame: number | null;
    state: WindowState | null;
  }>({ frame: null, state: null });
  const takeFrameUpdate = useCallback((): boolean => {
    const budget = frameUpdatesRef.current;
    if (budget.frame === null) {
      budget.frame = requestAnimationFrame(() => {
        budget.frame = null;
        budget.count = 0;
      });
    }
    budget.count += 1;
    return budget.count <= MAX_WINDOW_UPDATES_PER_FRAME;
  }, []);
  useLayoutEffect(
    () => () => {
      const frame = frameUpdatesRef.current.frame;
      if (frame !== null) cancelAnimationFrame(frame);
      const commitFrame = frameCommitRef.current.frame;
      if (commitFrame !== null) cancelAnimationFrame(commitFrame);
      frameCommitRef.current = { frame: null, state: null };
    },
    [],
  );

  const syncWindow = useCallback(
    (urgent: boolean) => {
      const live = liveRef.current;
      const scrollRoot = positionKeeper?.getScrollElement() ?? null;
      if (scrollRoot !== null) {
        const usable = scrollRoot.clientHeight > 0;
        if (usable !== live.scrollRootUsable) {
          if (usable && live.scrollRootUsable === false) {
            setWindowState((current) => ({
              keys: current.keys,
              range: current.range,
              heights: knownHeights(
                live.itemKeys,
                measurements,
                current.heights,
              ),
            }));
          }
          live.scrollRootUsable = usable;
          setScrollRootUsable(usable);
        }
      }
      if (!live.windowingEnabled || positionKeeper === null) return;
      const container = containerRef.current;
      const scrollElement = positionKeeper.getScrollElement();
      if (container === null || scrollElement === null) return;
      const viewportHeight =
        positionKeeper.getViewportHeight() || scrollElement.clientHeight;
      if (viewportHeight <= 0) return;
      const model = renderedModel();
      const localTop =
        scrollElement.getBoundingClientRect().top -
        container.getBoundingClientRect().top;
      const visible = visibleRange(model, localTop, viewportHeight);
      if (visible.end < visible.start) return;
      const mounted = new Set(live.mountedIndexes);
      let uncovered = false;
      for (let index = visible.start; index <= visible.end; index += 1) {
        if (!mounted.has(index)) {
          uncovered = true;
          break;
        }
      }
      const windowIndexes: number[] = [];
      for (const key of live.windowKeys) {
        const index = live.indexByKey.get(key);
        if (index !== undefined) windowIndexes.push(index);
      }
      const first = windowIndexes.length ? Math.min(...windowIndexes) : 0;
      const last = windowIndexes.length ? Math.max(...windowIndexes) : -1;
      const mountToTop = reachesListTop(model, visible, viewportHeight);
      const nearEdge =
        (mountToTop && first > 0) ||
        (visible.start - first < EDGE_MARGIN_ITEMS && first > 0) ||
        (last - visible.end < EDGE_MARGIN_ITEMS &&
          last < live.itemKeys.length - 1) ||
        (!mountToTop && visible.start - first > 3 * OVERSCAN_ITEMS) ||
        last - visible.end > 3 * OVERSCAN_ITEMS;
      const pending = frameCommitRef.current;
      if (!uncovered && !nearEdge) {
        pending.state = null;
        return;
      }
      const { keys, range } = windowAround(live.itemKeys, visible, mountToTop);
      const heldKey = heldKeyOf(positionKeeper);
      if (heldKey !== null && live.indexByKey.has(heldKey)) keys.add(heldKey);
      if (sameKeys(keys, live.windowKeys)) {
        pending.state = null;
        return;
      }
      if (pending.state !== null && sameKeys(keys, pending.state.keys)) return;
      if (!takeFrameUpdate()) return;
      const next: WindowState = {
        keys,
        range,
        heights: knownHeights(
          live.itemKeys,
          measurements,
          live.renderedHeights,
        ),
      };
      if ((urgent && uncovered) || pending.frame !== null) {
        pending.state = next;
        if (pending.frame === null) {
          pending.frame = requestAnimationFrame(() => {
            pending.frame = null;
            const state = pending.state;
            pending.state = null;
            if (state !== null) flushSync(() => setWindowState(state));
          });
        }
        return;
      }
      setWindowState(next);
    },
    [measurements, positionKeeper, renderedModel, takeFrameUpdate],
  );

  useLayoutEffect(() => {
    if (positionKeeper === null) return;
    return positionKeeper.registerList({
      itemAt: (viewportTop) => {
        const live = liveRef.current;
        const container = containerRef.current;
        if (container === null || live.itemKeys.length === 0) return null;
        const model = renderedModel();
        const containerTop = container.getBoundingClientRect().top;
        const localTop = viewportTop - containerTop;
        if (localTop > model.total) return null;
        const index = indexAtOffset(model, Math.max(0, localTop));
        const key = live.itemKeys[index];
        if (key === undefined) return null;
        return { key, top: containerTop + (model.offsets[index] ?? 0) };
      },
      onPositionChange: syncWindow,
    });
  }, [positionKeeper, renderedModel, syncWindow]);

  const mountHeldKey = useCallback((): boolean => {
    if (positionKeeper === null) return false;
    const live = liveRef.current;
    const heldKey = heldKeyOf(positionKeeper);
    if (heldKey === null || !live.windowingEnabled) return false;
    const index = live.indexByKey.get(heldKey);
    if (index === undefined || live.mountedIndexes.includes(index)) {
      return false;
    }
    setWindowState((current) => ({
      keys: new Set([...current.keys, heldKey]),
      range: current.range,
      heights: current.heights,
    }));
    return true;
  }, [positionKeeper]);

  useLayoutEffect(() => {
    mountHeldKey();
  });

  const retainInteractedItem = useCallback(
    (event: SyntheticEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (container === null) return;
      const key = findOwnedWindowKey(event.target, container, indexByKey);
      if (key === null) return;
      setInteractionPins((previous) => {
        if (previous.at(-1) === key) return previous;
        const next = previous.filter((candidate) => candidate !== key);
        next.push(key);
        return next.slice(-MAX_INTERACTION_PINS);
      });
    },
    [indexByKey],
  );

  const children: ReactNode[] = [];
  let previous = -1;
  for (const index of mountedIndexes) {
    if (index > previous + 1) {
      children.push(
        <div
          key={`spacer:${itemKeys[previous + 1] ?? previous + 1}`}
          aria-hidden
          data-timeline-window-spacer=""
          style={{ height: spacerHeight(renderModel, previous + 1, index - 1) }}
        />,
      );
    }
    children.push(
      renderItem(index, { itemRef: observeItemElement, windowingEnabled }),
    );
    previous = index;
  }
  if (mountedIndexes.length > 0 && previous < itemKeys.length - 1) {
    children.push(
      <div
        key="spacer:end"
        aria-hidden
        data-timeline-window-spacer=""
        style={{
          height: spacerHeight(renderModel, previous + 1, itemKeys.length - 1),
        }}
      />,
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex w-full min-w-0 flex-col"
      style={{ gap }}
      data-timeline-items=""
      data-timeline-virtual-spacer={windowingEnabled ? "" : undefined}
      onClickCapture={retainInteractedItem}
      onFocusCapture={retainInteractedItem}
    >
      {children}
    </div>
  );
}
