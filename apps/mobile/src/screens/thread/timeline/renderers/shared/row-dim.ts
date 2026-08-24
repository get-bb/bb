import type { TimelineTitle } from "@bb/thread-view";
import type { TimelineListItem } from "../../rows";

/**
 * Opacity of the receded "past" layer — the bottom step of the timeline's
 * prominence ramp (web `PAST_ROW_DIM_CLASS_NAME` = opacity-40): agent prose
 * at full strength, live/active rows next, finished rows dimmed as a whole
 * so the contrast is identical in light and dark.
 */
export const PAST_ROW_DIM_OPACITY = 0.4;

/**
 * Whether a row sits in the receded past layer. Finished work, system,
 * turn, and summary rows recede; errors, interruptions, and pending rows stay
 * at full strength; conversation prose never recedes. The active-latest
 * bundle (the live frontier) keeps its strength even once its children are
 * done — its title shimmers, which is how the item carries that state here.
 */
export function isPastTimelineRow(
  item: Pick<TimelineListItem, "kind" | "row" | "title">,
): boolean {
  if (titleIsLive(item.title)) return false;
  switch (item.kind) {
    case "conversation:user":
    case "conversation:assistant":
      return false;
    default:
      return "status" in item.row && item.row.status === "completed";
  }
}

function titleIsLive(title: TimelineTitle): boolean {
  return title.segments.some((segment) => segment.shimmer);
}
