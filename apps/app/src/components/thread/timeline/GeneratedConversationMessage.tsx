import { memo, useCallback, useMemo, useRef } from "react";
import type { TimelineUserConversationRow } from "@bb/server-contract";
import type {
  PromptTextMention,
  SystemMessageKind,
  SystemMessageSubject,
  ThreadChildOrigin,
} from "@bb/domain";
import type { TimelineTitle, TimelineTitleSegment } from "@bb/thread-view";
import { type IconName } from "@bb/shared-ui/icon";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import {
  ConversationAttachments,
  type ConversationAttachmentItems,
} from "./ConversationAttachments.js";
import { computeMutedPrefixLength } from "./compute-muted-prefix-length.js";
import {
  clipMentionTextToVisibleRange,
  renderMentionTextSegments,
  shiftMentionsToTextRange,
} from "./ConversationMessageMentions.js";
import { ExpandableTimelineRow } from "./ExpandableTimelineRow.js";
import { NESTED_TIMELINE_GROUP_LINE_CLASS_NAME } from "./timeline-nested-group-line.js";
import type {
  TimelineTitleActionResolver,
  TimelineTitleLinkResolver,
} from "./TimelineTitleView.js";
import type {
  ThreadTimelineLinkHandler,
  ThreadTimelineLocalFileLinkHandler,
} from "./types.js";
import { turnRequestLabel } from "./conversation-turn-request-label.js";
import { TurnRequestLabel } from "./TurnRequestLabel.js";
import { useOverflowMeasurement } from "./conversation-message-overflow.js";

interface GeneratedConversationMessageProps {
  attachmentItems: ConversationAttachmentItems;
  /**
   * `childOrigin` of the thread this generated row belongs to. A fork's
   * seed-without-run anchor (`"fork"`) renders the Fork leading icon for
   * consistency with the Fork action; otherwise the per-`sourceKind` icon.
   */
  childOrigin: ThreadChildOrigin | null;
  mentions: readonly PromptTextMention[];
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  onTitleAction?: TimelineTitleActionResolver;
  // `system` rows specialize their title/icon on `systemMessageKind` +
  // `systemMessageSubject`; `agent` rows specialize on `sourceName` +
  // `sourceThreadId`. Both groups are always supplied — the inactive group is
  // ignored by the source-kind switch — so the props stay non-optional.
  sourceKind: GeneratedConversationSourceKind;
  sourceName: string;
  sourceThreadId: string | null;
  /** The source is a side chat: the linked name opens it as a tab in this
   * thread (a title action) rather than navigating to it as a standalone thread. */
  sourceIsSideChat: boolean;
  systemMessageKind: SystemMessageKind;
  systemMessageSubject: SystemMessageSubject | null;
  text: string;
  turnRequest: TimelineUserConversationRow["turnRequest"];
}

type GeneratedConversationSourceKind = "agent" | "system";

interface GeneratedConversationBodyTextArgs {
  initiator: TimelineUserConversationRow["initiator"];
  text: string;
}

interface GeneratedConversationBodySlice {
  startOffset: number;
  text: string;
}

interface TimelineTitleSegmentArgs {
  em: boolean;
  link: TimelineTitleSegment["link"] | null;
  shimmer: boolean;
  text: string;
  truncate: boolean;
}

interface GeneratedConversationTitleArgs {
  childOrigin: ThreadChildOrigin | null;
  sourceKind: GeneratedConversationSourceKind;
  sourceName: string;
  sourceThreadId: string | null;
  sourceIsSideChat: boolean;
  systemMessageKind: SystemMessageKind;
  systemMessageSubject: SystemMessageSubject | null;
}

