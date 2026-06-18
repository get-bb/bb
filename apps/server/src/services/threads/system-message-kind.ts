import type { SystemMessageKind, ThreadEventTurnStatus } from "@bb/domain";
import type { TemplateId } from "@bb/templates";

// Canonical wiring from a system-message template to its Family-B taxonomy
// `systemMessageKind`. This is the single source that keeps every emit site's
// stamped kind consistent with the template it renders. Templates whose kind
// depends on runtime data (the child-outcome batch, which varies by turn status
// and batch size) are resolved by the dedicated helpers below rather than this
// 1:1 map.
const STATIC_SYSTEM_MESSAGE_KIND_BY_TEMPLATE = {
  systemMessageThreadOwnershipAssigned: "ownership-assigned",
  systemMessageThreadOwnershipRemoved: "ownership-removed",
  systemMessageChildThreadNeedsAttention: "child-needs-attention",
} satisfies Partial<Record<TemplateId, SystemMessageKind>>;

type StaticSystemMessageTemplateId =
  keyof typeof STATIC_SYSTEM_MESSAGE_KIND_BY_TEMPLATE;

/**
 * The taxonomy kind for a template whose kind is fixed (one template → one
 * kind). Child-outcome templates are intentionally excluded — their kind
 * depends on the child turn status and batch size, so callers derive those via
 * `childOutcomeSystemMessageKind` / the `child-outcome-batch` literal.
 */
export function systemMessageKindForTemplate(
  templateId: StaticSystemMessageTemplateId,
): SystemMessageKind {
  return STATIC_SYSTEM_MESSAGE_KIND_BY_TEMPLATE[templateId];
}

/**
 * The taxonomy kind for a single-child outcome message, derived from the
 * child's terminal turn status (three distinct titles, not one flattened
 * "finished"). Multi-child batches use the `child-outcome-batch` kind directly.
 */
export function childOutcomeSystemMessageKind(
  turnStatus: ThreadEventTurnStatus,
): SystemMessageKind {
  switch (turnStatus) {
    case "completed":
      return "child-completed";
    case "failed":
      return "child-failed";
    case "interrupted":
      return "child-interrupted";
    default: {
      const exhaustiveCheck: never = turnStatus;
      return exhaustiveCheck;
    }
  }
}
