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
 * A low-value tool call row: one the bridge marked `suppress` in its
 * presentation (grammar v3 — the bridge owns its tools' presentation), or,
 * for events persisted before presentation existed, one of the legacy names
 * above. Failed and interrupted calls always render.
 */
export function shouldSuppressLowValueToolCall(decoded: ThreadEvent): boolean {
  if (
    (decoded.type !== "item/started" && decoded.type !== "item/completed") ||
    decoded.item.type !== "toolCall"
  ) {
    return false;
  }

  if (
    decoded.item.presentation?.suppress !== true &&
    !SUPPRESSED_TIMELINE_TOOL_NAMES.has(decoded.item.tool)
  ) {
    return false;
  }

  return (
    decoded.item.status === "pending" || decoded.item.status === "completed"
  );
}
