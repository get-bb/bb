import {
  memo,
  useCallback,
  useMemo,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { generatePath } from "react-router-dom";
import type { TimelineUserConversationRow } from "@bb/server-contract";
import type {
  PromptTextMention,
  SystemMessageKind,
  SystemMessageSubject,
  ThreadOriginKind,
} from "@bb/domain";
import type { TimelineTitle, TimelineTitleSegment } from "@bb/thread-view";
import { type IconName } from "@bb/shared-ui/icon";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import { RouteAnchor } from "@/components/ui/app-route-anchor.js";
import { AUTOMATION_DETAIL_ROUTE_PATH } from "@/lib/route-paths";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import { buildMarkdownMessageLinkRouting } from "@/components/ui/markdown-message-link-routing";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import {
  ConversationAttachments,
  type ConversationAttachmentItems,
} from "./ConversationAttachments.js";
import { computeMutedPrefixLength } from "@bb/client-core";
import {
  clipMentionTextToVisibleRange,
  shiftMentionsToTextRange,
} from "./ConversationMessageMentions.js";
import { ExpandableTimelineRow } from "./ExpandableTimelineRow.js";
import { NESTED_TIMELINE_GROUP_LINE_CLASS_NAME } from "./timeline-nested-group-line.js";
import type { TimelineTitleActionResolver } from "./TimelineTitleView.js";
import type {
  ThreadTimelineLinkHandler,
  ThreadTimelineLocalFileLinkHandler,
} from "./types.js";
import { turnRequestLabel } from "@bb/client-core";
import { TurnRequestLabel } from "./TurnRequestLabel.js";
import { formatShortMessageTime } from "./MessageActionBar.js";
import { useOverflowMeasurement } from "./conversation-message-overflow.js";
import { PromptMentionPill } from "./ConversationMessageMentions.js";
import { useThreadTitleDisplayText } from "@/components/thread/ThreadTitleMentions.js";
import {
  boundedMarkdownPreview,
  closeUnterminatedMarkdownCodeSpan,
  endsInsideExactRawThreadIdCodeSpan,
  GENERATED_MESSAGE_COLLAPSED_PREVIEW_CHAR_CAP,
} from "@bb/client-core";

interface AutomationLink {
  automationId: string;
  projectId: string;
}

interface GeneratedConversationMessageProps {
  attachmentItems: ConversationAttachmentItems;
  automationLink: AutomationLink | null;
  originKind: ThreadOriginKind | null;
  mentions: readonly PromptTextMention[];
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  onTitleAction?: TimelineTitleActionResolver;
  sourceKind: GeneratedConversationSourceKind;
  sourceName: string;
  sourceProjectId: string | null;
  sourceThreadId: string | null;
  sourceIsPluginSideChat: boolean;
  systemMessageKind: SystemMessageKind;
  systemMessageSubject: SystemMessageSubject | null;
  text: string;
  threadId?: string;
  timestamp: number;
  turnRequest: TimelineUserConversationRow["turnRequest"];
  workspaceRootPath?: string;
}

type GeneratedConversationSourceKind = "agent" | "automation" | "system";

interface GeneratedConversationBodyTextArgs {
  initiator: TimelineUserConversationRow["initiator"];
  text: string;
}

interface GeneratedConversationBodySlice {
  startOffset: number;
  text: string;
}

interface GeneratedConversationCollapsedPreview {
  hasAdditionalBodyLines: boolean;
  parseAsMarkdown: boolean;
  text: string;
  wasCapped: boolean;
}

interface TimelineTitleSegmentArgs {
  em: boolean;
  link: TimelineTitleSegment["link"] | null;
  shimmer: boolean;
  text: string;
  truncate: boolean;
}

interface GeneratedConversationTitleArgs {
  originKind: ThreadOriginKind | null;
  sourceKind: GeneratedConversationSourceKind;
  sourceName: string;
  sourceThreadId: string | null;
  sourceIsPluginSideChat: boolean;
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

export function generatedConversationCollapsedPreview(
  text: string,
): GeneratedConversationCollapsedPreview {
  const previewWindow = text.slice(
    0,
    GENERATED_MESSAGE_COLLAPSED_PREVIEW_CHAR_CAP + 1,
  );
  const lineBreakMatch = /\r\n|\r|\n/u.exec(previewWindow);
  if (lineBreakMatch !== null) {
    const text = previewWindow.slice(0, lineBreakMatch.index);
    return {
      hasAdditionalBodyLines: true,
      parseAsMarkdown: !endsInsideExactRawThreadIdCodeSpan(text),
      text,
      wasCapped: false,
    };
  }

  const bounded = boundedMarkdownPreview(
    text,
    GENERATED_MESSAGE_COLLAPSED_PREVIEW_CHAR_CAP,
  );
  return {
    hasAdditionalBodyLines: false,
    ...bounded,
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

function verbSegment(text: string): TimelineTitleSegment {
  return timelineTitleSegment({
    em: false,
    link: null,
    shimmer: false,
    text,
    truncate: false,
  });
}

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
    case "tool-result-delivered":
      return subject !== null && subject.kind === "tool-call"
        ? [
            verbSegment("Delivered"),
            subjectSegment(subject.toolName, null),
            verbSegment("result"),
          ]
        : SYSTEM_MESSAGE_FALLBACK_SEGMENTS;
    case "unlabeled":
      return SYSTEM_MESSAGE_FALLBACK_SEGMENTS;
  }
}

export function generatedConversationTitle({
  originKind,
  sourceKind,
  sourceName,
  sourceThreadId,
  sourceIsPluginSideChat,
  systemMessageKind,
  systemMessageSubject,
}: GeneratedConversationTitleArgs): TimelineTitle {
  const agentLeadIn = sourceIsPluginSideChat
    ? "Replying to"
    : originKind === "fork"
      ? "Forked from"
      : "Message from";
  const sideChatAction =
    sourceIsPluginSideChat && sourceThreadId !== null
      ? ({ kind: "open-plugin-side-chat", threadId: sourceThreadId } as const)
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
      : sourceKind === "automation"
        ? [verbSegment("Automation")]
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
    case "automation":
      return "Ran an automation";
    case "system":
      return "Sent a BB system message";
  }
}

function systemMessageIconName(systemMessageKind: SystemMessageKind): IconName {
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
    case "tool-result-delivered":
      return "Toolbox";
    case "unlabeled":
      return "Info";
  }
}

