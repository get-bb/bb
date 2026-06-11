import type { PromptInput, ThreadEventTurnStatus } from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import {
  buildParentSystemInputFromTemplateSlot,
  buildParentSystemThreadMention,
  queueParentSystemMessage,
  type ParentSystemInputSegment,
  type ParentSystemRenderedMention,
  type ParentSystemThreadMentionSource,
} from "./parent-system-messages.js";
import {
  getLastThreadCommandFailureOutput,
  getLastThreadOutput,
} from "./thread-data.js";

export type ChildThreadNotificationSource = ParentSystemThreadMentionSource;

export interface ChildThreadTurnNotificationBatchItem {
  childThread: ChildThreadNotificationSource;
  terminalOutput: string | null;
  turnStatus: ThreadEventTurnStatus;
}

interface ChildThreadTurnNotificationBatch {
  items: ChildThreadTurnNotificationBatchItem[];
  timer: ReturnType<typeof setTimeout>;
}

interface RenderChildThreadTurnStatusBatchMessageArgs {
  items: ChildThreadTurnNotificationBatchItem[];
}

interface ChildThreadTurnStatusBatchLine {
  item: ChildThreadTurnNotificationBatchItem;
  mention: ParentSystemRenderedMention;
}

interface RenderChildThreadTurnStatusBatchTextArgs {
  lines: ChildThreadTurnStatusBatchLine[];
}

interface FormatChildThreadTurnStatusLineArgs {
  excerptLimit: number;
  includeInterruptedGuidance: boolean;
  line: ChildThreadTurnStatusBatchLine;
}

interface BuildChildThreadTurnStatusBatchInputArgs {
  items: ChildThreadTurnNotificationBatchItem[];
}

interface BuildChildThreadNeedsAttentionInputArgs {
  childThread: ChildThreadNotificationSource;
}

interface QueueChildThreadTurnNotificationArgs {
  childThread: ChildThreadNotificationSource;
  parentThreadId: string;
  turnStatus: ThreadEventTurnStatus;
}

interface QueueChildThreadNeedsAttentionNotificationArgs {
  childThread: ChildThreadNotificationSource;
  parentThreadId: string;
}

const CHILD_THREAD_TURN_NOTIFICATION_BATCH_DELAY_MS = 2_000;
const CHILD_THREAD_OUTCOME_BATCH_UPDATES_SLOT =
  "__BB_CHILD_THREAD_OUTCOME_BATCH_UPDATES__";
const CHILD_THREAD_MENTION_SLOT = "__BB_CHILD_THREAD_MENTION__";
const CHILD_THREAD_TERMINAL_OUTPUT_EXCERPT_CHAR_LIMIT = 4_000;
const CHILD_THREAD_BATCH_TERMINAL_OUTPUT_EXCERPT_CHAR_LIMIT = 1_200;
const CHILD_THREAD_BATCH_MESSAGE_CHAR_LIMIT = 6_000;
const CHILD_THREAD_OUTPUT_TRUNCATION_MARKER =
  "\n\n[... output truncated ...]";
const CHILD_THREAD_OUTPUT_OMITTED_MARKER =
  "[... output omitted; message limit reached ...]";
const CHILD_THREAD_INTERRUPTED_GUIDANCE =
  "If the user stopped it manually, do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.";
const CHILD_THREAD_BATCH_INTERRUPTED_GUIDANCE =
  "If the user stopped any interrupted thread manually, do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.";
const childThreadTurnNotificationBatches = new Map<
  string,
  ChildThreadTurnNotificationBatch
>();

function buildChildThreadTurnStatusHeadingSegments(
  args: FormatChildThreadTurnStatusLineArgs,
): ParentSystemInputSegment[] {
  switch (args.line.item.turnStatus) {
    case "completed":
      return [
        { kind: "mention", mention: args.line.mention },
        { kind: "text", text: " completed:" },
      ];
    case "failed":
      return [
        { kind: "mention", mention: args.line.mention },
        { kind: "text", text: " failed:" },
      ];
    case "interrupted":
      return [
        { kind: "mention", mention: args.line.mention },
        { kind: "text", text: " was interrupted:" },
      ];
    default: {
      const exhaustiveCheck: never = args.line.item.turnStatus;
      return exhaustiveCheck;
    }
  }
}

function childThreadEmptyOutputFallback(
  turnStatus: ThreadEventTurnStatus,
): string {
  switch (turnStatus) {
    case "completed":
      return "No final output was recorded.";
    case "failed":
      return "No failure output was recorded.";
    case "interrupted":
      return "No interruption output was recorded.";
    default: {
      const exhaustiveCheck: never = turnStatus;
      return exhaustiveCheck;
    }
  }
}

function truncateChildThreadOutput(text: string, limit: number): string {
  if (limit <= CHILD_THREAD_OUTPUT_OMITTED_MARKER.length) {
    return CHILD_THREAD_OUTPUT_OMITTED_MARKER;
  }
  if (text.length <= limit) {
    return text;
  }

  const retainedLength = Math.max(
    0,
    limit - CHILD_THREAD_OUTPUT_TRUNCATION_MARKER.length,
  );
  if (retainedLength === 0) {
    return CHILD_THREAD_OUTPUT_TRUNCATION_MARKER.trimStart();
  }
  return `${text.slice(0, retainedLength).trimEnd()}${CHILD_THREAD_OUTPUT_TRUNCATION_MARKER}`;
}

