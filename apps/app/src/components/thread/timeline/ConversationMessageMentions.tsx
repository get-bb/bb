import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { PromptMentionResource, PromptTextMention } from "@bb/domain";
import { Icon } from "@/components/ui/icon.js";
import { getThreadRoutePath } from "@/lib/route-paths";
import { cn } from "@/lib/utils";
import {
  PROMPT_MENTION_PILL_CLASS,
  promptMentionIconName,
  promptMentionTooltipLabel,
} from "@/components/promptbox/mentions/prompt-mention-display";
import { promptMentionClipboardDataAttributes } from "@/components/promptbox/mentions/prompt-mention-clipboard";

interface PromptMentionPillProps {
  resource: PromptMentionResource;
  serializedText: string;
}

interface NormalizeMentionsArgs {
  mentions: readonly PromptTextMention[];
  textLength: number;
}

export interface ShiftMentionsToTextRangeArgs {
  mentions: readonly PromptTextMention[];
  rangeEnd: number;
  rangeStart: number;
}

export interface RenderMentionTextSegmentsArgs {
  mentions: readonly PromptTextMention[];
  text: string;
}

export interface ClipMentionTextToVisibleRangeArgs {
  mentions: readonly PromptTextMention[];
  rangeStart: number;
  text: string;
}

export interface ClipMentionTextToVisibleRangeResult {
  mentions: PromptTextMention[];
  text: string;
}

export function normalizePromptTextMentions({
  mentions,
  textLength,
}: NormalizeMentionsArgs): PromptTextMention[] {
  return mentions
    .filter(
      (mention) =>
        mention.start >= 0 &&
        mention.end > mention.start &&
        mention.end <= textLength,
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

export function shiftMentionsToTextRange({
  mentions,
  rangeEnd,
  rangeStart,
}: ShiftMentionsToTextRangeArgs): PromptTextMention[] {
  return mentions.flatMap((mention) => {
    if (mention.start < rangeStart || mention.end > rangeEnd) {
      return [];
    }
    return [
      {
        ...mention,
        start: mention.start - rangeStart,
        end: mention.end - rangeStart,
      },
    ];
  });
}

export function clipMentionTextToVisibleRange({
  mentions,
  rangeStart,
  text,
}: ClipMentionTextToVisibleRangeArgs): ClipMentionTextToVisibleRangeResult {
  const rangeEnd = rangeStart + text.length;
  const clippedRangeEnd = mentions.reduce<number>((currentEnd, mention) => {
    const crossesVisibleEnd =
      mention.start >= rangeStart &&
      mention.start < currentEnd &&
      mention.end > currentEnd;
    return crossesVisibleEnd ? mention.start : currentEnd;
  }, rangeEnd);

  return {
    text: text.slice(0, clippedRangeEnd - rangeStart),
    mentions: shiftMentionsToTextRange({
      mentions,
      rangeStart,
      rangeEnd: clippedRangeEnd,
    }),
  };
}

function mentionPillClassName(interactive: boolean): string {
  return cn(
    PROMPT_MENTION_PILL_CLASS,
    "bg-surface-raised/50 no-underline hover:no-underline",
    interactive && "hover:bg-state-hover",
  );
}

function PromptMentionPill({
  resource,
  serializedText,
}: PromptMentionPillProps) {
  const title = promptMentionTooltipLabel(resource);
  const clipboardAttributes = promptMentionClipboardDataAttributes({
    resource,
    serializedText,
  });
  const labelNode = (
    <>
      <Icon
        name={promptMentionIconName(resource)}
        className="size-3.5 shrink-0 self-center text-muted-foreground"
        aria-hidden
      />
      <span className="truncate">{resource.label}</span>
    </>
  );

  if (resource.kind === "thread" && resource.projectId) {
    return (
      <Link
        className={mentionPillClassName(true)}
        {...clipboardAttributes}
        to={getThreadRoutePath({
          projectId: resource.projectId,
          threadId: resource.threadId,
        })}
        title={title}
      >
        {labelNode}
      </Link>
    );
  }

  // Timeline path mentions are workspace/thread-storage-relative resources.
  // Opening them needs the same environment and thread-storage context
  // the composer resolver owns, so they are intentionally display-only here.
  // Thread mentions without project context are also display-only; linking
  // through the current page project can misroute cross-project mentions.
  return (
    <span
      className={mentionPillClassName(false)}
      {...clipboardAttributes}
      title={title}
    >
      {labelNode}
    </span>
  );
}

export function renderMentionTextSegments({
  mentions,
  text,
}: RenderMentionTextSegmentsArgs): ReactNode {
  const normalizedMentions = normalizePromptTextMentions({
    mentions,
    textLength: text.length,
  });
  if (normalizedMentions.length === 0) {
    return text;
  }

  const segments: ReactNode[] = [];
  let cursor = 0;
  for (const mention of normalizedMentions) {
    if (mention.start < cursor) {
      continue;
    }
    if (mention.start > cursor) {
      segments.push(text.slice(cursor, mention.start));
    }
    segments.push(
      <PromptMentionPill
        key={`${mention.start}:${mention.end}:${mention.resource.kind}`}
        resource={mention.resource}
        serializedText={text.slice(mention.start, mention.end)}
      />,
    );
    cursor = mention.end;
  }
  if (cursor < text.length) {
    segments.push(text.slice(cursor));
  }
  return segments;
}
