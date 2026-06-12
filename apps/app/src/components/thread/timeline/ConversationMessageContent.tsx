import { useMemo, useRef, useState } from "react";
import type {
  TimelineConversationAttachments,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import type { PromptTextMention } from "@bb/domain";
import { CopyButton } from "../../ui/copy-button.js";
import { cn } from "@/lib/utils";
import { MarkdownPreview } from "../../ui/markdown-preview.js";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { computeMutedPrefixLength } from "./compute-muted-prefix-length.js";
import type { TimelineTitleLinkResolver } from "./TimelineTitleView.js";
import type {
  ThreadTimelineLinkHandler,
  ThreadTimelineLocalFileLinkHandler,
  UserAttachmentImageSrcResolver,
} from "./types.js";
import {
  ConversationAttachments,
  buildAttachmentItems,
  type ConversationAttachmentItems,
} from "./ConversationAttachments.js";
import {
  GeneratedConversationMessage,
  generatedConversationBodySlice,
} from "./GeneratedConversationMessage.js";
import {
  clipMentionTextToVisibleRange,
  renderMentionTextSegments,
  shiftMentionsToTextRange,
} from "./ConversationMessageMentions.js";
import { USER_MESSAGE_CHAR_CAP } from "./conversation-message-limits.js";
import { turnRequestLabel } from "./conversation-turn-request-label.js";
import { TurnRequestLabel } from "./TurnRequestLabel.js";
import {
  ConversationMessageOverflowToggle,
  useIsOverflowing,
} from "./conversation-message-overflow.js";

interface ConversationMessageContentBaseProps {
  attachments: TimelineConversationAttachments | null;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  resolveUserAttachmentImageSrc?: UserAttachmentImageSrcResolver;
  text: string;
}

export interface ConversationMessageContentUserProps extends ConversationMessageContentBaseProps {
  role: "user";
  initiator: TimelineUserConversationRow["initiator"];
  mentions: readonly PromptTextMention[];
  resolveMentionLink?: PromptMentionLinkResolver;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  senderThreadId: TimelineUserConversationRow["senderThreadId"];
  senderThreadTitle: string | null;
  turnRequest: TimelineUserConversationRow["turnRequest"];
}

export interface ConversationMessageContentAssistantProps extends ConversationMessageContentBaseProps {
  role: "assistant";
  // Assistant content renders through MarkdownPreview, which is the only
  // surface with clickable links. User messages render as plain text
  // (CollapsibleMessageText), so this handler lives on the assistant variant
  // only — never accepted-but-ignored.
  onOpenLink?: ThreadTimelineLinkHandler;
  turnRequest: null;
}

/**
 * Discriminated on `role` so the user variant carries `initiator` +
 * non-null `turnRequest` while the assistant variant requires neither.
 * Avoids optional-with-default props (AGENTS.md: "do not use optional
 * fields to hide defaults") and lets the renderer drop optional-chain
 * defenses on contract-required fields.
 */
export type ConversationMessageContentProps =
  | ConversationMessageContentUserProps
  | ConversationMessageContentAssistantProps;

interface UserConversationMessageProps {
  attachmentItems: ConversationAttachmentItems;
  initiator: TimelineUserConversationRow["initiator"];
  mentions: readonly PromptTextMention[];
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  senderThreadId: TimelineUserConversationRow["senderThreadId"];
  senderThreadTitle: string | null;
  text: string;
  turnRequest: TimelineUserConversationRow["turnRequest"];
}

interface AssistantConversationMessageProps {
  attachmentItems: ConversationAttachmentItems;
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  text: string;
}

interface CollapsibleMessageTextProps {
  mentions: readonly PromptTextMention[];
  resolveMentionLink?: PromptMentionLinkResolver;
  text: string;
  /**
   * When set, the first `mutePrefixLength` characters of `text` are rendered
   * inside a muted, max-width-truncated pill — used for `[bb …]` prefixes on
   * system-initiated messages and non-user messages without sender metadata.
   */
  mutePrefixLength?: number;
}

function splitPreWrappedLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/u);
}

