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
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";

interface PromptMentionPillProps {
  resource: PromptMentionResource;
  resolveMentionLink?: PromptMentionLinkResolver;
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
  resolveMentionLink?: PromptMentionLinkResolver;
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
    interactive && "cursor-pointer hover:bg-state-hover",
  );
}

function PromptMentionPill({
  resource,
  resolveMentionLink,
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

  if (resource.kind === "path") {
    const activate = resolveMentionLink?.(resource) ?? null;
    if (activate) {
      return (
        <button
          type="button"
          className={mentionPillClassName(true)}
          {...clipboardAttributes}
          onClick={activate}
          title={title}
        >
          {labelNode}
        </button>
      );
    }
  }

  // Timeline path mentions are workspace/thread-storage-relative resources.
  // Opening them needs environment and thread-storage context from the page
  // owner; without a resolver, they stay display-only.
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
  resolveMentionLink,
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
        resolveMentionLink={resolveMentionLink}
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

// Quote styling mirrors the agent-message blockquote and the composer's inline
// blockquote (left accent border + muted text), so a quote reads the same
// wherever it appears.
const MESSAGE_QUOTE_BLOCK_CLASS =
  "my-1 border-l-2 border-surface-selected-border pl-3 text-muted-foreground";

function isQuoteLine(line: string): boolean {
  return line === ">" || line.startsWith("> ");
}

function stripQuotePrefix(line: string): string {
  if (line.startsWith("> ")) return line.slice(2);
  if (line === ">") return "";
  return line;
}

/** Whether `text` contains any `> `-prefixed blockquote line. */
export function messageBodyHasQuote(text: string): boolean {
  return text.split("\n").some(isQuoteLine);
}

/**
 * Render a message body that contains `> ` blockquote lines: consecutive quote
 * lines become a styled `<blockquote>` (prefix stripped), and runs of normal
 * lines render as paragraphs with their mention pills intact. Quote content is
 * treated as plain text (captured selections don't carry mentions). Callers
 * should only use this when {@link messageBodyHasQuote} is true; otherwise the
 * single-paragraph renderer keeps its existing line-clamp behavior.
 */
export function renderMessageBodyWithQuotes({
  mentions,
  resolveMentionLink,
  text,
}: RenderMentionTextSegmentsArgs): ReactNode {
  const normalized = normalizePromptTextMentions({
    mentions,
    textLength: text.length,
  });
  const lines = text.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1; // +1 for the "\n" delimiter
  }

  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const quote = isQuoteLine(lines[index]!);
    let end = index;
    while (end < lines.length && isQuoteLine(lines[end]!) === quote) {
      end += 1;
    }
    const groupLines = lines.slice(index, end);
    if (quote) {
      blocks.push(
        <blockquote key={index} className={MESSAGE_QUOTE_BLOCK_CLASS}>
          <span className="whitespace-pre-wrap break-words">
            {groupLines.map(stripQuotePrefix).join("\n")}
          </span>
        </blockquote>,
      );
    } else {
      const spanStart = lineStarts[index]!;
      const spanEnd = lineStarts[end - 1]! + groupLines[groupLines.length - 1]!.length;
      const subText = text.slice(spanStart, spanEnd);
      const subMentions = normalized.flatMap((mention) =>
        mention.start >= spanStart && mention.end <= spanEnd
          ? [
              {
                ...mention,
                start: mention.start - spanStart,
                end: mention.end - spanStart,
              },
            ]
          : [],
      );
      blocks.push(
        <p key={index} className="whitespace-pre-wrap break-words">
          {renderMentionTextSegments({
            mentions: subMentions,
            resolveMentionLink,
            text: subText,
          })}
        </p>,
      );
    }
    index = end;
  }
  return blocks;
}