export function generatedConversationBodySlice({
  initiator,
  text,
}: GeneratedConversationBodyTextArgs): GeneratedConversationBodySlice {
  const prefixLength = computeMutedPrefixLength(initiator, text);
  if (prefixLength <= 0) {
    return { startOffset: 0, text };
  }

  const textAfterPrefix = text.slice(prefixLength);
  const trimStartLength =
    textAfterPrefix.length - textAfterPrefix.trimStart().length;
  return {
    startOffset: prefixLength + trimStartLength,
    text: textAfterPrefix.slice(trimStartLength),
  };
}

function timelineTitleSegment({
  em,
  link,
  shimmer,
  text,
  truncate,
}: TimelineTitleSegmentArgs): TimelineTitleSegment {
  const segment: TimelineTitleSegment = {
    em,
    shimmer,
    text,
    truncate,
  };
  if (link !== null) {
    segment.link = link;
  }
  return segment;
}

// A muted verb segment ("finished", "assigned to you", …) — the non-emphasized
// connective text that frames the linked subject.
function verbSegment(text: string): TimelineTitleSegment {
  return timelineTitleSegment({
    em: false,
    link: null,
    shimmer: false,
    text,
    truncate: false,
  });
}

// The emphasized subject segment: a thread name links to its thread; an
// unlinkable subject (missing id) renders emphasized but plain.
function subjectSegment(
  text: string,
  threadId: string | null,
): TimelineTitleSegment {
  return timelineTitleSegment({
    em: true,
    link: threadId === null ? null : { kind: "thread", threadId },
    shimmer: false,
    text,
    truncate: true,
  });
}

const SYSTEM_MESSAGE_FALLBACK_SEGMENTS: TimelineTitleSegment[] = [
  timelineTitleSegment({
    em: false,
    link: null,
    shimmer: false,
    text: "System Message",
    truncate: true,
  }),
];

// A `thread`-subject verb title: `[name]` (linked) followed by the verb phrase.
// Falls back to the generic "System Message" title when the row's subject shape
// does not match the kind (defensive — should not happen for stamped rows).
function threadSubjectTitleSegments(
  subject: SystemMessageSubject | null,
  verb: string,
): TimelineTitleSegment[] {
  if (subject === null || subject.kind !== "thread") {
    return SYSTEM_MESSAGE_FALLBACK_SEGMENTS;
  }
  return [
    subjectSegment(subject.threadName, subject.threadId),
    verbSegment(verb),
  ];
}

function systemMessageTitleSegments(
  systemMessageKind: SystemMessageKind,
  subject: SystemMessageSubject | null,
): TimelineTitleSegment[] {
  switch (systemMessageKind) {
    case "ownership-assigned":
      return threadSubjectTitleSegments(subject, "assigned to you");
    case "ownership-removed":
      return threadSubjectTitleSegments(subject, "unassigned");
    case "child-needs-attention":
      return threadSubjectTitleSegments(subject, "needs attention");
    case "child-completed":
      return threadSubjectTitleSegments(subject, "finished");
    case "child-failed":
      return threadSubjectTitleSegments(subject, "failed");
    case "child-interrupted":
      return threadSubjectTitleSegments(subject, "was interrupted");
    case "child-outcome-batch":
      return subject !== null && subject.kind === "thread-batch"
        ? [verbSegment(`${subject.count} threads updated`)]
        : SYSTEM_MESSAGE_FALLBACK_SEGMENTS;
    case "unlabeled":
      return SYSTEM_MESSAGE_FALLBACK_SEGMENTS;
  }
}

