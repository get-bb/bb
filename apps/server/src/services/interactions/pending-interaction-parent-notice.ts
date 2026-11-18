import { formatPendingInteractionSubjectDetailLines } from "@bb/core-ui";
import {
  isApprovalPendingInteractionPayload,
  isPluginExtensionInteractionRequestPayload,
  isPluginPendingInteraction,
  isUserQuestionPendingInteractionPayload,
  parseExtensionKind,
  type PendingInteraction,
  type ProviderPendingInteraction,
  type Thread,
} from "@bb/domain";
import { sliceUtf16Head } from "@bb/text-utils";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { deferAfterResponse } from "../lib/response-deferral.js";
import { queueChildThreadNeedsAttentionNotificationBestEffort } from "../threads/child-thread-notifications.js";
import { isParentNotifiableChildThread } from "../threads/thread-parent.js";

const CHILD_THREAD_BLOCKER_SUMMARY_MAX_LINES = 4;
const CHILD_THREAD_BLOCKER_SUMMARY_MAX_CHARS = 700;
const CHILD_THREAD_BLOCKER_SUMMARY_TRUNCATION_MARKER =
  "\n[... summary truncated ...]";

function pendingInteractionBlockerLabel(
  interaction: ProviderPendingInteraction,
): string {
  if (isUserQuestionPendingInteractionPayload(interaction.payload)) {
    return "user question";
  }
  if (isPluginExtensionInteractionRequestPayload(interaction.payload)) {
    return `${parseExtensionKind(interaction.payload.kind).pluginId} request`;
  }
  switch (interaction.payload.subject.kind) {
    case "command":
      return "command approval";
    case "file_change":
      return "file-change approval";
    case "permission_grant":
      return "permission grant";
    case "plan":
      return "plan review";
    case "tool_use":
      return "tool-use approval";
    default: {
      const exhaustiveCheck: never = interaction.payload.subject;
      return exhaustiveCheck;
    }
  }
}

function truncateChildThreadBlockerSummary(summary: string): string {
  if (summary.length <= CHILD_THREAD_BLOCKER_SUMMARY_MAX_CHARS) {
    return summary;
  }
  const retainedLength = Math.max(
    0,
    CHILD_THREAD_BLOCKER_SUMMARY_MAX_CHARS -
      CHILD_THREAD_BLOCKER_SUMMARY_TRUNCATION_MARKER.length,
  );
  return `${sliceUtf16Head(summary, retainedLength).trimEnd()}${CHILD_THREAD_BLOCKER_SUMMARY_TRUNCATION_MARKER}`;
}

function pluginFormTitleLines(interaction: PendingInteraction): string[] {
  const { payload } = interaction;
  return isApprovalPendingInteractionPayload(payload) ||
    isUserQuestionPendingInteractionPayload(payload)
    ? []
    : [payload.title];
}

export function buildChildThreadBlockerSummary(
  interaction: PendingInteraction,
): string | null {
  if (isPluginPendingInteraction(interaction)) {
    return truncateChildThreadBlockerSummary(
      `Pending plugin request: ${interaction.payload.title}\nInteraction: ${interaction.id}`,
    );
  }
  const detailLines = formatPendingInteractionSubjectDetailLines(interaction);
  const details = (
    detailLines.length > 0 ? detailLines : pluginFormTitleLines(interaction)
  )
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, CHILD_THREAD_BLOCKER_SUMMARY_MAX_LINES);
  if (details.length === 0) {
    return null;
  }
  return truncateChildThreadBlockerSummary(
    [
      `Blocked on ${pendingInteractionBlockerLabel(interaction)}:`,
      ...details,
    ].join("\n"),
  );
}

export function requestPendingInteractionParentNotice(
  deps: LoggedPendingInteractionWorkSessionDeps,
  thread: Thread,
  interaction: PendingInteraction,
): void {
  if (!isParentNotifiableChildThread(thread, "needs-attention")) {
    return;
  }
  const parentThreadId = thread.parentThreadId;
  deferAfterResponse({
    config: deps.config,
    context: {
      childThreadId: thread.id,
      interactionId: interaction.id,
      parentThreadId,
    },
    logger: deps.logger,
    name: "Child thread needs-attention notification",
    work: () =>
      queueChildThreadNeedsAttentionNotificationBestEffort(deps, {
        blockerSummary: buildChildThreadBlockerSummary(interaction),
        childThread: thread,
        parentThreadId,
      }),
  });
}