function generatedConversationIconName(
  sourceKind: GeneratedConversationSourceKind,
  originKind: ThreadOriginKind | null,
  systemMessageKind: SystemMessageKind,
): IconName {
  if (originKind === "fork") {
    return "Fork";
  }
  switch (sourceKind) {
    case "agent":
      return "MessageSquare";
    case "automation":
      return "Repeat";
    case "system":
      return systemMessageIconName(systemMessageKind);
  }
}

interface GeneratedAgentSourceTitleProps {
  onTitleAction?: TimelineTitleActionResolver;
  sourceIsPluginSideChat: boolean;
  sourceName: string;
  sourceProjectId: string | null;
  sourceThreadId: string | null;
  title: TimelineTitle;
}

function GeneratedAgentSourceTitle({
  onTitleAction,
  sourceIsPluginSideChat,
  sourceName,
  sourceProjectId,
  sourceThreadId,
  title,
}: GeneratedAgentSourceTitleProps) {
  const sourceDisplayName = useThreadTitleDisplayText(sourceName);
  const sourceTitleAction =
    title.action && onTitleAction ? onTitleAction(title.action) : null;
  const leadIn = title.segments[0]?.text ?? "Message from";

  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap text-sm leading-5"
      title={`${leadIn} ${sourceDisplayName}`}
    >
      <span className="shrink-0 whitespace-pre text-muted-foreground">
        {leadIn}
      </span>{" "}
      {sourceThreadId === null ? (
        <span className="min-w-0 truncate font-medium text-foreground opacity-70">
          {sourceDisplayName}
        </span>
      ) : (
        <PromptMentionPill
          resource={{
            kind: "thread",
            threadId: sourceThreadId,
            ...(sourceProjectId === null ? {} : { projectId: sourceProjectId }),
            label: sourceDisplayName,
          }}
          serializedText={`@thread:${sourceThreadId}`}
          interactive={!sourceIsPluginSideChat || sourceTitleAction !== null}
          onActivate={sourceTitleAction ?? undefined}
        />
      )}
    </span>
  );
}

