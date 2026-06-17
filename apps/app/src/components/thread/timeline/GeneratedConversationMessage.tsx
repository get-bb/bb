import { memo, useCallback, useMemo, useRef } from "react";
import type { TimelineUserConversationRow } from "@bb/server-contract";
import type { PromptTextMention, ThreadChildOrigin } from "@bb/domain";
import type { TimelineTitle, TimelineTitleSegment } from "@bb/thread-view";
import { type IconName } from "@/components/ui/icon.js";
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
import type { ThreadTimelineLocalFileLinkHandler } from "./types.js";
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
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  onTitleAction?: TimelineTitleActionResolver;
  sourceKind: GeneratedConversationSourceKind;
  sourceName: string;
  sourceThreadId: string | null;
  /** The source is a side chat: the linked name opens it as a tab in this
   * thread (a title action) rather than navigating to it as a standalone thread. */
  sourceIsSideChat: boolean;
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

function generatedConversationTitle({
  childOrigin,
  sourceKind,
  sourceName,
  sourceThreadId,
  sourceIsSideChat,
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
      : [
          timelineTitleSegment({
            em: false,
            link: null,
            shimmer: false,
            text: "System Message",
            truncate: true,
          }),
        ];

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

function generatedConversationIconName(
  sourceKind: GeneratedConversationSourceKind,
  childOrigin: ThreadChildOrigin | null,
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
      return "Info";
  }
}

export const GeneratedConversationMessage = memo(
  function GeneratedConversationMessage({
    attachmentItems,
    childOrigin,
    mentions,
    onOpenLocalFileLink,
    projectId,
    resolveMentionLink,
    resolveSegmentLinkHref,
    onTitleAction,
    sourceKind,
    sourceName,
    sourceThreadId,
    sourceIsSideChat,
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
    const title = useMemo(
      () =>
        generatedConversationTitle({
          childOrigin,
          sourceKind,
          sourceName,
          sourceThreadId,
          sourceIsSideChat,
        }),
      [childOrigin, sourceKind, sourceName, sourceThreadId, sourceIsSideChat],
    );
    const leadingIcon = generatedConversationIconName(sourceKind, childOrigin);
    const hasExpandedOnlyContent =
      attachmentItems.filePaths.length > 0 ||
      attachmentItems.imageItems.length > 0 ||
      requestLabel !== null;
    const collapsedPreviewLine = messageText.split(/\r\n|\r|\n/u, 1)[0] ?? "";
    const hasAdditionalBodyLines =
      collapsedPreviewLine.length < messageText.length;
    const collapsedPreviewTextRef = useRef<HTMLParagraphElement>(null);
    const collapsedPreviewOverflowMeasurement = useOverflowMeasurement({
      elementRef: collapsedPreviewTextRef,
      enabled: messageText.length > 0,
      measurementKey: messageText,
    });
    const expandable =
      hasExpandedOnlyContent ||
      hasAdditionalBodyLines ||
      collapsedPreviewOverflowMeasurement === "overflowing";
    const collapsedPreviewBody = clipMentionTextToVisibleRange({
      mentions: messageMentions,
      rangeStart: 0,
      text: collapsedPreviewLine,
    });
    const collapsedPreview = collapsedPreviewBody.text ? (
      <div
        className={`${NESTED_TIMELINE_GROUP_LINE_CLASS_NAME} max-w-full min-w-0`}
      >
        <p
          ref={collapsedPreviewTextRef}
          className="min-w-0 truncate pl-2 text-sm leading-relaxed text-foreground"
        >
          {renderMentionTextSegments({
            mentions: collapsedPreviewBody.mentions,
            resolveMentionLink,
            text: collapsedPreviewBody.text,
          })}
          {expandable ? (
            <span className="text-muted-foreground">...</span>
          ) : null}
        </p>
      </div>
    ) : null;
    const renderBody = useCallback(
      () => (
        <div className={NESTED_TIMELINE_GROUP_LINE_CLASS_NAME}>
          <div className="pl-2 text-sm leading-relaxed text-foreground">
            {messageText ? (
              <p className="whitespace-pre-wrap break-words">
                {renderMentionTextSegments({
                  mentions: messageMentions,
                  resolveMentionLink,
                  text: messageText,
                })}
              </p>
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
        messageText,
        messageMentions,
        onOpenLocalFileLink,
        projectId,
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
