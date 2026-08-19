import { useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  TimelineConversationAttachments,
  TimelineRowBase,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import type { PromptTextMention, ThreadOriginKind } from "@bb/domain";
import { fileNameFromPath } from "@bb/thread-view";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  MarkdownPreview,
  type MarkdownThreadMentions,
} from "../../ui/markdown-preview.js";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import {
  parseLocalFileHref,
  resolveRelativeLocalFileHref,
} from "@/components/ui/markdown-local-file-link.js";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { computeMutedPrefixLength } from "./compute-muted-prefix-length.js";
import type {
  TimelineTitleActionResolver,
  TimelineTitleLinkResolver,
} from "./TimelineTitleView.js";
import type {
  ThreadTimelineAddToChatHandler,
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
import {
  useMessageDirectiveRegistry,
  type MarkdownMessageDirectives,
} from "@/components/ui/markdown-message-directives.js";
import {
  boundedMarkdownPreview,
  closeUnterminatedMarkdownCodeSpan,
  USER_MESSAGE_CHAR_CAP,
} from "./conversation-message-limits.js";
import { turnRequestLabel } from "./conversation-turn-request-label.js";
import { splitStreamingMarkdown } from "./streaming-markdown-split.js";
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
import type { ThreadTimelinePluginMessageAction } from "./types.js";
import type { PromptDraftAttachment } from "@/lib/prompt-draft";
import { buildThreadHostFileContentUrl } from "@/lib/file-content-urls";

interface ConversationMessageContentBaseProps {
  attachments: TimelineConversationAttachments | null;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  onOpenPluginPanel?: MarkdownMessageDirectives["openThreadPanel"];
  /** Plugin-contributed per-message actions, resolved by the timeline root. */
  pluginActions?: readonly ThreadTimelinePluginMessageAction[];
  projectId?: string;
  resolveUserAttachmentImageSrc?: UserAttachmentImageSrcResolver;
  text: string;
}

export interface ConversationMessageContentUserProps extends ConversationMessageContentBaseProps {
  role: "user";
  /** Mobile presentation for the regular user message's action footer. */
  mobileActionDisplay?: "inline" | "overflow";
  /**
   * `originKind` of the thread this row belongs to. Selects the fork leading
   * icon when an agent-initiated thread-start anchor (a fork's seed-without-run
   * row) renders as "Message from {source}". Null for non-fork threads.
   */
  originKind: ThreadOriginKind | null;
  initiator: TimelineUserConversationRow["initiator"];
  mentions: readonly PromptTextMention[];
  onAddToChat?: ThreadTimelineAddToChatHandler;
  onEdit?: () => void;
  resolveMentionLink?: PromptMentionLinkResolver;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  onOpenLink?: ThreadTimelineLinkHandler;
  onTitleAction?: TimelineTitleActionResolver;
  senderThreadId: TimelineUserConversationRow["senderThreadId"];
  /** Present when sender metadata identifies the source thread's project. */
  senderThreadProjectId?: string;
  senderThreadTitle: string | null;
  /** The sender thread is one of the side-chat plugin's hidden forks, so the
   * row reads "Replying to side chat" and its name opens the plugin panel. */
  senderIsPluginSideChat: boolean;
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

const ASSISTANT_THREAD_MENTIONS: MarkdownThreadMentions = {
  mentions: [],
  preserveSoftBreaks: false,
};

// The settled prefix and live tail of a streaming message are two sibling
// markdown documents. Their block margins collapse across the wrapper
// boundary like siblings inside one document, except for the `last:mb-0` on a
// trailing paragraph and the `first:mt-0` on a leading heading, which would
// otherwise remove the gap at the seam and shift the layout when the finished
// message re-renders as one document. Restore those margins at the seam only.
const STREAMING_SETTLED_MARKDOWN_CLASS_NAME = "[&>p:last-child]:mb-2";
const STREAMING_TAIL_MARKDOWN_CLASS_NAME =
  "[&>h1:first-child]:mt-4 [&>h2:first-child]:mt-4 [&>h3:first-child]:mt-3 [&>h4:first-child]:mt-3 [&>h5:first-child]:mt-2 [&>h6:first-child]:mt-2";

export interface ConversationMessageContentAssistantProps
  extends ConversationMessageContentBaseProps, AssistantMessageRowIdentity {
  role: "assistant";
  // Assistant content and generated system rows render through MarkdownPreview,
  // which is the only message body surface with clickable web links.
  onOpenLink?: ThreadTimelineLinkHandler;
  /** Add this complete agent response to the active composer draft. */
  onAddToChat?: ThreadTimelineAddToChatHandler;
  /**
   * Fork the active thread from this agent message. Omitted when forking is
   * unavailable (no host) — the action bar then renders without a Fork button.
   */
  onFork?: () => void;
  /**
   * Open a side chat anchored on this agent message. Omitted when side chats are
   * unavailable (no host secondary panel) — the bar then renders without it.
   */
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
  /** Shows the hover-revealed message action footer. */
  showActions: boolean;
  /** Mobile presentation for this message's action footer. */
  mobileActionDisplay: "inline" | "overflow";
  /**
   * The message is still receiving text deltas. The body then renders as a
   * settled prefix plus a live tail (two memoized markdown documents) so each
   * delta re-parses only the tail. A completed message renders one document.
   */
  streaming: boolean;
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
  addToChatAttachments: readonly PromptDraftAttachment[];
  attachmentItems: ConversationAttachmentItems;
  originKind: ThreadOriginKind | null;
  pluginActions?: readonly ThreadTimelinePluginMessageAction[];
  initiator: TimelineUserConversationRow["initiator"];
  mentions: readonly PromptTextMention[];
  mobileActionDisplay: "inline" | "overflow";
  onAddToChat?: ThreadTimelineAddToChatHandler;
  onEdit?: () => void;
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  onTitleAction?: TimelineTitleActionResolver;
  senderThreadId: TimelineUserConversationRow["senderThreadId"];
  senderThreadProjectId: string | null;
  senderThreadTitle: string | null;
  senderIsPluginSideChat: boolean;
  systemMessageKind: TimelineUserConversationRow["systemMessageKind"];
  systemMessageSubject: TimelineUserConversationRow["systemMessageSubject"];
  text: string;
  turnRequest: TimelineUserConversationRow["turnRequest"];
}

interface AssistantConversationMessageProps extends AssistantMessageRowIdentity {
  addToChatAttachments: readonly PromptDraftAttachment[];
  attachmentItems: ConversationAttachmentItems;
  pluginActions?: readonly ThreadTimelinePluginMessageAction[];
  onAddToChat?: ThreadTimelineAddToChatHandler;
  onFork?: () => void;
  onSendToMain?: () => void;
  forkDisabled?: boolean;
  onSelectProse?: (selection: MessageProseSelection | null) => void;
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  onOpenPluginPanel?: MarkdownMessageDirectives["openThreadPanel"];
  projectId?: string;
  showActions: boolean;
  mobileActionDisplay: "inline" | "overflow";
  streaming: boolean;
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
  // Keep collapsed previews bounded so a megabyte paste cannot dominate the
  // initial timeline render. Expanding is an explicit request for the complete
  // message, so only then hand the full body to the markdown renderer.
  const exceedsCollapsedRenderCap = bodyText.length > USER_MESSAGE_CHAR_CAP;
  const collapsedPreview =
    !isExpanded && exceedsCollapsedRenderCap
      ? boundedMarkdownPreview(bodyText, USER_MESSAGE_CHAR_CAP)
      : null;
  const renderedBodyText = collapsedPreview?.text ?? bodyText;
  // Rebase mentions onto the prefix-stripped body currently being rendered. A
  // mention straddling the collapsed cap is omitted from the preview and
  // restored when the complete body is rendered after expansion.
  const body = useMemo(
    () =>
      clipMentionTextToVisibleRange({
        mentions,
        rangeStart: bodyOffset,
        text: renderedBodyText,
      }),
    [mentions, bodyOffset, renderedBodyText],
  );
  const promptMentions = useMemo<MarkdownPromptMentions>(
    () => ({
      mentions: body.mentions,
      resolveLinkHref: resolveSegmentLinkHref,
      resolveMentionLink,
    }),
    [body.mentions, resolveSegmentLinkHref, resolveMentionLink],
  );
  const rawThreadMentions = useMemo<MarkdownThreadMentions>(
    () => ({
      mentions: body.mentions,
      preserveSoftBreaks: true,
    }),
    [body.mentions],
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
  const showToggle = isExpanded || exceedsCollapsedRenderCap || isOverflowing;

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
        {collapsedPreview?.parseAsMarkdown === false ? (
          <span>{body.text}</span>
        ) : (
          <MarkdownPreview
            content={
              collapsedPreview?.wasCapped === true
                ? closeUnterminatedMarkdownCodeSpan(body.text)
                : body.text
            }
            promptMentions={promptMentions}
            threadMentions={rawThreadMentions}
            linkRouting={linkRouting}
          />
        )}
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

function buildAddToChatAttachments(
  attachments: TimelineConversationAttachments | null,
): PromptDraftAttachment[] {
  if (!attachments) {
    return [];
  }

  return [
    ...attachments.localImagePaths.map((path) => ({
      type: "localImage" as const,
      path,
      name: fileNameFromPath(path),
      sizeBytes: 0,
    })),
    ...attachments.localFilePaths.map((path) => ({
      type: "localFile" as const,
      path,
      name: fileNameFromPath(path),
      sizeBytes: 0,
    })),
  ];
}

function UserConversationMessage({
  addToChatAttachments,
  attachmentItems,
  originKind,
  initiator,
  mentions,
  mobileActionDisplay,
  onAddToChat,
  onEdit,
  onOpenLink,
  onOpenLocalFileLink,
  pluginActions = [],
  projectId,
  resolveMentionLink,
  resolveSegmentLinkHref,
  onTitleAction,
  senderThreadId,
  senderThreadProjectId,
  senderThreadTitle,
  senderIsPluginSideChat,
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
        originKind={originKind}
        mentions={bodyMentions}
        onOpenLink={onOpenLink}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
        resolveMentionLink={resolveMentionLink}
        resolveSegmentLinkHref={resolveSegmentLinkHref}
        onTitleAction={onTitleAction}
        sourceKind="agent"
        sourceName={
          senderIsPluginSideChat ? "side chat" : (senderThreadTitle ?? "Agent")
        }
        sourceProjectId={senderThreadProjectId}
        sourceThreadId={senderThreadId}
        sourceIsPluginSideChat={senderIsPluginSideChat}
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
        originKind={null}
        mentions={bodyMentions}
        onOpenLink={onOpenLink}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
        resolveMentionLink={resolveMentionLink}
        resolveSegmentLinkHref={resolveSegmentLinkHref}
        onTitleAction={onTitleAction}
        sourceKind="system"
        sourceName="BB"
        sourceProjectId={null}
        sourceThreadId={null}
        sourceIsPluginSideChat={false}
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
        {/*
          The bar sits in normal flow: it is hidden by opacity, so it occupies
          its own height whether or not it is revealed, and it renders nothing
          at all when the message has no action. `MessageActionBar` is the one
          place that decides which of those two cases holds.
        */}
        <MessageActionBar
          messageText={messageText}
          alignment="end"
          mobileActionDisplay={mobileActionDisplay}
          addToChatAttachments={addToChatAttachments}
          onAddToChat={onAddToChat}
          onEdit={onEdit}
          pluginActions={pluginActions}
        />
      </div>
    </div>
  );
}

function AssistantConversationMessage({
  addToChatAttachments,
  attachmentItems,
  id,
  onAddToChat,
  onFork,
  onSendToMain,
  forkDisabled,
  onSelectProse,
  onOpenLink,
  onOpenLocalFileLink,
  onOpenPluginPanel,
  pluginActions,
  projectId,
  showActions,
  mobileActionDisplay,
  streaming,
  text,
  threadId,
  turnId,
  workspaceRootPath,
}: AssistantConversationMessageProps) {
  // While streaming, everything before the last safe blank line is settled and
  // keeps its memoized render; only the tail document re-parses per delta.
  const streamingSplit = useMemo(
    () => (streaming ? splitStreamingMarkdown(text) : null),
    [streaming, text],
  );
  const linkRouting = useMemo<MarkdownLinkRouting>(() => {
    const localImage: NonNullable<MarkdownLinkRouting["localImage"]> = {
      absolutePaths: {
        kind: "trusted-host",
      },
      resolveSrc: ({ path }) => buildThreadHostFileContentUrl(threadId, path),
    };
    const routing: MarkdownLinkRouting = {
      localImage,
    };
    if (workspaceRootPath !== undefined) {
      localImage.relativePaths = {
        baseDir: workspaceRootPath,
        rootPath: workspaceRootPath,
      };
    }
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
  }, [onOpenLink, onOpenLocalFileLink, threadId, workspaceRootPath]);

  // Registry is subscribed once at the timeline root and provided via context;
  // only assistant (and nested delegation) bodies activate plugin directives.
  const messageDirectiveRegistry = useMessageDirectiveRegistry();
  const openDirectiveWorkspaceFile = useMemo<
    MarkdownMessageDirectives["openWorkspaceFile"]
  >(() => {
    if (onOpenLocalFileLink === undefined || workspaceRootPath === undefined) {
      return null;
    }

    return (path) => {
      const href = resolveRelativeLocalFileHref({
        baseDir: workspaceRootPath,
        href: path,
        rootPath: workspaceRootPath,
      });
      if (href === null) {
        return false;
      }
      const link = parseLocalFileHref({
        absoluteLinks: { kind: "contained", rootPath: workspaceRootPath },
        href,
      });
      return link === null ? false : onOpenLocalFileLink(link);
    };
  }, [onOpenLocalFileLink, workspaceRootPath]);
  const messageDirectives = useMemo<
    MarkdownMessageDirectives | undefined
  >(() => {
    if (
      messageDirectiveRegistry === null ||
      messageDirectiveRegistry.size === 0
    ) {
      return undefined;
    }
    return {
      registry: messageDirectiveRegistry,
      message: {
        id,
        threadId,
        turnId,
        projectId: projectId ?? null,
      },
      openWorkspaceFile: openDirectiveWorkspaceFile,
      openThreadPanel: onOpenPluginPanel ?? null,
    };
  }, [
    messageDirectiveRegistry,
    id,
    threadId,
    turnId,
    projectId,
    openDirectiveWorkspaceFile,
    onOpenPluginPanel,
  ]);

  return (
    <div className="group/message w-full px-2 text-sm font-normal leading-relaxed">
      {/*
        Reports in-bounds text selections up to the timeline-level controller
        that drives the single floating selection menu (Add to chat / Reply in
        side chat).
      */}
      <SelectableMessageProse onSelect={onSelectProse}>
        <MarkdownPreview
          className={
            streamingSplit === null
              ? undefined
              : STREAMING_SETTLED_MARKDOWN_CLASS_NAME
          }
          content={streamingSplit === null ? text : streamingSplit.settled}
          linkRouting={linkRouting}
          messageDirectives={messageDirectives}
          threadMentions={ASSISTANT_THREAD_MENTIONS}
        />
        {streamingSplit === null ? null : (
          <MarkdownPreview
            className={STREAMING_TAIL_MARKDOWN_CLASS_NAME}
            content={streamingSplit.tail}
            linkRouting={linkRouting}
            messageDirectives={messageDirectives}
            threadMentions={ASSISTANT_THREAD_MENTIONS}
          />
        )}
      </SelectableMessageProse>
      <ConversationAttachments
        filePaths={attachmentItems.filePaths}
        imageItems={attachmentItems.imageItems}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
      />
      {showActions ? (
        /*
          Message actions. Each button is dropped entirely (not rendered
          disabled) when its handler is absent — e.g. fork is omitted for a
          personal-only source with no host to base a worktree fork on.
          `disabled` greys both fork and side chat together when the thread is at
          the spawn-depth cap (both spawn a child thread, one guard).
        */
        <MessageActionBar
          messageText={text}
          alignment="start"
          mobileActionDisplay={mobileActionDisplay}
          addToChatAttachments={addToChatAttachments}
          onAddToChat={onAddToChat}
          onFork={onFork}
          onSendToMain={onSendToMain}
          disabled={forkDisabled}
          pluginActions={pluginActions}
        />
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
    onOpenPluginPanel,
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
  const addToChatAttachments = useMemo(
    () => buildAddToChatAttachments(attachments),
    [attachments],
  );

  if (props.role === "user") {
    return (
      <UserConversationMessage
        addToChatAttachments={addToChatAttachments}
        attachmentItems={attachmentItems}
        originKind={props.originKind}
        pluginActions={props.pluginActions}
        initiator={props.initiator}
        mentions={props.mentions}
        mobileActionDisplay={props.mobileActionDisplay ?? "overflow"}
        onAddToChat={props.onAddToChat}
        onEdit={props.onEdit}
        onOpenLink={props.onOpenLink}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
        resolveMentionLink={props.resolveMentionLink}
        resolveSegmentLinkHref={props.resolveSegmentLinkHref}
        onTitleAction={props.onTitleAction}
        senderThreadId={props.senderThreadId}
        senderThreadProjectId={props.senderThreadProjectId ?? null}
        senderThreadTitle={props.senderThreadTitle}
        senderIsPluginSideChat={props.senderIsPluginSideChat}
        systemMessageKind={props.systemMessageKind}
        systemMessageSubject={props.systemMessageSubject}
        text={text}
        turnRequest={props.turnRequest}
      />
    );
  }

  return (
    <AssistantConversationMessage
      addToChatAttachments={addToChatAttachments}
      attachmentItems={attachmentItems}
      id={props.id}
      pluginActions={props.pluginActions}
      onAddToChat={props.onAddToChat}
      onFork={props.onFork}
      onSendToMain={props.onSendToMain}
      forkDisabled={props.forkDisabled}
      onSelectProse={props.onSelectProse}
      onOpenLink={props.onOpenLink}
      onOpenLocalFileLink={onOpenLocalFileLink}
      onOpenPluginPanel={onOpenPluginPanel}
      projectId={projectId}
      showActions={props.showActions}
      mobileActionDisplay={props.mobileActionDisplay}
      streaming={props.streaming}
      sourceSeqEnd={props.sourceSeqEnd}
      sourceSeqStart={props.sourceSeqStart}
      text={text}
      threadId={props.threadId}
      turnId={props.turnId}
      workspaceRootPath={props.workspaceRootPath}
    />
  );
}