function CollapsibleMessageText({
  mentions,
  resolveMentionLink,
  text,
  mutePrefixLength,
}: CollapsibleMessageTextProps) {
  // The prefix is computed off the full source text; if it would consume
  // everything we'd show (or extend past the text — e.g. char-cap truncates
  // before the closing `]`), fall back to plain rendering.
  const showMutedPrefix =
    typeof mutePrefixLength === "number" &&
    mutePrefixLength > 0 &&
    mutePrefixLength < text.length;
  const prefixText = showMutedPrefix ? text.slice(0, mutePrefixLength) : null;
  const bodyText = showMutedPrefix ? text.slice(mutePrefixLength) : text;
  const bodyOffset = showMutedPrefix ? mutePrefixLength : 0;

  const [isExpanded, setIsExpanded] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const isTruncated = bodyText.length > USER_MESSAGE_CHAR_CAP;
  const cappedBody = isTruncated
    ? bodyText.slice(0, USER_MESSAGE_CHAR_CAP)
    : bodyText;
  const lines = splitPreWrappedLines(cappedBody);
  const exceedsCollapsedLineCount = lines.length > 15;
  // Collapsed view hands only the visible-by-line-clamp lines to the DOM;
  // expanded view hands the (already-capped) full text. Both stay below the
  // hard char cap so a megabyte paste can't dominate window-resize reflow.
  const renderedBody =
    isExpanded || !exceedsCollapsedLineCount
      ? cappedBody
      : lines.slice(0, 15).join("\n");
  const isOverflowing = useIsOverflowing({
    elementRef: textRef,
    enabled: !isExpanded,
    measurementKey: renderedBody,
  });
  const showToggle = isExpanded || exceedsCollapsedLineCount || isOverflowing;
  const safeRenderedBody = clipMentionTextToVisibleRange({
    mentions,
    rangeStart: bodyOffset,
    text: renderedBody,
  });

  return (
    <>
      {prefixText !== null ? (
        <span
          className="line-clamp-1 text-muted-foreground"
          title={prefixText.trimEnd()}
        >
          {prefixText}
        </span>
      ) : null}
      <p
        ref={textRef}
        className={cn(
          "whitespace-pre-wrap break-words",
          !isExpanded && "line-clamp-[15]",
        )}
      >
        {renderMentionTextSegments({
          mentions: safeRenderedBody.mentions,
          resolveMentionLink,
          text: safeRenderedBody.text,
        })}
        {isExpanded && isTruncated ? (
          <span className="text-muted-foreground"> [truncated]</span>
        ) : null}
      </p>
      {showToggle ? (
        <ConversationMessageOverflowToggle
          expanded={isExpanded}
          labels={{ collapsed: "Show more", expanded: "Show less" }}
          onToggle={() => setIsExpanded((prev) => !prev)}
        />
      ) : null}
    </>
  );
}

