import { useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  TimelineConversationAttachments,
  TimelineRowBase,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import type { PromptTextMention, ThreadChildOrigin } from "@bb/domain";
import { cn } from "@/lib/utils";
import { MarkdownPreview } from "../../ui/markdown-preview.js";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { computeMutedPrefixLength } from "./compute-muted-prefix-length.js";
import type {
  TimelineTitleActionResolver,
  TimelineTitleLinkResolver,
} from "./TimelineTitleView.js";
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
  shiftMentionsToTextRange,
} from "./ConversationMessageMentions.js";
import type { MarkdownPromptMentions } from "@/components/ui/markdown-prompt-mentions.js";
import { USER_MESSAGE_CHAR_CAP } from "./conversation-message-limits.js";
import { turnRequestLabel } from "./conversation-turn-request-label.js";
import { TurnRequestLabel } from "./TurnRequestLabel.js";
import { MessageActionBar } from "./MessageActionBar.js";
import {
  ConversationMessageOverflowToggle,
  useIsOverflowing,
} from "./conversation-message-overflow.js";
import {
  SelectableMessageProse,
  type MessageProseSelection,
} from "./SelectableMessageProse.js";

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
  onAddToChat?: (text: string) => void;
  resolveMentionLink?: PromptMentionLinkResolver;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  onOpenLink?: ThreadTimelineLinkHandler;
  onTitleAction?: TimelineTitleActionResolver;
  senderThreadId: TimelineUserConversationRow["senderThreadId"];
  senderThreadTitle: string | null;
  /** `childOrigin` of the SENDER thread (the cross-thread "Message from" source),
   * so a message handed back from a side chat reads "Message from side chat". */
  senderChildOrigin: ThreadChildOrigin | null;
  // Family-B taxonomy fields off the row, required and always supplied (legacy
  // rows carry `unlabeled` + `null`). They drive the `system`-initiated message
  // title, icon, and title-only collapse in `GeneratedConversationMessage`.
  systemMessageKind: TimelineUserConversationRow["systemMessageKind"];
  systemMessageSubject: TimelineUserConversationRow["systemMessageSubject"];
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

const COLLAPSED_MESSAGE_FADE_STYLE: CSSProperties = {
  maskImage:
    "linear-gradient(to bottom, black calc(100% - 2.5rem), transparent)",
  WebkitMaskImage:
    "linear-gradient(to bottom, black calc(100% - 2.5rem), transparent)",
};

export interface ConversationMessageContentAssistantProps
  extends ConversationMessageContentBaseProps, AssistantMessageRowIdentity {
  role: "assistant";
  // Assistant content and generated system rows render through MarkdownPreview,
  // which is the only message body surface with clickable web links.
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
   * Hand this agent message back to the main thread. Supplied only inside a side
   * chat; omitted on the main timeline (a main message has no main thread).
   */
  onSendToMain?: () => void;
  /**
   * Greys the Fork + Side-chat buttons when the thread is at the spawn-depth cap
   * — both spawn a child thread off the active thread, so they share one guard.
   */
  forkDisabled?: boolean;
  /**
   * Reports this message's in-bounds text selection (or `null` when cleared) up
   * to the timeline-level selection controller that drives the single floating
   * menu. Omitted when no controller is wired in (e.g. delegation output).
   */
  onSelectProse?: (selection: MessageProseSelection | null) => void;
  /** Shows the hover-revealed copy/fork/side-chat action footer. */
  showActions: boolean;
  turnRequest: null;
  workspaceRootPath?: string;
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
  onAddToChat?: (text: string) => void;
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  onTitleAction?: TimelineTitleActionResolver;
  senderThreadId: TimelineUserConversationRow["senderThreadId"];
  senderThreadTitle: string | null;
  senderChildOrigin: ThreadChildOrigin | null;
  systemMessageKind: TimelineUserConversationRow["systemMessageKind"];
  systemMessageSubject: TimelineUserConversationRow["systemMessageSubject"];
  text: string;
  turnRequest: TimelineUserConversationRow["turnRequest"];
}

