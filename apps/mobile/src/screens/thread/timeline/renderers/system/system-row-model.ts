import type {
  TimelineParentChange,
  TimelineSystemOperationKind,
  TimelineSystemRow,
} from "@bb/server-contract";
import { assertNever } from "@bb/thread-view";
import type { IconName } from "@/ui/icon-map";

/**
 * Per-action leading glyph for system operation rows (web
 * `systemOperationLeadingIcon`): each lifecycle event reads at a glance.
 * Warning / deprecation / provider-unhandled / generic and the non-operation
 * kinds (debug, error, reconnect) keep no leading glyph.
 */
export function systemOperationLeadingIcon(
  operationKind: TimelineSystemOperationKind,
  parentChangeAction: TimelineParentChange["action"] | null,
): IconName | undefined {
  switch (operationKind) {
    case "parent-change":
      return parentChangeAction === "release" ? "UserRound" : "UserRoundPlus";
    case "thread-provisioning":
      return "Terminal";
    case "thread-interrupted":
      return "AlertCircle";
    case "compaction":
      return "CircleArrowShrink";
    case "context-clear":
      return "Clean";
    case "generic":
    case "warning":
    case "deprecation":
    case "provider-unhandled":
      return undefined;
    default:
      return assertNever(operationKind);
  }
}

export function leadingIconForSystemRow(
  row: TimelineSystemRow,
): IconName | undefined {
  if (row.systemKind !== "operation") return undefined;
  return systemOperationLeadingIcon(
    row.operationKind,
    row.operationKind === "parent-change" ? row.parentChange.action : null,
  );
}

/** Detail bodies longer than this collapse to their head with a toggle. */
export const SYSTEM_DETAIL_COLLAPSED_MAX_LINES = 40;

interface SystemDetailText {
  text: string;
  hiddenLineCount: number;
}

/**
 * The detail body to render: the whole text when short or expanded, else the
 * first `SYSTEM_DETAIL_COLLAPSED_MAX_LINES` lines plus how many are hidden
 * (provisioning transcripts and provider payloads can run to hundreds of
 * lines; a FlashList cell is not a scroll container).
 */
export function systemDetailText(
  detail: string,
  expanded: boolean,
  maxLines: number = SYSTEM_DETAIL_COLLAPSED_MAX_LINES,
): SystemDetailText {
  const normalized = detail.replace(/\r\n?/gu, "\n").replace(/\n+$/u, "");
  const lines = normalized.split("\n");
  if (expanded || lines.length <= maxLines) {
    return { text: normalized, hiddenLineCount: 0 };
  }
  return {
    text: lines.slice(0, maxLines).join("\n"),
    hiddenLineCount: lines.length - maxLines,
  };
}