export function generatedConversationTitle({
  childOrigin,
  sourceKind,
  sourceName,
  sourceThreadId,
  sourceIsSideChat,
  systemMessageKind,
  systemMessageSubject,
}: GeneratedConversationTitleArgs): TimelineTitle {
  // The lead-in names the relationship to the source: a fork branched from it
  // ("Forked from"), a side chat is replying to it ("Replying to"); any other
  // agent-initiated message keeps the neutral "Message from".
  const agentLeadIn =
    childOrigin === "fork"
      ? "Forked from"
      : childOrigin === "side-chat"
        ? "Replying to"
        : "Message from";
  // A side-chat source opens as a tab in this thread (a title action), so its
  // name carries no route link; other sources navigate to the source thread.
  const sideChatAction =
    sourceIsSideChat && sourceThreadId !== null
      ? ({ kind: "open-side-chat", threadId: sourceThreadId } as const)
      : null;
  const sourceLink =
    sourceThreadId === null || sideChatAction !== null
      ? null
      : ({ kind: "thread", threadId: sourceThreadId } as const);
  const segments: TimelineTitleSegment[] =
    sourceKind === "agent"
      ? [
          timelineTitleSegment({
            em: false,
            link: null,
            shimmer: false,
            text: agentLeadIn,
            truncate: false,
          }),
          timelineTitleSegment({
            em: true,
            link: sourceLink,
            shimmer: false,
            text: sourceName,
            truncate: true,
          }),
        ]
      : systemMessageTitleSegments(systemMessageKind, systemMessageSubject);

  return {
    action: sideChatAction,
    decorations: [],
    plain: segments
      .map((segment) => segment.plainText ?? segment.text)
      .join(" "),
    segments,
    tone: "default",
  };
}

function generatedConversationEmptyText(
  sourceKind: GeneratedConversationSourceKind,
): string {
  switch (sourceKind) {
    case "agent":
      return "Sent an agent message";
    case "system":
      return "Sent a BB system message";
  }
}

export function systemMessageIconName(
  systemMessageKind: SystemMessageKind,
): IconName {
  switch (systemMessageKind) {
    case "ownership-assigned":
      return "UserRoundPlus";
    case "ownership-removed":
      return "UserRound";
    case "child-needs-attention":
      return "AlertTriangle";
    case "child-completed":
      return "CircleCheck";
    case "child-failed":
      return "CircleX";
    case "child-interrupted":
      return "AlertCircle";
    case "child-outcome-batch":
      return "ListTodo";
    case "unlabeled":
      return "Info";
  }
}

function generatedConversationIconName(
  sourceKind: GeneratedConversationSourceKind,
  childOrigin: ThreadChildOrigin | null,
  systemMessageKind: SystemMessageKind,
): IconName {
  // A fork's anchor uses the Fork icon (matching the Fork action) regardless of
  // source kind; in practice fork anchors are always agent-initiated.
  if (childOrigin === "fork") {
    return "Fork";
  }
  switch (sourceKind) {
    case "agent":
      return "MessageSquare";
    case "system":
      return systemMessageIconName(systemMessageKind);
  }
}

// True only for the ownership kinds, whose one-line body restates the granular
// title verbatim. Those rows render title-only (no body, no preview,
// non-expandable); every other kind keeps its information-bearing body.
function systemMessageIsTitleOnly(
  sourceKind: GeneratedConversationSourceKind,
  systemMessageKind: SystemMessageKind,
): boolean {
  if (sourceKind !== "system") {
    return false;
  }
  return (
    systemMessageKind === "ownership-assigned" ||
    systemMessageKind === "ownership-removed"
  );
}

// Flattens the markdown collapsed-preview to a single inline line: block nodes
// (paragraphs, headings, lists, code) lose their margins/sizing and render
// inline so the row stays one truncated line while still showing inline
// formatting (bold, code, links) and @thread pills.
const COLLAPSED_MARKDOWN_PREVIEW_CLASS = cn(
  "[&_p]:!m-0 [&_p]:inline",
  "[&_ul]:!m-0 [&_ol]:!m-0 [&_ul]:!pl-0 [&_ol]:!pl-0 [&_li]:!m-0 [&_li]:inline",
  "[&_h1]:!m-0 [&_h2]:!m-0 [&_h3]:!m-0 [&_h4]:!m-0",
  "[&_h1]:inline [&_h2]:inline [&_h3]:inline [&_h4]:inline",
  "[&_h1]:!text-sm [&_h2]:!text-sm [&_h3]:!text-sm [&_h4]:!text-sm",
  "[&_pre]:!m-0 [&_pre]:!inline [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!border-0",
  "[&_blockquote]:!m-0 [&_blockquote]:inline [&_blockquote]:!border-0 [&_blockquote]:!pl-0",
);