interface AssistantConversationMessageProps extends AssistantMessageRowIdentity {
  attachmentItems: ConversationAttachmentItems;
  onFork?: () => void;
  onSideChat?: () => void;
  onSendToMain?: () => void;
  forkDisabled?: boolean;
  onSelectProse?: (selection: MessageProseSelection | null) => void;
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  showActions: boolean;
  text: string;
  workspaceRootPath?: string;
}

interface CollapsibleMessageTextProps {
  mentions: readonly PromptTextMention[];
  resolveMentionLink?: PromptMentionLinkResolver;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  onOpenLink?: ThreadTimelineLinkHandler;
  text: string;
  /**
   * When set, the first `mutePrefixLength` characters of `text` are rendered
   * inside a muted, max-width-truncated pill — used for `[bb …]` prefixes on
   * system-initiated messages and non-user messages without sender metadata.
   */
  mutePrefixLength?: number;
}

function CollapsibleMessageText({
  mentions,
  resolveMentionLink,
  resolveSegmentLinkHref,
  onOpenLink,
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
  const bodyRef = useRef<HTMLDivElement>(null);
  // Cap before rendering so a megabyte paste can't dominate window-resize
  // reflow. Unlike the prior plain-text path we hand the whole capped body to
  // the markdown renderer and clamp it visually (markdown block content doesn't
  // line-clamp cleanly), rather than slicing it by line per collapse state.
  const isTruncated = bodyText.length > USER_MESSAGE_CHAR_CAP;
  const cappedBody = isTruncated
    ? bodyText.slice(0, USER_MESSAGE_CHAR_CAP)
    : bodyText;
  // Rebase mentions onto the prefix-stripped, char-capped body so their offsets
  // index into the exact string handed to the markdown renderer (a mention
  // straddling the cap is dropped, clipping the body to just before it).
  const body = useMemo(
    () =>
      clipMentionTextToVisibleRange({
        mentions,
        rangeStart: bodyOffset,
        text: cappedBody,
      }),
    [mentions, bodyOffset, cappedBody],
  );
  const promptMentions = useMemo<MarkdownPromptMentions>(
    () => ({
      mentions: body.mentions,
      resolveLinkHref: resolveSegmentLinkHref,
      resolveMentionLink,
    }),
    [body.mentions, resolveSegmentLinkHref, resolveMentionLink],
  );
  const linkRouting = useMemo<MarkdownLinkRouting | undefined>(
    () => (onOpenLink ? { onOpenLink } : undefined),
    [onOpenLink],
  );

  // Collapsed: clamp the rendered markdown to ~15 lines and reveal the toggle
  // when it overflows the clamp, measured off the container height (the source
  // line count no longer maps to rendered height once blocks have margins).
  const isOverflowing = useIsOverflowing({
    elementRef: bodyRef,
    enabled: !isExpanded,
    measurementKey: body.text,
  });
  const showToggle = isExpanded || isOverflowing;

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
      <div
        ref={bodyRef}
        className={cn(
          "break-words",
          !isExpanded && "max-h-[15lh] overflow-hidden",
        )}
        style={
          !isExpanded && showToggle ? COLLAPSED_MESSAGE_FADE_STYLE : undefined
        }
      >
        <MarkdownPreview
          content={body.text}
          promptMentions={promptMentions}
          linkRouting={linkRouting}
        />
        {isExpanded && isTruncated ? (
          <span className="text-muted-foreground">[truncated]</span>
        ) : null}
      </div>
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
  onAddToChat,
  onOpenLink,
  onOpenLocalFileLink,
  projectId,
  resolveMentionLink,
  resolveSegmentLinkHref,
  onTitleAction,
  senderThreadId,
  senderThreadTitle,
  senderChildOrigin,
  systemMessageKind,
  systemMessageSubject,
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
        onOpenLink={onOpenLink}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
        resolveMentionLink={resolveMentionLink}
        resolveSegmentLinkHref={resolveSegmentLinkHref}
        onTitleAction={onTitleAction}
        sourceKind="agent"
        sourceName={
          senderChildOrigin === "side-chat"
            ? "side chat"
            : (senderThreadTitle ?? "Agent")
        }
        sourceThreadId={senderThreadId}
        sourceIsSideChat={senderChildOrigin === "side-chat"}
        systemMessageKind={systemMessageKind}
        systemMessageSubject={systemMessageSubject}
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
        onOpenLink={onOpenLink}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
        resolveMentionLink={resolveMentionLink}
        resolveSegmentLinkHref={resolveSegmentLinkHref}
        onTitleAction={onTitleAction}
        sourceKind="system"
        sourceName="BB"
        sourceThreadId={null}
        sourceIsSideChat={false}
        systemMessageKind={systemMessageKind}
        systemMessageSubject={systemMessageSubject}
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
      <div className="group/message ml-auto w-fit max-w-[70%]">
        {requestLabel ? (
          <div className="mb-1 flex justify-end">
            <TurnRequestLabel
              turnRequest={turnRequest}
              icon="ArrowTurnForward"
            />
          </div>
        ) : null}
        <div className="rounded-xl border border-border-seam bg-surface-recessed px-4 py-2.5 text-sm leading-relaxed text-foreground">
          {messageText ? (
            <CollapsibleMessageText
              mentions={mentions}
              resolveMentionLink={resolveMentionLink}
              resolveSegmentLinkHref={resolveSegmentLinkHref}
              onOpenLink={onOpenLink}
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
            <MessageActionBar
              messageText={messageText}
              alignment="end"
              onAddToChat={onAddToChat}
            />
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
  onSendToMain,
  forkDisabled,
  onSelectProse,
  onOpenLink,
  onOpenLocalFileLink,
  projectId,
  showActions,
  text,
  workspaceRootPath,
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
      if (workspaceRootPath !== undefined) {
        routing.localFile.relativeLinks = {
          baseDir: workspaceRootPath,
          rootPath: workspaceRootPath,
        };
      }
    }
    return routing;
  }, [onOpenLink, onOpenLocalFileLink, workspaceRootPath]);

  return (
    <div className="group/message w-full px-2 text-sm font-normal leading-relaxed">
      {/*
        Reports in-bounds text selections up to the timeline-level controller
        that drives the single floating selection menu (Add to chat / Reply in
        side chat).
      */}
      <SelectableMessageProse onSelect={onSelectProse}>
        <MarkdownPreview content={text} linkRouting={linkRouting} />
      </SelectableMessageProse>
      <ConversationAttachments
        filePaths={attachmentItems.filePaths}
        imageItems={attachmentItems.imageItems}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
      />
      {showActions ? (
        /*
          Copy + fork (S3) + side chat (S4) actions. Each button is dropped
          entirely (not rendered disabled) when its handler is absent — e.g. fork
          is omitted for a personal-only source with no host to base a worktree
          fork on. `disabled` greys both fork and side chat together when the
          thread is at the spawn-depth cap (both spawn a child thread, one guard).
        */
        <div className="relative h-5">
          <div className="absolute left-0 top-1">
            <MessageActionBar
              messageText={text}
              alignment="start"
              onFork={onFork}
              onSideChat={onSideChat}
              onSendToMain={onSendToMain}
              disabled={forkDisabled}
            />
          </div>
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
        childOrigin={props.childOrigin}
        initiator={props.initiator}
        mentions={props.mentions}
        onAddToChat={props.onAddToChat}
        onOpenLink={props.onOpenLink}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
        resolveMentionLink={props.resolveMentionLink}
        resolveSegmentLinkHref={props.resolveSegmentLinkHref}
        onTitleAction={props.onTitleAction}
        senderThreadId={props.senderThreadId}
        senderThreadTitle={props.senderThreadTitle}
        senderChildOrigin={props.senderChildOrigin}
        systemMessageKind={props.systemMessageKind}
        systemMessageSubject={props.systemMessageSubject}
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
      onSendToMain={props.onSendToMain}
      forkDisabled={props.forkDisabled}
      onSelectProse={props.onSelectProse}
      onOpenLink={props.onOpenLink}
      onOpenLocalFileLink={onOpenLocalFileLink}
      projectId={projectId}
      showActions={props.showActions}
      sourceSeqEnd={props.sourceSeqEnd}
      sourceSeqStart={props.sourceSeqStart}
      text={text}
      threadId={props.threadId}
      turnId={props.turnId}
      workspaceRootPath={props.workspaceRootPath}
    />
  );
}
