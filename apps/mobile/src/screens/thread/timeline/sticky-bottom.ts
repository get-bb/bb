/**
 * Sticky-bottom policy for the timeline list (the native counterpart of
 * apps/app/src/components/thread/timeline/useStickyBottomScroll.ts), as a
 * pure reducer over scroll/drag events so the decision — "follow new rows to
 * the end, or leave the reader where they are" — can be tested without a
 * list:
 *
 * - The list follows the end while the reader leaves it there. Programmatic
 *   scroll events — content growth before the follow-up scroll lands, the
 *   list re-measuring rows, an initial jump to the unread divider — never
 *   change the decision in either direction: a streamed row must not unstick,
 *   and a transient bottom offset while the list settles must not re-stick.
 * - Only the user changes it: dragging away from the bottom unsticks;
 *   dragging (or coasting) back to within the threshold, or "jump to
 *   latest", re-sticks.
 */

export interface ScrollMetrics {
  contentHeight: number;
  offsetY: number;
  viewportHeight: number;
}

export interface StickyBottomState {
  /** Whether new content should scroll the list to the end. */
  stuck: boolean;
  /** A drag or drag-started momentum is in progress. */
  interacting: boolean;
}

type StickyBottomEvent =
  | { type: "scroll"; metrics: ScrollMetrics }
  | { type: "drag-start" }
  | { type: "drag-end"; metrics: ScrollMetrics; willDecelerate: boolean }
  | { type: "momentum-end"; metrics: ScrollMetrics }
  | { type: "jump-to-latest" }
  | { type: "detach" };

const STICKY_BOTTOM_THRESHOLD_PX = 24;

export const INITIAL_STICKY_BOTTOM_STATE: StickyBottomState = {
  stuck: true,
  interacting: false,
};

function distanceFromBottom(metrics: ScrollMetrics): number {
  return Math.max(
    0,
    metrics.contentHeight - metrics.viewportHeight - metrics.offsetY,
  );
}

function isNearBottom(
  metrics: ScrollMetrics,
  thresholdPx = STICKY_BOTTOM_THRESHOLD_PX,
): boolean {
  return distanceFromBottom(metrics) <= thresholdPx;
}

export function reduceStickyBottom(
  state: StickyBottomState,
  event: StickyBottomEvent,
): StickyBottomState {
  switch (event.type) {
    case "drag-start":
      return state.interacting ? state : { ...state, interacting: true };
    case "drag-end": {
      const stuck = isNearBottom(event.metrics) ? true : state.stuck;
      return { stuck, interacting: event.willDecelerate };
    }
    case "momentum-end": {
      // iOS also reports the end of a programmatic animated scroll here;
      // only the momentum a drag started counts as the user's choice.
      if (!state.interacting) return state;
      const stuck = isNearBottom(event.metrics) ? true : state.stuck;
      return { stuck, interacting: false };
    }
    case "scroll": {
      if (!state.interacting) return state;
      const stuck = isNearBottom(event.metrics);
      return stuck === state.stuck ? state : { ...state, stuck };
    }
    case "jump-to-latest":
      return { stuck: true, interacting: false };
    case "detach":
      return { stuck: false, interacting: false };
  }
}

/**
 * Whether growing content should scroll the list to the end: only while
 * stuck and the content actually overflows (a short list has nowhere to go).
 */
export function shouldFollowContentGrowth(
  state: StickyBottomState,
  metrics: Pick<ScrollMetrics, "contentHeight" | "viewportHeight">,
): boolean {
  return state.stuck && metrics.contentHeight > metrics.viewportHeight;
}

/**
 * "Jump to latest" shows once the reader has scrolled far enough up that
 * the end is out of view (more than a viewport's half away), never while
 * following.
 */
export function shouldShowJumpToLatest(
  state: StickyBottomState,
  metrics: ScrollMetrics,
): boolean {
  if (state.stuck) return false;
  return distanceFromBottom(metrics) > Math.max(80, metrics.viewportHeight / 2);
}

/** Where the list should land when the first window renders. */
type InitialScrollTarget = { kind: "end" } | { kind: "index"; index: number };

export function resolveInitialScrollTarget({
  itemCount,
  unreadDividerAutoScroll,
  unreadDividerIndex,
}: {
  itemCount: number;
  unreadDividerAutoScroll: boolean;
  unreadDividerIndex: number;
}): InitialScrollTarget | null {
  if (itemCount === 0) return null;
  if (unreadDividerAutoScroll && unreadDividerIndex >= 0) {
    return { kind: "index", index: unreadDividerIndex };
  }
  return { kind: "end" };
}
