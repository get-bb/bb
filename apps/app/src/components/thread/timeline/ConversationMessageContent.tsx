import {
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  TimelineConversationAttachments,
  TimelineRowBase,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import type { PromptTextMention, ThreadChildOrigin } from "@bb/domain";
import { cn } from "@/lib/utils";
import { MarkdownPreview } from "../../ui/markdown-preview.js";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
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
import { MessageActionBar } from "./MessageActionBar.js";
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
  /**
   * `childOrigin` of the thread this row belongs to. Selects the fork leading
   * icon when an agent-initiated thread-start anchor (a fork's seed-without-run
   * row) renders as "Message from {source}". Null for non-fork threads.
   */
  childOrigin: ThreadChildOrigin | null;
  initiator: TimelineUserConversationRow["initiator"];
  mentions: readonly PromptTextMention[];
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  senderThreadId: TimelineUserConversationRow["senderThreadId"];
  senderThreadTitle: string | null;
  turnRequest: TimelineUserConversationRow["turnRequest"];
}

/**
 * Identity of the source timeline row, forwarded onto the assistant message so
 * the per-message fork / side-chat actions (wired in later sessions) can anchor
 * on the exact agent message. Sourced from `TimelineRowBase` rather than inlined
 * primitives so it stays in lockstep with the contract.
 */
type AssistantMessageRowIdentity = Pick<
  TimelineRowBase,
  "id" | "threadId" | "turnId" | "sourceSeqStart" | "sourceSeqEnd"
>;

export interface ConversationMessageContentAssistantProps
  extends ConversationMessageContentBaseProps,
    AssistantMessageRowIdentity {
  role: "assistant";
  // Assistant content renders through MarkdownPreview, which is the only
  // surface with clickable links. User messages render as plain text
  // (CollapsibleMessageText), so this handler lives on the assistant variant
  // only — never accepted-but-ignored.
  onOpenLink?: ThreadTimelineLinkHandler;
  /**
   * Fork the active thread from this agent message. Omitted when forking is
   * unavailable (no host) — the action bar then renders without a Fork button.
   */
  onFork?: () => void;
  /**
   * Open a side chat anchored on this agent message. Omitted when side chats are
   * unavailable (no host secondary panel) — the bar then renders without it.
   */
  onSideChat?: () => void;
  /**
   * Greys the Fork + Side-chat buttons when the thread is at the spawn-depth cap
   * — both spawn a child thread off the active thread, so they share one guard.
   */
  forkDisabled?: boolean;
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
  childOrigin: ThreadChildOrigin | null;
  initiator: TimelineUserConversationRow["initiator"];
  mentions: readonly PromptTextMention[];
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  senderThreadId: TimelineUserConversationRow["senderThreadId"];
  senderThreadTitle: string | null;
  text: string;
  turnRequest: TimelineUserConversationRow["turnRequest"];
}

interface AssistantConversationMessageProps extends AssistantMessageRowIdentity {
  attachmentItems: ConversationAttachmentItems;
  onFork?: () => void;
  onSideChat?: () => void;
  forkDisabled?: boolean;
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  text: string;
}

interface CollapsibleMessageTextProps {
  mentions: readonly PromptTextMention[];
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
  childOrigin,
  initiator,
  mentions,
  onOpenLocalFileLink,
  projectId,
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
        childOrigin={childOrigin}
        mentions={bodyMentions}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
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
        childOrigin={null}
        mentions={bodyMentions}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
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
      <div className="group/message ml-auto w-fit max-w-[80%]">
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
            <MessageActionBar messageText={messageText} alignment="end" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AssistantConversationMessage({
  attachmentItems,
  onFork,
  onSideChat,
  forkDisabled,
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

  return (
    <div className="group/message w-full px-2 text-sm font-normal leading-relaxed">
      <MarkdownPreview content={text} linkRouting={linkRouting} />
      <ConversationAttachments
        filePaths={attachmentItems.filePaths}
        imageItems={attachmentItems.imageItems}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
      />
      {/*
        Copy + fork (S3) + side chat (S4) actions. Each button is dropped
        entirely (not rendered disabled) when its handler is absent — e.g. fork
        is omitted for a personal-only source with no host to base a worktree
        fork on. `disabled` greys both fork and side chat together when the
        thread is at the spawn-depth cap (both spawn a child thread, one guard).
        Negative top margin pulls the hover row up into the gap the message
        already reserves (matching main's copy-row spacing).
      */}
      <div className="-mt-1">
        <MessageActionBar
          messageText={text}
          alignment="start"
          onFork={onFork}
          onSideChat={onSideChat}
          disabled={forkDisabled}
        />
      </div>
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
        childOrigin={props.childOrigin}
        initiator={props.initiator}
        mentions={props.mentions}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
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
      id={props.id}
      onFork={props.onFork}
      onSideChat={props.onSideChat}
      forkDisabled={props.forkDisabled}
      onOpenLink={props.onOpenLink}
      onOpenLocalFileLink={onOpenLocalFileLink}
      projectId={projectId}
      sourceSeqEnd={props.sourceSeqEnd}
      sourceSeqStart={props.sourceSeqStart}
      text={text}
      threadId={props.threadId}
      turnId={props.turnId}
    />
  );
}
