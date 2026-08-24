import type { KeyboardEvent, MouseEvent } from "react";
import { Link } from "react-router-dom";
import type { PromptMentionResource, PromptTextMention } from "@bb/domain";
import { RouteAnchor } from "@/components/ui/app-route-anchor.js";
import {
  getProjectComposeRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PROMPT_MENTION_PILL_CLASS,
  promptMentionTooltipLabel,
} from "@/components/promptbox/mentions/prompt-mention-display";
import { PromptMentionIcon } from "@/components/promptbox/mentions/PromptMentionIcon";
import { promptMentionClipboardDataAttributes } from "@/components/promptbox/mentions/prompt-mention-clipboard";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";

interface PromptMentionPillProps {
  /** Render visual mention styling without allowing navigation or activation. */
  interactive?: boolean;
  resource: PromptMentionResource;
  resolveMentionLink?: PromptMentionLinkResolver;
  serializedText: string;
  /**
   * Explicit href for a thread mention, used by the markdown body renderer to
   * route through the timeline's `resolveSegmentLinkHref` (consistent with the
   * title links). When absent, a thread mention falls back to its
   * `resource.projectId` react-router link; a non-thread mention ignores this.
   */
  linkHref?: string;
  /** Activates a mention that opens an in-place surface instead of a route. */
  onActivate?: () => void;
}

interface NormalizeMentionsArgs {
  mentions: readonly PromptTextMention[];
  textLength: number;
}

interface ShiftMentionsToTextRangeArgs {
  mentions: readonly PromptTextMention[];
  rangeEnd: number;
  rangeStart: number;
}

interface ClipMentionTextToVisibleRangeArgs {
  mentions: readonly PromptTextMention[];
  rangeStart: number;
  text: string;
}

interface ClipMentionTextToVisibleRangeResult {
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
    "bg-surface-raised/50 font-normal no-underline hover:no-underline",
    interactive ? "cursor-pointer hover:bg-state-hover" : "cursor-default",
  );
}

export function PromptMentionPill({
  interactive = true,
  resource,
  resolveMentionLink,
  serializedText,
  linkHref,
  onActivate,
}: PromptMentionPillProps) {
  const title = promptMentionTooltipLabel(resource);
  const clipboardAttributes = promptMentionClipboardDataAttributes({
    resource,
    serializedText,
  });
  const iconClassName = "size-3.5 shrink-0 self-center text-muted-foreground";
  const labelNode = (
    <>
      <PromptMentionIcon resource={resource} className={iconClassName} />
      <span className="truncate">{resource.label}</span>
    </>
  );

  if (!interactive) {
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

  if (onActivate) {
    return (
      <span
        role="link"
        tabIndex={0}
        className={mentionPillClassName(true)}
        {...clipboardAttributes}
        onClick={(event: MouseEvent<HTMLSpanElement>) => {
          event.stopPropagation();
          onActivate();
        }}
        onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            onActivate();
          }
        }}
        title={title}
      >
        {labelNode}
      </span>
    );
  }

  // Markdown bodies route thread mentions through `resolveSegmentLinkHref`
  // (same resolver the title links use); the plain-text path passes no
  // `linkHref` and keeps the `resource.projectId` react-router link below.
  if (resource.kind === "thread" && linkHref) {
    return (
      <RouteAnchor
        className={mentionPillClassName(true)}
        {...clipboardAttributes}
        href={linkHref}
        title={title}
      >
        {labelNode}
      </RouteAnchor>
    );
  }

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

  if (resource.kind === "project") {
    return (
      <Link
        className={mentionPillClassName(true)}
        {...clipboardAttributes}
        to={getProjectComposeRoutePath(resource.projectId)}
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

/**
 * Resolves a thread mention's display resource for the markdown body renderer:
 * the `@thread:<id>` token carries only the id, so the label/projectId are
 * recovered from the body `mentions` array (matched by `threadId`). Falls back
 * to a display-only resource labelled with the id when no mention matches.
 */
export function resolveThreadMentionResource(
  mentions: readonly PromptTextMention[],
  threadId: string,
): PromptMentionResource {
  for (const mention of mentions) {
    if (
      mention.resource.kind === "thread" &&
      mention.resource.threadId === threadId
    ) {
      return mention.resource;
    }
  }
  return { kind: "thread", threadId, label: threadId };
}
