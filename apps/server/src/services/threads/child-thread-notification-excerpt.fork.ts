// bb-fork(parent-notify-tail): a child report that ends with a request lost
// bb-fork(parent-notify-tail): that line because the parent notification kept
// bb-fork(parent-notify-tail): only the message head. The excerpt keeps the head
// bb-fork(parent-notify-tail): and the tail inside the same 4000-character
// bb-fork(parent-notify-tail): budget (about 60/40) and the notification names
// bb-fork(parent-notify-tail): the way to read all of it.
import { sliceUtf16HeadAndTail } from "@bb/text-utils";

const EXCERPT_SEPARATOR = "\n\n";
const EXCERPT_TAIL_SHARE = 0.4;

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

export const CHILD_THREAD_BATCH_FULL_OUTPUT_GUIDANCE =
  "Read each child thread's full final message with `bb thread output <thread-id>`.";