function formatChildThreadOutputExcerpt(
  args: FormatChildThreadTurnStatusLineArgs,
): string {
  const output = args.line.item.terminalOutput?.trim();
  if (!output) {
    return childThreadEmptyOutputFallback(args.line.item.turnStatus);
  }
  return truncateChildThreadOutput(output, args.excerptLimit);
}

function parentSystemSegmentText(segment: ParentSystemInputSegment): string {
  switch (segment.kind) {
    case "text":
      return segment.text;
    case "mention":
      return segment.mention.serializedText;
    default: {
      const exhaustiveCheck: never = segment;
      return exhaustiveCheck;
    }
  }
}

function parentSystemSegmentsText(
  segments: readonly ParentSystemInputSegment[],
): string {
  return segments.map(parentSystemSegmentText).join("");
}

function parentSystemSegmentsTextLength(
  segments: readonly ParentSystemInputSegment[],
): number {
  return parentSystemSegmentsText(segments).length;
}

function buildChildThreadTurnStatusBatchLines(
  args: RenderChildThreadTurnStatusBatchMessageArgs,
): ChildThreadTurnStatusBatchLine[] {
  return args.items.map((item) => ({
    item,
    mention: buildParentSystemThreadMention({
      thread: item.childThread,
    }),
  }));
}

function renderChildThreadTurnStatusBatchText(
  args: RenderChildThreadTurnStatusBatchTextArgs,
): string {
  const updates = parentSystemSegmentsText(
    buildChildThreadTurnStatusBatchSegments(args),
  );
  return renderTemplate("systemMessageChildThreadOutcomeBatch", {
    updates,
  });
}

function buildChildThreadTurnStatusLineSegments(
  args: FormatChildThreadTurnStatusLineArgs,
): ParentSystemInputSegment[] {
  const segments: ParentSystemInputSegment[] = [
    ...buildChildThreadTurnStatusHeadingSegments(args),
    {
      kind: "text",
      text: `\n\n${formatChildThreadOutputExcerpt(args)}`,
    },
  ];
  if (
    args.includeInterruptedGuidance &&
    args.line.item.turnStatus === "interrupted"
  ) {
    segments.push({
      kind: "text",
      text: `\n\n${CHILD_THREAD_INTERRUPTED_GUIDANCE}`,
    });
  }
  return segments;
}

function childThreadBatchExcerptLimit(
  segments: readonly ParentSystemInputSegment[],
): number {
  const remaining =
    CHILD_THREAD_BATCH_MESSAGE_CHAR_LIMIT -
    parentSystemSegmentsTextLength(segments);
  return Math.min(
    CHILD_THREAD_BATCH_TERMINAL_OUTPUT_EXCERPT_CHAR_LIMIT,
    Math.max(0, remaining),
  );
}

function getChildThreadTerminalOutput(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueChildThreadTurnNotificationArgs,
): string | null {
  const lastThreadOutput = getLastThreadOutput(deps.db, args.childThread.id);
  if (args.turnStatus !== "failed") {
    return lastThreadOutput;
  }
  return (
    getLastThreadCommandFailureOutput(deps.db, args.childThread.id) ??
    lastThreadOutput
  );
}

function buildChildThreadTurnStatusBatchSegments(
  args: RenderChildThreadTurnStatusBatchTextArgs,
): ParentSystemInputSegment[] {
  if (args.lines.length === 1 && args.lines[0]) {
    return buildChildThreadTurnStatusLineSegments({
      excerptLimit: CHILD_THREAD_TERMINAL_OUTPUT_EXCERPT_CHAR_LIMIT,
      includeInterruptedGuidance: true,
      line: args.lines[0],
    });
  }

  const segments: ParentSystemInputSegment[] = [];
  segments.push({ kind: "text", text: "Managed thread updates:" });
  for (const line of args.lines) {
    segments.push({ kind: "text", text: "\n\n" });
    segments.push(
      ...buildChildThreadTurnStatusLineSegments({
        excerptLimit: childThreadBatchExcerptLimit(segments),
        includeInterruptedGuidance: false,
        line,
      }),
    );
  }
  if (args.lines.some((line) => line.item.turnStatus === "interrupted")) {
    segments.push({
      kind: "text",
      text: `\n\n${CHILD_THREAD_BATCH_INTERRUPTED_GUIDANCE}`,
    });
  }
  return segments;
}

export function renderChildThreadTurnStatusBatchMessage(
  args: RenderChildThreadTurnStatusBatchMessageArgs,
): string {
  return renderChildThreadTurnStatusBatchText({
    lines: buildChildThreadTurnStatusBatchLines(args),
  });
}

