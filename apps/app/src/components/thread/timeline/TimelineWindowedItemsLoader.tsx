import {
  createContext,
  lazy,
  Suspense,
  type CSSProperties,
  type ReactNode,
} from "react";

const DEFAULT_WINDOWING_MIN_ITEM_COUNT = 20;
const MAX_CONTROL_PATH_MEASUREMENTS = 2_000;
const NOOP_ITEM_REF = () => {};

export interface TimelineWindowingScrollRoot {
  getScrollElement: () => HTMLElement | null;
}

/** Nested capped details virtualize against their own scroll element. */
export const TimelineWindowingScrollRootContext =
  createContext<TimelineWindowingScrollRoot | null>(null);

/** Exact heights survive while a virtualized parent unmounts a nested list. */
export const TimelineWindowingMeasurementsContext = createContext<Map<
  string,
  number
> | null>(null);

/**
 * Bumped after a commit that can move a windowed list within its scroll root
 * without resizing the root (a row above it expanding or collapsing).
 * Windowed lists re-read their scroll geometry when it changes.
 */
export const TimelineWindowingGeometryRevisionContext = createContext(0);

/**
 * Stable notifier for the revision context above. Expand/collapse paths call
 * it in the commit that moves content so every mounted windowed list
 * re-reads geometry before paint.
 */
export const TimelineWindowingGeometryInvalidateContext = createContext<
  () => void
>(() => {});

export interface TimelineWindowedItemRenderState {
  isRealized: boolean;
  itemIndex: number | undefined;
  itemRef: (node: HTMLDivElement | null) => void;
  itemStyle: CSSProperties | undefined;
  windowingEnabled: boolean;
}

export interface TimelineWindowedItemsProps {
  enabled: boolean;
  alwaysMountedKeys?: ReadonlySet<string>;
  estimateItemHeight: (index: number) => number;
  gap: number;
  getScrollElement: (() => HTMLElement | null) | null;
  itemKeys: readonly string[];
  measurements: Map<string, number>;
  minItemCount?: number;
  renderItem: (
    index: number,
    state: TimelineWindowedItemRenderState,
  ) => ReactNode;
}

const LazyTimelineWindowedItems = lazy(async () => {
  const module = await import("./TimelineWindowedItems.js");
  return { default: module.TimelineWindowedItems };
});

function TimelineWindowedItemsControl({
  itemKeys,
  measurements,
  renderItem,
  captureMeasurements = false,
}: TimelineWindowedItemsProps & { captureMeasurements?: boolean }) {
  return itemKeys.map((key, index) =>
    renderItem(index, {
      isRealized: true,
      itemIndex: captureMeasurements ? index : undefined,
      itemRef: captureMeasurements
        ? (element) => {
            if (element === null) return;
            const height = element.getBoundingClientRect().height;
            if (height <= 0) return;
            measurements.delete(key);
            measurements.set(key, height);
            while (measurements.size > MAX_CONTROL_PATH_MEASUREMENTS) {
              const oldestKey = measurements.keys().next().value;
              if (oldestKey === undefined) break;
              measurements.delete(oldestKey);
            }
          }
        : NOOP_ITEM_REF,
      itemStyle: undefined,
      windowingEnabled: false,
    }),
  );
}

/** Keep TanStack Virtual out of the route bundle until the experiment is on. */
export function TimelineWindowedItemsLoader(props: TimelineWindowedItemsProps) {
  const configured =
    props.enabled &&
    props.getScrollElement !== null &&
    props.itemKeys.length >=
      (props.minItemCount ?? DEFAULT_WINDOWING_MIN_ITEM_COUNT);
  if (!configured) return <TimelineWindowedItemsControl {...props} />;
  return (
    <Suspense
      fallback={<TimelineWindowedItemsControl {...props} captureMeasurements />}
    >
      <LazyTimelineWindowedItems {...props} />
    </Suspense>
  );
}