function UserConversationMessage({
  attachmentItems,
  initiator,
  mentions,
  onOpenLocalFileLink,
  projectId,
  resolveMentionLink,
  resolveSegmentLinkHref,
  senderThreadId,
  senderThreadTitle,
  text,
  turnRequest,
}: UserConversationMessageProps) {
  if (initiator === "agent" && senderThreadId !== null) {
    const body = generatedConversationBodySlice({ initiator, text });
    const bodyMentions = shiftMentionsToTextRange({
      mentions,
      rangeStart: body.startOffset,
      rangeEnd: body.startOffset + body.text.length,
    });
    return (
      <GeneratedConversationMessage
        attachmentItems={attachmentItems}
        mentions={bodyMentions}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
        resolveMentionLink={resolveMentionLink}
        resolveSegmentLinkHref={resolveSegmentLinkHref}
        sourceKind="agent"
        sourceName={senderThreadTitle ?? "Agent"}
        sourceThreadId={senderThreadId}
        text={body.text}
        turnRequest={turnRequest}
      />
    );
  }

  if (initiator === "system") {
    const body = generatedConversationBodySlice({ initiator, text });
    const bodyMentions = shiftMentionsToTextRange({
      mentions,
      rangeStart: body.startOffset,
      rangeEnd: body.startOffset + body.text.length,
    });
    return (
      <GeneratedConversationMessage
        attachmentItems={attachmentItems}
        mentions={bodyMentions}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
        resolveMentionLink={resolveMentionLink}
        resolveSegmentLinkHref={resolveSegmentLinkHref}
        sourceKind="system"
        sourceName="BB"
        sourceThreadId={null}
        text={body.text}
        turnRequest={turnRequest}
      />
    );
  }

  const mutePrefixLength = computeMutedPrefixLength(initiator, text);
  const messageText = text.trim();
  const requestLabel = turnRequestLabel(turnRequest);

  return (
    <div className="w-full">
      <div className="group ml-auto w-fit max-w-[80%]">
        {requestLabel ? (
          <div className="mb-1 flex justify-end">
            <TurnRequestLabel
              turnRequest={turnRequest}
              icon="ArrowTurnForward"
            />
          </div>
        ) : null}
        <div className="rounded-md bg-surface-recessed p-2 text-sm leading-relaxed text-foreground">
          {messageText ? (
            <CollapsibleMessageText
              mentions={mentions}
              resolveMentionLink={resolveMentionLink}
              text={text}
              mutePrefixLength={mutePrefixLength || undefined}
            />
          ) : (
            <p className="text-muted-foreground">Sent attachments</p>
          )}
          <ConversationAttachments
            align="end"
            filePaths={attachmentItems.filePaths}
            imageItems={attachmentItems.imageItems}
            onOpenLocalFileLink={onOpenLocalFileLink}
            projectId={projectId}
          />
        </div>
        {messageText ? (
          <div className="mt-1 flex justify-end">
            <CopyButton
              text={text}
              label="Copy message"
              className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AssistantConversationMessage({
  attachmentItems,
  onOpenLink,
  onOpenLocalFileLink,
  projectId,
  text,
}: AssistantConversationMessageProps) {
  const linkRouting = useMemo<MarkdownLinkRouting | undefined>(() => {
    if (!onOpenLink && !onOpenLocalFileLink) {
      return undefined;
    }

    const routing: MarkdownLinkRouting = {};
    if (onOpenLink) {
      routing.onOpenLink = onOpenLink;
    }
    if (onOpenLocalFileLink) {
      routing.localFile = {
        absoluteLinks: {
          kind: "trusted-host",
        },
        onOpenLink: onOpenLocalFileLink,
      };
    }
    return routing;
  }, [onOpenLink, onOpenLocalFileLink]);

  const messageText = text.trim();

  return (
    <div className="group w-full px-2 text-sm font-normal leading-relaxed">
      <MarkdownPreview content={text} linkRouting={linkRouting} />
      <ConversationAttachments
        filePaths={attachmentItems.filePaths}
        imageItems={attachmentItems.imageItems}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
      />
      {messageText ? (
        // Pull the hover action row up to reclaim the gap below the message
        // rather than stacking on top of it, so the copy button (and future
        // icon buttons in this row) sit in space the message already reserves.
        <div className="-mt-1 flex justify-start">
          <CopyButton
            text={text}
            label="Copy message"
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          />
        </div>
      ) : null}
    </div>
  );
}

export function ConversationMessageContent(
  props: ConversationMessageContentProps,
) {
  const {
    attachments,
    onOpenLocalFileLink,
    projectId,
    resolveUserAttachmentImageSrc,
    text,
  } = props;
  const attachmentItems = useMemo(
    () =>
      buildAttachmentItems({
        attachments,
        projectId,
        resolveUserAttachmentImageSrc,
      }),
    [attachments, projectId, resolveUserAttachmentImageSrc],
  );

  if (props.role === "user") {
    return (
      <UserConversationMessage
        attachmentItems={attachmentItems}
        initiator={props.initiator}
        mentions={props.mentions}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
        resolveMentionLink={props.resolveMentionLink}
        resolveSegmentLinkHref={props.resolveSegmentLinkHref}
        senderThreadId={props.senderThreadId}
        senderThreadTitle={props.senderThreadTitle}
        text={text}
        turnRequest={props.turnRequest}
      />
    );
  }

  return (
    <AssistantConversationMessage
      attachmentItems={attachmentItems}
      onOpenLink={props.onOpenLink}
      onOpenLocalFileLink={onOpenLocalFileLink}
      projectId={projectId}
      text={text}
    />
  );
}