interface GeneratedAutomationTitleProps {
  automationLink: AutomationLink | null;
  requestLabel: string | null;
  timestamp: number;
}

function stopRowToggle(event: MouseEvent<HTMLAnchorElement>): void {
  event.stopPropagation();
}

function stopRowToggleKey(event: KeyboardEvent<HTMLAnchorElement>): void {
  if (event.key === "Enter" || event.key === " ") {
    event.stopPropagation();
  }
}

function GeneratedAutomationTitle({
  automationLink,
  requestLabel,
  timestamp,
}: GeneratedAutomationTitleProps) {
  const sentAt = new Date(timestamp);
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 whitespace-nowrap text-sm leading-5">
      {automationLink === null ? (
        <span className="shrink-0">Automation</span>
      ) : (
        <RouteAnchor
          href={generatePath(AUTOMATION_DETAIL_ROUTE_PATH, automationLink)}
          className="shrink-0 underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
          onClick={stopRowToggle}
          onKeyDown={stopRowToggleKey}
        >
          Automation
        </RouteAnchor>
      )}
      <span aria-hidden="true" className="shrink-0 text-subtle-foreground">
        ·
      </span>
      <time
        className="shrink-0 text-subtle-foreground"
        dateTime={sentAt.toISOString()}
        title={sentAt.toLocaleString(undefined, {
          dateStyle: "full",
          timeStyle: "long",
        })}
      >
        {formatShortMessageTime(timestamp, new Date())}
      </time>
      {requestLabel === null ? null : (
        <span className="shrink-0">{requestLabel}</span>
      )}
    </span>
  );
}

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
    automationLink,
    originKind,
    mentions,
    onOpenLink,
    onOpenLocalFileLink,
    projectId,
    resolveMentionLink,
    onTitleAction,
    sourceKind,
    sourceName,
    sourceProjectId,
    sourceThreadId,
    sourceIsPluginSideChat,
    systemMessageKind,
    systemMessageSubject,
    text,
    threadId,
    timestamp,
    turnRequest,
    workspaceRootPath,
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
    const titleRequestLabel =
      sourceKind === "automation" && turnRequest.status !== "accepted"
        ? requestLabel
        : null;
    const bodyRequestLabel = titleRequestLabel === null ? requestLabel : null;
    const linkRouting = useMemo<MarkdownLinkRouting | undefined>(
      () =>
        buildMarkdownMessageLinkRouting({
          onOpenLink,
          onOpenLocalFileLink,
          threadId,
          workspaceRootPath,
        }),
      [onOpenLink, onOpenLocalFileLink, threadId, workspaceRootPath],
    );
    const title = useMemo(
      () =>
        generatedConversationTitle({
          originKind,
          sourceKind,
          sourceName,
          sourceThreadId,
          sourceIsPluginSideChat,
          systemMessageKind,
          systemMessageSubject,
        }),
      [
        originKind,
        sourceKind,
        sourceName,
        sourceThreadId,
        sourceIsPluginSideChat,
        systemMessageKind,
        systemMessageSubject,
      ],
    );
    const sourceTitleContent =
      sourceKind === "agent" ? (
        <GeneratedAgentSourceTitle
          onTitleAction={onTitleAction}
          sourceIsPluginSideChat={sourceIsPluginSideChat}
          sourceName={sourceName}
          sourceProjectId={sourceProjectId}
          sourceThreadId={sourceThreadId}
          title={title}
        />
      ) : sourceKind === "automation" ? (
        <GeneratedAutomationTitle
          automationLink={automationLink}
          requestLabel={titleRequestLabel}
          timestamp={timestamp}
        />
      ) : undefined;
    const leadingIcon = generatedConversationIconName(
      sourceKind,
      originKind,
      systemMessageKind,
    );
    const titleOnly = systemMessageIsTitleOnly(sourceKind, systemMessageKind);
    const hasExpandedOnlyContent =
      attachmentItems.filePaths.length > 0 ||
      attachmentItems.imageItems.length > 0 ||
      bodyRequestLabel !== null;
    const collapsedPreviewSource =
      generatedConversationCollapsedPreview(messageText);
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
        collapsedPreviewSource.hasAdditionalBodyLines ||
        collapsedPreviewSource.wasCapped ||
        collapsedPreviewOverflowMeasurement === "overflowing");
    const hideManualContinuation =
      collapsedPreviewOverflowMeasurement === "overflowing";
    const collapsedPreviewBody = clipMentionTextToVisibleRange({
      mentions: messageMentions,
      rangeStart: 0,
      text: collapsedPreviewSource.text,
    });
    const collapsedPreviewMarkdown =
      collapsedPreviewSource.wasCapped ||
      collapsedPreviewSource.hasAdditionalBodyLines
        ? closeUnterminatedMarkdownCodeSpan(collapsedPreviewBody.text)
        : collapsedPreviewBody.text;
    const suppressGeneratedAgentImages =
      sourceKind === "agent" && !sourceIsPluginSideChat;
    const collapsedPreview =
      !titleOnly && collapsedPreviewBody.text ? (
        <div
          className={`${NESTED_TIMELINE_GROUP_LINE_CLASS_NAME} max-w-full min-w-0`}
        >
          <div className="flex min-w-0 items-baseline truncate pl-2 text-sm leading-relaxed text-foreground">
            <div ref={setCollapsedPreviewTextRef} className="min-w-0 truncate">
              {collapsedPreviewSource.parseAsMarkdown ? (
                <MarkdownPreview
                  allowHtml
                  content={collapsedPreviewMarkdown}
                  imagePolicy={
                    suppressGeneratedAgentImages ? "alt-text" : "render"
                  }
                  linkRouting={linkRouting}
                  promptMentions={{
                    mentions: collapsedPreviewBody.mentions,
                    resolveMentionLink,
                  }}
                  threadMentions={{
                    mentions: collapsedPreviewBody.mentions,
                    preserveSoftBreaks: true,
                  }}
                  className={COLLAPSED_MARKDOWN_PREVIEW_CLASS}
                />
              ) : (
                <span>{collapsedPreviewBody.text}</span>
              )}
            </div>
            {expandable ? (
              <span
                className={cn(
                  "shrink-0 text-muted-foreground",
                  hideManualContinuation && "invisible",
                )}
              >
                ...
              </span>
            ) : null}
          </div>
        </div>
      ) : null;
    const renderBody = useCallback(
      () => (
        <div className={NESTED_TIMELINE_GROUP_LINE_CLASS_NAME}>
          <div className="pl-2 text-sm leading-relaxed text-foreground">
            {messageText ? (
              <MarkdownPreview
                allowHtml
                content={messageText}
                imagePolicy={
                  suppressGeneratedAgentImages ? "alt-text" : "render"
                }
                linkRouting={linkRouting}
                promptMentions={{
                  mentions: messageMentions,
                  resolveMentionLink,
                }}
                threadMentions={{
                  mentions: messageMentions,
                  preserveSoftBreaks: true,
                }}
              />
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
            {bodyRequestLabel ? (
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
        resolveMentionLink,
        sourceKind,
        suppressGeneratedAgentImages,
        bodyRequestLabel,
        turnRequest,
      ],
    );

    return (
      <ExpandableTimelineRow
        title={title}
        titleContent={sourceTitleContent}
        collapsedPreview={collapsedPreview}
        expandable={expandable}
        leadingIcon={leadingIcon}
        onTitleAction={onTitleAction}
        renderBody={renderBody}
      />
    );
  },
);
