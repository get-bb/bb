import {
  createContext,
  lazy,
  Suspense,
  type CSSProperties,
  type ReactNode,
} from "react";

const DEFAULT_WINDOWING_MIN_ITEM_COUNT = 20;
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
  renderItem,
}: TimelineWindowedItemsProps) {
  return itemKeys.map((_key, index) =>
    renderItem(index, {
      isRealized: true,
      itemIndex: undefined,
      itemRef: NOOP_ITEM_REF,
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
    <Suspense fallback={<TimelineWindowedItemsControl {...props} />}>
      <LazyTimelineWindowedItems {...props} />
    </Suspense>
  );
}
