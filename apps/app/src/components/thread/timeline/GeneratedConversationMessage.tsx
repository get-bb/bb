import { memo, useCallback, useMemo } from "react";
import type { TimelineUserConversationRow } from "@bb/server-contract";
import type { PromptTextMention, ThreadChildOrigin } from "@bb/domain";
import type { TimelineTitle, TimelineTitleSegment } from "@bb/thread-view";
import { type IconName } from "@/components/ui/icon.js";
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
import type { TimelineTitleLinkResolver } from "./TimelineTitleView.js";
import type { ThreadTimelineLocalFileLinkHandler } from "./types.js";
import { turnRequestLabel } from "./conversation-turn-request-label.js";
import { TurnRequestLabel } from "./TurnRequestLabel.js";

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
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  sourceKind: GeneratedConversationSourceKind;
  sourceName: string;
  sourceThreadId: string | null;
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
  sourceKind: GeneratedConversationSourceKind;
  sourceName: string;
  sourceThreadId: string | null;
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
  sourceKind,
  sourceName,
  sourceThreadId,
}: GeneratedConversationTitleArgs): TimelineTitle {
  const segments: TimelineTitleSegment[] =
    sourceKind === "agent"
      ? [
          timelineTitleSegment({
            em: false,
            link: null,
            shimmer: false,
            text: "Message from",
            truncate: false,
          }),
          timelineTitleSegment({
            em: true,
            link:
              sourceThreadId === null
                ? null
                : { kind: "thread", threadId: sourceThreadId },
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
    action: null,
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
    resolveSegmentLinkHref,
    sourceKind,
    sourceName,
    sourceThreadId,
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
          sourceKind,
          sourceName,
          sourceThreadId,
        }),
      [sourceKind, sourceName, sourceThreadId],
    );
    const leadingIcon = generatedConversationIconName(sourceKind, childOrigin);
    const hasExpandedOnlyContent =
      attachmentItems.filePaths.length > 0 ||
      attachmentItems.imageItems.length > 0 ||
      requestLabel !== null;
    const expandable =
      hasExpandedOnlyContent || messageText.length > 0;
    const collapsedPreviewLine = messageText.split(/\r\n|\r|\n/u, 1)[0] ?? "";
    const collapsedPreviewBody = clipMentionTextToVisibleRange({
      mentions: messageMentions,
      rangeStart: 0,
      text: collapsedPreviewLine,
    });
    const collapsedPreview = collapsedPreviewBody.text ? (
      <div className={NESTED_TIMELINE_GROUP_LINE_CLASS_NAME}>
        <p className="line-clamp-1 break-words pl-2 text-sm leading-relaxed text-foreground">
          {renderMentionTextSegments({
            mentions: collapsedPreviewBody.mentions,
            text: collapsedPreviewBody.text,
          })}
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
        renderBody={renderBody}
      />
    );
  },
);
