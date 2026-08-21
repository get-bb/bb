import { claudeTaskToolNameValues } from "@bb/domain";
import type { ThreadEvent } from "@bb/domain";

const SUPPRESSED_TIMELINE_TOOL_NAMES = new Set([
  ...claudeTaskToolNameValues,
  "TodoRead",
  "TodoWrite",
  "ToolSearch",
  // AskUserQuestion is fully represented by its dedicated user-question
  // lifecycle row. Keeping the generic tool-call row too produces a confusing
  // duplicate ("Running tool: AskUserQuestion …" plus "Waiting for approval"
  // alongside the question's own "Waiting for answer" row).
  "AskUserQuestion",
]);

/**
 * A low-value item row the timeline drops: one the bridge marked `suppress`
 * in its presentation (grammar v3 — the bridge owns its items' presentation;
 * a planSteps snapshot still feeds the todo banner because that extraction
 * reads the events, not the rows), or, for tool calls persisted before
 * presentation existed, one of the legacy names above. Failed and
 * interrupted items always render.
 */
export function shouldSuppressLowValueToolCall(decoded: ThreadEvent): boolean {
  if (decoded.type !== "item/started" && decoded.type !== "item/completed") {
    return false;
  }
  const item = decoded.item;
  switch (item.type) {
    case "toolCall":
      if (
        item.presentation?.suppress !== true &&
        !SUPPRESSED_TIMELINE_TOOL_NAMES.has(item.tool)
      ) {
        return false;
      }
      break;
    case "fileRead":
    case "search":
    case "planSteps":
    case "extension":
    case "delegation":
    case "fileChange":
      if (item.presentation?.suppress !== true) {
        return false;
      }
      break;
    default:
      return false;
  }

  return item.status === "pending" || item.status === "completed";
}
