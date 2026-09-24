import { createContext, type CSSProperties, type ReactNode } from "react";

import { TimelineWindowedItems } from "./TimelineWindowedItems.js";

export const DEFAULT_WINDOWING_MIN_ITEM_COUNT = 20;
const MAX_MEASUREMENTS = 2_000;

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
}

export const TimelineWindowingScrollRootContext =
  createContext<TimelineWindowingScrollRoot | null>(null);

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

export function TimelineWindowedItemsLoader(props: TimelineWindowedItemsProps) {
  return <TimelineWindowedItems {...props} />;
}
