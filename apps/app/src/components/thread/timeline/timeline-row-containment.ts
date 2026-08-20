import { useEffect, type CSSProperties, type RefObject } from "react";
import type { ThreadTimelineViewRow } from "@bb/thread-view";
import { supportsScrollAnchoring } from "@/lib/scroll-anchoring-support";

/**
 * Top-level timeline rows skip layout and paint while off screen on compact
 * viewports (`content-visibility: auto`). Every mounted page stays in the DOM,
 * so on a phone each style/layout pass (keyboard, orientation, streaming
 * growth) otherwise walks every loaded row.
 *
 * Only the top-level list opts in: nested lists live inside an expandable
 * body whose own height animates, and containment on those would fight the
 * height transition. Compact-only because paint containment clips the
 * assistant markdown table breakout, which on wide layouts extends past the
 * row column (on compact the breakout equals the row width).
 *
 * A row is laid out once at its real size before it opts in
 * ({@link useArmTopLevelTimelineRowContainment}); `contain-intrinsic-block-size:
 * auto <estimate>` then replays that last remembered height whenever the row
 * is skipped, so realizing the row later does not change the scroll range.
 * Applying `content-visibility: auto` from the first frame would leave every
 * row above the initial viewport (the timeline mounts scrolled to the bottom)
 * and every prepended older page at the estimate. The estimate below only
 * backs a row whose remembered size is missing.
 *
 * WebKit never arms: it has no CSS scroll anchoring, so any difference between
 * a skipped row's replayed size and its real size (a stale remembered size, a
 * row that changed while skipped) moves the visible content instead of being
 * absorbed, which reads as a flash-and-scroll while a thread settles on iOS.
 * Chromium and Firefox anchor the viewport through those corrections, so the
 * layout/paint savings stay there.
 */
export const TOP_LEVEL_TIMELINE_ROW_INTRINSIC_SIZE_CLASS_NAME =
  "max-md:[contain-intrinsic-block-size:auto_1.25rem]";
const CONTENT_VISIBILITY_CLASS_NAME = "max-md:[content-visibility:auto]";
export const TOP_LEVEL_TIMELINE_ROW_CLASS_NAME = `${CONTENT_VISIBILITY_CLASS_NAME} ${TOP_LEVEL_TIMELINE_ROW_INTRINSIC_SIZE_CLASS_NAME}`;

/**
 * Arms `content-visibility: auto` on a top-level row wrapper once the row has
 * been laid out once. Two animation frames: the first callback runs before
 * that frame's style/layout pass (which lays the row out unskipped and records
 * its last remembered size), the second runs after it. The class is added
 * through `classList` rather than a React re-render: the wrapper's `className`
 * prop stays constant, so React never rewrites the attribute and never drops
 * classes other code adds imperatively (the search-match flash).
 *
 * Renders with {@link TOP_LEVEL_TIMELINE_ROW_INTRINSIC_SIZE_CLASS_NAME}; the
 * armed wrapper carries {@link TOP_LEVEL_TIMELINE_ROW_CLASS_NAME}.
 */
export function useArmTopLevelTimelineRowContainment(
  wrapperRef: RefObject<HTMLElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!enabled || wrapper === null || !supportsScrollAnchoring()) {
      return;
    }
    let cancelled = false;
    let secondFrame: number | null = null;
    const firstFrame = requestAnimationFrame(() => {
      if (cancelled) {
        return;
      }
      secondFrame = requestAnimationFrame(() => {
        if (!cancelled) {
          wrapper.classList.add(CONTENT_VISIBILITY_CLASS_NAME);
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) {
        cancelAnimationFrame(secondFrame);
      }
    };
  }, [enabled, wrapperRef]);
}

/**
 * Compact conversation rows: `text-sm leading-relaxed` lines (~23px) at the
 * ~44 characters that fit a phone-width column, plus bubble padding / the
 * in-flow action bar. Bucketed so the streaming row's estimate is not
 * rewritten on every delta.
 */
const CONVERSATION_ROW_BASE_PX = 48;
const CONVERSATION_ROW_LINE_PX = 23;
const COMPACT_CHARS_PER_LINE = 44;
const CONVERSATION_ROW_BUCKET_PX = 24;
// User messages clamp at 15 lines until expanded.
const USER_MESSAGE_MAX_LINES = 15;

export function estimateTimelineRowIntrinsicBlockSizePx(
  row: ThreadTimelineViewRow,
): number | null {
  if (row.kind !== "conversation") {
    return null;
  }
  let lines = Math.max(1, Math.ceil(row.text.length / COMPACT_CHARS_PER_LINE));
  if (row.role === "user") {
    lines = Math.min(lines, USER_MESSAGE_MAX_LINES);
  }
  const estimate = CONVERSATION_ROW_BASE_PX + lines * CONVERSATION_ROW_LINE_PX;
  return (
    Math.ceil(estimate / CONVERSATION_ROW_BUCKET_PX) *
    CONVERSATION_ROW_BUCKET_PX
  );
}

export function timelineRowContainmentStyle(
  row: ThreadTimelineViewRow,
): CSSProperties | undefined {
  const estimate = estimateTimelineRowIntrinsicBlockSizePx(row);
  if (estimate === null) {
    return undefined;
  }
  return { containIntrinsicBlockSize: `auto ${estimate}px` };
}