export const GeneratedConversationMessage = memo(
  function GeneratedConversationMessage({
    attachmentItems,
    childOrigin,
    mentions,
    onOpenLink,
    onOpenLocalFileLink,
    projectId,
    resolveMentionLink,
    resolveSegmentLinkHref,
    onTitleAction,
    sourceKind,
    sourceName,
    sourceThreadId,
    sourceIsSideChat,
    systemMessageKind,
    systemMessageSubject,
    text,
    turnRequest,
  }: GeneratedConversationMessageProps) {
    const trimStartLength = text.length - text.trimStart().length;
    const messageText = text.trim();
    const messageMentions = useMemo(
      () =>
        shiftMentionsToTextRange({
          mentions,
          rangeStart: trimStartLength,
          rangeEnd: trimStartLength + messageText.length,
        }),
      [mentions, messageText.length, trimStartLength],
    );
    const requestLabel = turnRequestLabel(turnRequest);
    const linkRouting = useMemo<MarkdownLinkRouting | undefined>(() => {
      return onOpenLink === undefined ? undefined : { onOpenLink };
    }, [onOpenLink]);
    const title = useMemo(
      () =>
        generatedConversationTitle({
          childOrigin,
          sourceKind,
          sourceName,
          sourceThreadId,
          sourceIsSideChat,
          systemMessageKind,
          systemMessageSubject,
        }),
      [
        childOrigin,
        sourceKind,
        sourceName,
        sourceThreadId,
        sourceIsSideChat,
        systemMessageKind,
        systemMessageSubject,
      ],
    );
    const leadingIcon = generatedConversationIconName(
      sourceKind,
      childOrigin,
      systemMessageKind,
    );
    // Title-only rows (ownership assigned/removed) restate their body in the
    // title; suppress the body, the collapsed preview, and expansion entirely.
    const titleOnly = systemMessageIsTitleOnly(sourceKind, systemMessageKind);
    const hasExpandedOnlyContent =
      attachmentItems.filePaths.length > 0 ||
      attachmentItems.imageItems.length > 0 ||
      requestLabel !== null;
    const collapsedPreviewLine = messageText.split(/\r\n|\r|\n/u, 1)[0] ?? "";
    const hasAdditionalBodyLines =
      collapsedPreviewLine.length < messageText.length;
    const collapsedPreviewTextRef = useRef<HTMLElement | null>(null);
    const setCollapsedPreviewTextRef = useCallback(
      (element: HTMLElement | null) => {
        collapsedPreviewTextRef.current = element;
      },
      [],
    );
    const collapsedPreviewOverflowMeasurement = useOverflowMeasurement({
      elementRef: collapsedPreviewTextRef,
      enabled: !titleOnly && messageText.length > 0,
      measurementKey: messageText,
    });
    const expandable =
      !titleOnly &&
      (hasExpandedOnlyContent ||
        hasAdditionalBodyLines ||
        collapsedPreviewOverflowMeasurement === "overflowing");
    const showManualContinuation =
      expandable && collapsedPreviewOverflowMeasurement !== "overflowing";
    const collapsedPreviewBody = clipMentionTextToVisibleRange({
      mentions: messageMentions,
      rangeStart: 0,
      text: collapsedPreviewLine,
    });
    const collapsedPreview = !titleOnly && collapsedPreviewBody.text ? (
      <div
        className={`${NESTED_TIMELINE_GROUP_LINE_CLASS_NAME} max-w-full min-w-0`}
      >
        <div className="flex min-w-0 items-baseline truncate pl-2 text-sm leading-relaxed text-foreground">
          {sourceKind === "system" ? (
            // Render the collapsed first line as markdown too (inline
            // formatting + @thread pills), clamped to a single line, so a
            // not-yet-expanded system message shows formatted text rather than
            // raw markdown. Block nodes are flattened to inline via
            // COLLAPSED_MARKDOWN_PREVIEW_CLASS.
            <div
              ref={setCollapsedPreviewTextRef}
              className="min-w-0 truncate"
            >
              <MarkdownPreview
                content={collapsedPreviewLine}
                linkRouting={linkRouting}
                threadMentions={
                  resolveSegmentLinkHref
                    ? {
                        mentions: collapsedPreviewBody.mentions,
                        resolveLinkHref: resolveSegmentLinkHref,
                      }
                    : undefined
                }
                className={COLLAPSED_MARKDOWN_PREVIEW_CLASS}
              />
            </div>
          ) : (
            <span ref={setCollapsedPreviewTextRef} className="min-w-0 truncate">
              {renderMentionTextSegments({
                mentions: collapsedPreviewBody.mentions,
                resolveMentionLink,
                text: collapsedPreviewBody.text,
              })}
            </span>
          )}
          {showManualContinuation ? (
            <span className="shrink-0 text-muted-foreground">...</span>
          ) : null}
        </div>
      </div>
    ) : null;
    const renderBody = useCallback(
      () => (
        <div className={NESTED_TIMELINE_GROUP_LINE_CLASS_NAME}>
          <div className="pl-2 text-sm leading-relaxed text-foreground">
            {messageText ? (
              // `system` bodies render full markdown while preserving the
              // `@thread:<id>` mention pills (resolved from `messageMentions`).
              // `agent` bodies stay on the offset-based `renderMentionTextSegments`
              // renderer: the markdown path only understands `@thread:<id>`
              // tokens and would silently drop the offset-based `path` mentions
              // an agent message can carry. The collapsed preview above stays
              // plain text for both. Both branches share the surrounding
              // `pl-2 text-sm leading-relaxed text-foreground` container, so
              // typography is identical.
              sourceKind === "system" ? (
                <MarkdownPreview
                  content={messageText}
                  linkRouting={linkRouting}
                  threadMentions={
                    resolveSegmentLinkHref
                      ? {
                          mentions: messageMentions,
                          resolveLinkHref: resolveSegmentLinkHref,
                        }
                      : undefined
                  }
                />
              ) : (
                <p className="whitespace-pre-wrap break-words">
                  {renderMentionTextSegments({
                    mentions: messageMentions,
                    resolveMentionLink,
                    text: messageText,
                  })}
                </p>
              )
            ) : (
              <p className="text-muted-foreground">
                {generatedConversationEmptyText(sourceKind)}
              </p>
            )}
            <ConversationAttachments
              align="start"
              filePaths={attachmentItems.filePaths}
              imageItems={attachmentItems.imageItems}
              onOpenLocalFileLink={onOpenLocalFileLink}
              projectId={projectId}
            />
            {requestLabel ? (
              <div className="mt-1 flex items-center justify-start gap-2">
                <TurnRequestLabel turnRequest={turnRequest} />
              </div>
            ) : null}
          </div>
        </div>
      ),
      [
        attachmentItems.filePaths,
        attachmentItems.imageItems,
        linkRouting,
        messageText,
        messageMentions,
        onOpenLocalFileLink,
        projectId,
        resolveSegmentLinkHref,
        resolveMentionLink,
        sourceKind,
        requestLabel,
        turnRequest,
      ],
    );

    return (
      <ExpandableTimelineRow
        title={title}
        collapsedPreview={collapsedPreview}
        expandable={expandable}
        leadingIcon={leadingIcon}
        resolveSegmentLinkHref={resolveSegmentLinkHref}
        onTitleAction={onTitleAction}
        renderBody={renderBody}
      />
    );
  },
);
