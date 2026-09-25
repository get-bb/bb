// bb-fork(parent-notify-tail): a child report that ends with a request lost
// bb-fork(parent-notify-tail): that line because the parent notification kept
// bb-fork(parent-notify-tail): only the message head. The excerpt keeps the head
// bb-fork(parent-notify-tail): and the tail inside the same 4000-character
// bb-fork(parent-notify-tail): budget (about 60/40) and the notification names
// bb-fork(parent-notify-tail): the way to read all of it.
// bb-fork(parent-notify-tail): a batched outcome rendered status only, so one
// bb-fork(parent-notify-tail): sibling finishing nearby silently hid every
// bb-fork(parent-notify-tail): completed report. Batched rows now carry the same
// bb-fork(parent-notify-tail): head+tail excerpt, capped per child and across the
// bb-fork(parent-notify-tail): whole batch, with an explicit marker once the
// bb-fork(parent-notify-tail): shared budget runs out.
import { sliceUtf16HeadAndTail } from "@bb/text-utils";
import type { ParentSystemInputSegment } from "./parent-system-messages.js";

const EXCERPT_SEPARATOR = "\n\n";
const EXCERPT_TAIL_SHARE = 0.4;

export const CHILD_THREAD_BATCH_TERMINAL_OUTPUT_EXCERPT_CHAR_LIMIT = 1_200;
export const CHILD_THREAD_BATCH_MESSAGE_CHAR_LIMIT = 6_000;
export const CHILD_THREAD_BATCH_OUTPUT_OMITTED_MARKER =
  "[... output omitted; message limit reached ...]";
export const CHILD_THREAD_EMPTY_OUTPUT_TEXT =
  "No final output was recorded.";

export interface ChildThreadNotificationExcerptArgs {
  limit: number;
  text: string;
  truncationMarker: string;
}

export function buildChildThreadNotificationExcerpt(
  args: ChildThreadNotificationExcerptArgs,
): string {
  const { limit, text, truncationMarker } = args;
  if (text.length <= limit) {
    return text;
  }

  const retainedLength =
    limit - truncationMarker.length - EXCERPT_SEPARATOR.length;
  if (retainedLength <= 0) {
    return truncationMarker.trimStart();
  }

  const tailLength = Math.floor(retainedLength * EXCERPT_TAIL_SHARE);
  const { head, tail } = sliceUtf16HeadAndTail(
    text,
    retainedLength - tailLength,
    tailLength,
  );
  return `${head.trimEnd()}${truncationMarker}${EXCERPT_SEPARATOR}${tail.trimStart()}`;
}

export function childThreadFullOutputGuidance(threadId: string): string {
  return `If this excerpt is trimmed, read the full final message with \`bb thread output ${threadId}\`.`;
}

export interface ChildThreadBatchOutputSegmentsArgs {
  limit: number;
  output: string | null;
  truncationMarker: string;
}

export function parentSystemSegmentsTextLength(
  segments: readonly ParentSystemInputSegment[],
): number {
  return segments.reduce(
    (length, segment) =>
      length +
      (segment.kind === "text"
        ? segment.text.length
        : segment.mention.serializedText.length),
    0,
  );
}

export function childThreadBatchOutputExcerptLimit(args: {
  usedLength: number;
}): number {
  const remaining = CHILD_THREAD_BATCH_MESSAGE_CHAR_LIMIT - args.usedLength;
  return Math.max(
    0,
    Math.min(CHILD_THREAD_BATCH_TERMINAL_OUTPUT_EXCERPT_CHAR_LIMIT, remaining),
  );
}

export function buildChildThreadBatchOutputSegments(
  args: ChildThreadBatchOutputSegmentsArgs,
): ParentSystemInputSegment[] {
  const output = args.output?.trim();
  if (!output) {
    return [{ kind: "text", text: `\n\n${CHILD_THREAD_EMPTY_OUTPUT_TEXT}` }];
  }
  if (args.limit <= CHILD_THREAD_BATCH_OUTPUT_OMITTED_MARKER.length) {
    return [
      { kind: "text", text: `\n\n${CHILD_THREAD_BATCH_OUTPUT_OMITTED_MARKER}` },
    ];
  }

  const excerpt = buildChildThreadNotificationExcerpt({
    limit: args.limit,
    text: output,
    truncationMarker: args.truncationMarker,
  });
  return [{ kind: "text", text: `\n\n${excerpt}` }];
}

export const CHILD_THREAD_BATCH_FULL_OUTPUT_GUIDANCE =
  "Read each child thread's full final message with `bb thread output <thread-id>`.";