export function buildChildThreadTurnStatusBatchInput(
  args: BuildChildThreadTurnStatusBatchInputArgs,
): PromptInput[] {
  const lines = buildChildThreadTurnStatusBatchLines(args);
  const renderedText = renderTemplate("systemMessageChildThreadOutcomeBatch", {
    updates: CHILD_THREAD_OUTCOME_BATCH_UPDATES_SLOT,
  });
  return buildParentSystemInputFromTemplateSlot({
    renderedText,
    slot: CHILD_THREAD_OUTCOME_BATCH_UPDATES_SLOT,
    segments: buildChildThreadTurnStatusBatchSegments({ lines }),
  });
}

export function buildChildThreadNeedsAttentionInput(
  args: BuildChildThreadNeedsAttentionInputArgs,
): PromptInput[] {
  const mention = buildParentSystemThreadMention({
    thread: args.childThread,
  });
  const renderedText = renderTemplate(
    "systemMessageChildThreadNeedsAttention",
    {
      threadMention: CHILD_THREAD_MENTION_SLOT,
    },
  );
  return buildParentSystemInputFromTemplateSlot({
    renderedText,
    slot: CHILD_THREAD_MENTION_SLOT,
    segments: [{ kind: "mention", mention }],
  });
}

function childThreadTurnNotificationLogMessage(
  turnStatus: ThreadEventTurnStatus,
): string {
  switch (turnStatus) {
    case "completed":
      return "Failed to queue parent completed-thread notification";
    case "failed":
      return "Failed to queue parent failed-thread notification";
    case "interrupted":
      return "Failed to queue parent interrupted-thread notification";
    default: {
      const exhaustiveCheck: never = turnStatus;
      return exhaustiveCheck;
    }
  }
}

async function flushChildThreadTurnNotificationBatch(
  deps: LoggedPendingInteractionWorkSessionDeps,
  parentThreadId: string,
): Promise<void> {
  const batch = childThreadTurnNotificationBatches.get(parentThreadId);
  if (!batch) {
    return;
  }
  childThreadTurnNotificationBatches.delete(parentThreadId);

  try {
    await queueParentSystemMessage(deps, {
      input: buildChildThreadTurnStatusBatchInput({
        items: batch.items,
      }),
      parentThreadId,
    });
  } catch (error) {
    deps.logger.error(
      {
        err: error,
        parentThreadId,
        childThreads: batch.items.map((item) => ({
          childThreadId: item.childThread.id,
          turnStatus: item.turnStatus,
        })),
      },
      "Failed to queue batched parent turn notifications",
    );
  }
}

function scheduleChildThreadTurnNotificationBatchFlush(
  deps: LoggedPendingInteractionWorkSessionDeps,
  parentThreadId: string,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    void flushChildThreadTurnNotificationBatch(deps, parentThreadId);
  }, CHILD_THREAD_TURN_NOTIFICATION_BATCH_DELAY_MS);
}

function queueChildThreadTurnNotificationBatchItem(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueChildThreadTurnNotificationArgs,
): void {
  const existingBatch = childThreadTurnNotificationBatches.get(
    args.parentThreadId,
  );
  if (existingBatch) {
    existingBatch.items.push({
      childThread: args.childThread,
      terminalOutput: getChildThreadTerminalOutput(deps, args),
      turnStatus: args.turnStatus,
    });
    clearTimeout(existingBatch.timer);
    existingBatch.timer = scheduleChildThreadTurnNotificationBatchFlush(
      deps,
      args.parentThreadId,
    );
    return;
  }

  childThreadTurnNotificationBatches.set(args.parentThreadId, {
    items: [
      {
        childThread: args.childThread,
        terminalOutput: getChildThreadTerminalOutput(deps, args),
        turnStatus: args.turnStatus,
      },
    ],
    timer: scheduleChildThreadTurnNotificationBatchFlush(
      deps,
      args.parentThreadId,
    ),
  });
}

/**
 * Queues a parent-facing notification for child thread turn outcomes.
 * Normal turn-completion event side effects pass the actual terminal status;
 * command-result failures pass `failed` because no terminal turn event exists.
 * This is best-effort post-commit notification work.
 */
export async function queueChildThreadTurnNotificationBestEffort(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueChildThreadTurnNotificationArgs,
): Promise<void> {
  try {
    queueChildThreadTurnNotificationBatchItem(deps, args);
  } catch (error) {
    deps.logger.error(
      {
        childThreadId: args.childThread.id,
        parentThreadId: args.parentThreadId,
        turnStatus: args.turnStatus,
        err: error,
      },
      childThreadTurnNotificationLogMessage(args.turnStatus),
    );
  }
}

export async function queueChildThreadNeedsAttentionNotificationBestEffort(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueChildThreadNeedsAttentionNotificationArgs,
): Promise<void> {
  try {
    await queueParentSystemMessage(deps, {
      input: buildChildThreadNeedsAttentionInput({
        childThread: args.childThread,
      }),
      parentThreadId: args.parentThreadId,
    });
  } catch (error) {
    deps.logger.error(
      {
        childThreadId: args.childThread.id,
        parentThreadId: args.parentThreadId,
        err: error,
      },
      "Failed to queue parent needs-attention notification",
    );
  }
}
