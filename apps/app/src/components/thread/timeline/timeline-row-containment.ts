import type { CSSProperties } from "react";
import type { ThreadTimelineViewRow } from "@bb/thread-view";

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
 * `contain-intrinsic-block-size: auto <estimate>` keeps the last rendered
 * height once a row has been laid out; the estimate below is only used for
 * rows that never rendered yet (rows above the initial viewport). Row heights
 * are estimated per kind so the scroll range is close to the real one and
 * the browser's scroll anchoring has little to correct as rows render.
 */
export const TOP_LEVEL_TIMELINE_ROW_CLASS_NAME =
  "max-md:[content-visibility:auto] max-md:[contain-intrinsic-block-size:auto_1.25rem]";

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
