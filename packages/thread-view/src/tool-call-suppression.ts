import type { ThreadEvent } from "@bb/domain";

/**
 * A low-value item row the timeline drops: one the bridge marked `suppress`
 * in its presentation (grammar v3 — the bridge owns its items' presentation;
 * a planSteps snapshot still feeds the todo banner because that extraction
 * reads the events, not the rows). Failed and interrupted items always
 * render. Core keeps no list of tool names to hide: an item persisted
 * before presentation existed renders.
 */
export function shouldSuppressLowValueToolCall(decoded: ThreadEvent): boolean {
  if (decoded.type !== "item/started" && decoded.type !== "item/completed") {
    return false;
  }
  const item = decoded.item;
  switch (item.type) {
    case "toolCall":
    case "fileRead":
    case "search":
    case "planSteps":
    case "extension":
    case "delegation":
    case "fileChange":
      if (item.presentation?.suppress !== true) {
        return false;
      }
      return item.status === "pending" || item.status === "completed";
    default:
      return false;
  }
}
