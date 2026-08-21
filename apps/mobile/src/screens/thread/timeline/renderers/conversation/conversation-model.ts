import {
  boundedMarkdownPreview,
  closeUnterminatedMarkdownCodeSpan,
  computeMutedPrefixLength,
  endsInsideExactRawThreadIdCodeSpan,
  GENERATED_MESSAGE_COLLAPSED_PREVIEW_CHAR_CAP,
  USER_MESSAGE_CHAR_CAP,
} from "@bb/client-core";
import type {
  PromptTextMention,
  SystemMessageKind,
  SystemMessageSubject,
  ThreadOriginKind,
} from "@bb/domain";
import type {
  TimelineConversationAttachments,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import {
  fileNameFromPath,
  type TimelineTitle,
  type TimelineTitleSegment,
} from "@bb/thread-view";
import { resolveUserAttachmentImageUrl } from "@/data/thread-detail/file-content-urls";
import type { SenderThreadMetadata } from "@/data/thread-detail/sender-thread-metadata";
import type { IconName } from "@/ui/icon-map";

/**
 * Pure policy behind the conversation rows (ports of the web
 * ConversationMessageContent / GeneratedConversationMessage /
 * ConversationMessageMentions / ConversationAttachments helpers): which
 * presentation a user row takes, how generated bodies are sliced and
 * previewed, how mentions are rebased onto the visible text, and what the
 * attachment strip shows.
 */

// ---------------------------------------------------------------------------
// Presentation variants

type UserMessageVariant =
  | { kind: "authored" }
  | { kind: "generated"; sourceKind: "agent"; senderThreadId: string }
  | { kind: "generated"; sourceKind: "system" };

export type GeneratedConversationSourceKind = "agent" | "system";

/**
 * Agent-initiated rows with a sender are cross-thread messages ("Message from
 * …"), system-initiated rows are BB's own ("ownership assigned", …); anything
 * else is the person's own authored message.
 */
export function classifyUserMessage(
  row: Pick<TimelineUserConversationRow, "initiator" | "senderThreadId">,
): UserMessageVariant {
  if (row.initiator === "agent" && row.senderThreadId !== null) {
    return {
      kind: "generated",
      sourceKind: "agent",
      senderThreadId: row.senderThreadId,
    };
  }
  if (row.initiator === "system") {
    return { kind: "generated", sourceKind: "system" };
  }
  return { kind: "authored" };
}

/**
 * The fork's seed anchor — the thread-start turn rendered as "Message from
 * {source}": agent-initiated with a sender thread and no turn id (it predates
 * the first executed turn). Only this row takes the fork leading icon.
 */
export function isForkSeedAnchorRow(
  row: Pick<
    TimelineUserConversationRow,
    "role" | "initiator" | "senderThreadId" | "turnId"
  >,
): boolean {
  return (
    row.role === "user" &&
    row.initiator === "agent" &&
    row.senderThreadId !== null &&
    row.turnId === null
  );
}

// ---------------------------------------------------------------------------
// Mentions

function shiftMentionsToTextRange({
  mentions,
  rangeEnd,
  rangeStart,
}: {
  mentions: readonly PromptTextMention[];
  rangeEnd: number;
  rangeStart: number;
}): PromptTextMention[] {
  return mentions.flatMap((mention) => {
    if (mention.start < rangeStart || mention.end > rangeEnd) return [];
    return [
      {
        ...mention,
        start: mention.start - rangeStart,
        end: mention.end - rangeStart,
      },
    ];
  });
}

/**
 * Rebase mentions onto a visible slice of the text. A mention that straddles
 * the visible end clips the text back to its start, so a half-shown pill is
 * never rendered (it returns once the complete body is shown).
 */
export function clipMentionTextToVisibleRange({
  mentions,
  rangeStart,
  text,
}: {
  mentions: readonly PromptTextMention[];
  rangeStart: number;
  text: string;
}): { mentions: PromptTextMention[]; text: string } {
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

// ---------------------------------------------------------------------------
// Authored (own) message body

/** Web `max-h-[15lh]`: collapsed authored messages show this many lines. */
export const USER_MESSAGE_COLLAPSED_MAX_LINES = 15;

interface AuthoredMessageBody {
  /** The muted `[bb …]` prefix shown as its own line, or null. */
  prefixText: string | null;
  /** Markdown content to render (code spans closed when capped). */
  content: string;
  /** Mentions rebased onto `content`. */
  mentions: PromptTextMention[];
  /** False when the capped preview ends inside an unbreakable token. */
  parseAsMarkdown: boolean;
  /** The collapsed body was cut at the char cap: a toggle is required. */
  cappedByLength: boolean;
}

/**
 * Slices the authored message for rendering: strips the muted prefix, caps
 * the collapsed body at `USER_MESSAGE_CHAR_CAP` (the full body renders only
 * after an explicit expand), and rebases the mentions onto the visible text.
 */
export function buildAuthoredMessageBody({
  expanded,
  initiator,
  mentions,
  text,
}: {
  expanded: boolean;
  initiator: TimelineUserConversationRow["initiator"];
  mentions: readonly PromptTextMention[];
  text: string;
}): AuthoredMessageBody {
  const mutePrefixLength = computeMutedPrefixLength(initiator, text);
  // If the prefix would consume everything (or extend past the text), fall
  // back to plain rendering.
  const showMutedPrefix =
    mutePrefixLength > 0 && mutePrefixLength < text.length;
  const prefixText = showMutedPrefix ? text.slice(0, mutePrefixLength) : null;
  const bodyText = showMutedPrefix ? text.slice(mutePrefixLength) : text;
  const bodyOffset = showMutedPrefix ? mutePrefixLength : 0;
  const exceedsCap = bodyText.length > USER_MESSAGE_CHAR_CAP;
  const preview =
    !expanded && exceedsCap
      ? boundedMarkdownPreview(bodyText, USER_MESSAGE_CHAR_CAP)
      : null;
  const renderedBodyText = preview?.text ?? bodyText;
  const body = clipMentionTextToVisibleRange({
    mentions,
    rangeStart: bodyOffset,
    text: renderedBodyText,
  });
  return {
    prefixText,
    content:
      preview?.wasCapped === true
        ? closeUnterminatedMarkdownCodeSpan(body.text)
        : body.text,
    mentions: body.mentions,
    parseAsMarkdown: preview?.parseAsMarkdown ?? true,
    cappedByLength: exceedsCap,
  };
}

// ---------------------------------------------------------------------------
// Generated (agent / system sourced) message body

export interface GeneratedConversationBodySlice {
  startOffset: number;
  text: string;
}

/** Strips the `[bb …]` prefix and the whitespace after it. */
function generatedConversationBodySlice({
  initiator,
  text,
}: {
  initiator: TimelineUserConversationRow["initiator"];
  text: string;
}): GeneratedConversationBodySlice {
  const prefixLength = computeMutedPrefixLength(initiator, text);
  if (prefixLength <= 0) return { startOffset: 0, text };
  const textAfterPrefix = text.slice(prefixLength);
  const trimStartLength =
    textAfterPrefix.length - textAfterPrefix.trimStart().length;
  return {
    startOffset: prefixLength + trimStartLength,
    text: textAfterPrefix.slice(trimStartLength),
  };
}

export interface GeneratedConversationCollapsedPreview {
  hasAdditionalBodyLines: boolean;
  parseAsMarkdown: boolean;
  text: string;
  wasCapped: boolean;
}

/**
 * The one-line collapsed preview of a generated message: the first line, or
 * the char-capped head when the body is a single long line. The cap never
 * manufactures a token: it retreats to whitespace, and a single unbroken
 * token stays plain text until expanded.
 */
function generatedConversationCollapsedPreview(
  text: string,
): GeneratedConversationCollapsedPreview {
  const previewWindow = text.slice(
    0,
    GENERATED_MESSAGE_COLLAPSED_PREVIEW_CHAR_CAP + 1,
  );
  const lineBreakMatch = /\r\n|\r|\n/u.exec(previewWindow);
  if (lineBreakMatch !== null) {
    const firstLine = previewWindow.slice(0, lineBreakMatch.index);
    return {
      hasAdditionalBodyLines: true,
      parseAsMarkdown: !endsInsideExactRawThreadIdCodeSpan(firstLine),
      text: firstLine,
      wasCapped: false,
    };
  }
  const bounded = boundedMarkdownPreview(
    text,
    GENERATED_MESSAGE_COLLAPSED_PREVIEW_CHAR_CAP,
  );
  return { hasAdditionalBodyLines: false, ...bounded };
}

interface GeneratedMessageContent {
  /** Trimmed body without the `[bb …]` prefix. */
  messageText: string;
  /** Mentions rebased onto `messageText`. */
  messageMentions: PromptTextMention[];
  /** Collapsed one-line preview (markdown content, mentions rebased). */
  preview: {
    content: string;
    mentions: PromptTextMention[];
    parseAsMarkdown: boolean;
  } | null;
  /** Whether the preview omits anything the expanded body would show. */
  previewTruncated: boolean;
}

/** Everything the generated row renders, derived once from the row text. */
export function buildGeneratedMessageContent({
  initiator,
  mentions,
  text,
}: {
  initiator: TimelineUserConversationRow["initiator"];
  mentions: readonly PromptTextMention[];
  text: string;
}): GeneratedMessageContent {
  const body = generatedConversationBodySlice({ initiator, text });
  const bodyMentions = shiftMentionsToTextRange({
    mentions,
    rangeStart: body.startOffset,
    rangeEnd: body.startOffset + body.text.length,
  });
  const trimStartLength = body.text.length - body.text.trimStart().length;
  const messageText = body.text.trim();
  const messageMentions = shiftMentionsToTextRange({
    mentions: bodyMentions,
    rangeStart: trimStartLength,
    rangeEnd: trimStartLength + messageText.length,
  });
  if (messageText.length === 0) {
    return {
      messageText,
      messageMentions,
      preview: null,
      previewTruncated: false,
    };
  }
  const source = generatedConversationCollapsedPreview(messageText);
  const previewBody = clipMentionTextToVisibleRange({
    mentions: messageMentions,
    rangeStart: 0,
    text: source.text,
  });
  const truncated = source.wasCapped || source.hasAdditionalBodyLines;
  return {
    messageText,
    messageMentions,
    preview:
      previewBody.text.length === 0
        ? null
        : {
            content: truncated
              ? closeUnterminatedMarkdownCodeSpan(previewBody.text)
              : previewBody.text,
            mentions: previewBody.mentions,
            parseAsMarkdown: source.parseAsMarkdown,
          },
    previewTruncated: truncated || previewBody.text.length < messageText.length,
  };
}

/**
 * A phone-width single line of timeline body text holds about this many
 * characters before truncating (15px Inter, header inset). The web measures
 * the rendered preview for overflow; RN exposes no truncation signal for a
 * `numberOfLines` text, so the heuristic stands in for the measurement.
 */
export const GENERATED_PREVIEW_SINGLE_LINE_MAX_CHARS = 40;

/**
 * Whether a generated row opens: it has content the preview cannot show
 * (attachments, a steer label, more lines, a capped body) or a body too long
 * for the one-line preview.
 */
export function isGeneratedMessageExpandable({
  hasExpandedOnlyContent,
  messageText,
  previewTruncated,
}: {
  hasExpandedOnlyContent: boolean;
  messageText: string;
  previewTruncated: boolean;
}): boolean {
  return (
    hasExpandedOnlyContent ||
    previewTruncated ||
    messageText.length > GENERATED_PREVIEW_SINGLE_LINE_MAX_CHARS
  );
}

export function generatedConversationEmptyText(
  sourceKind: GeneratedConversationSourceKind,
): string {
  switch (sourceKind) {
    case "agent":
      return "Sent an agent message";
    case "system":
      return "Sent a BB system message";
  }
}

// ---------------------------------------------------------------------------
// Generated message title + icon

function titleSegment(
  text: string,
  options: { em: boolean; truncate: boolean; threadId?: string | null },
): TimelineTitleSegment {
  const segment: TimelineTitleSegment = {
    em: options.em,
    shimmer: false,
    text,
    truncate: options.truncate,
  };
  if (options.threadId) {
    segment.link = { kind: "thread", threadId: options.threadId };
  }
  return segment;
}

const SYSTEM_MESSAGE_FALLBACK_SEGMENTS: TimelineTitleSegment[] = [
  titleSegment("System Message", { em: false, truncate: true }),
];

function threadSubjectTitleSegments(
  subject: SystemMessageSubject | null,
  verb: string,
): TimelineTitleSegment[] {
  if (subject === null || subject.kind !== "thread") {
    return SYSTEM_MESSAGE_FALLBACK_SEGMENTS;
  }
  return [
    titleSegment(subject.threadName, {
      em: true,
      truncate: true,
      threadId: subject.threadId,
    }),
    titleSegment(verb, { em: false, truncate: false }),
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
        ? [
            titleSegment(`${subject.count} threads updated`, {
              em: false,
              truncate: false,
            }),
          ]
        : SYSTEM_MESSAGE_FALLBACK_SEGMENTS;
    case "unlabeled":
      return SYSTEM_MESSAGE_FALLBACK_SEGMENTS;
  }
}

export interface GeneratedConversationTitleArgs {
  originKind: ThreadOriginKind | null;
  sourceKind: GeneratedConversationSourceKind;
  sourceName: string;
  sourceThreadId: string | null;
  sourceIsPluginSideChat: boolean;
  systemMessageKind: SystemMessageKind;
  systemMessageSubject: SystemMessageSubject | null;
}

/**
 * Header title of a generated row: "Message from <name>" / "Forked from
 * <name>" / "Replying to side chat" for agent sources, the system-message
 * taxonomy ("<thread> finished", "3 threads updated") for system sources.
 */
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
  const segments: TimelineTitleSegment[] =
    sourceKind === "agent"
      ? [
          titleSegment(agentLeadIn, { em: false, truncate: false }),
          titleSegment(sourceName, {
            em: true,
            truncate: true,
            threadId: sourceIsPluginSideChat ? null : sourceThreadId,
          }),
        ]
      : systemMessageTitleSegments(systemMessageKind, systemMessageSubject);
  return {
    action:
      sourceIsPluginSideChat && sourceThreadId !== null
        ? { kind: "open-plugin-side-chat", threadId: sourceThreadId }
        : null,
    decorations: [],
    plain: segments
      .map((segment) => segment.plainText ?? segment.text)
      .join(" "),
    segments,
    tone: "default",
  };
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
    case "unlabeled":
      return "Info";
  }
}

export function generatedConversationIconName(
  sourceKind: GeneratedConversationSourceKind,
  originKind: ThreadOriginKind | null,
  systemMessageKind: SystemMessageKind,
): IconName {
  // A fork's anchor uses the Fork icon (matching the Fork action).
  if (originKind === "fork") return "Fork";
  switch (sourceKind) {
    case "agent":
      return "MessageSquare";
    case "system":
      return systemMessageIconName(systemMessageKind);
  }
}

/**
 * Ownership rows restate their one-line body in the title verbatim, so they
 * render title-only: no body, no preview, not expandable.
 */
export function systemMessageIsTitleOnly(
  sourceKind: GeneratedConversationSourceKind,
  systemMessageKind: SystemMessageKind,
): boolean {
  return (
    sourceKind === "system" &&
    (systemMessageKind === "ownership-assigned" ||
      systemMessageKind === "ownership-removed")
  );
}

/** The display name for an agent source: side chat → "side chat", else its title or "Agent". */
export function generatedAgentSourceName(
  metadata: SenderThreadMetadata | null,
  isPluginSideChat: boolean,
): string {
  if (isPluginSideChat) return "side chat";
  return metadata?.title ?? "Agent";
}

// ---------------------------------------------------------------------------
// Attachments

export interface ConversationImageItem {
  alt: string;
  /** Loadable URL, or null when the phone cannot reach the source. */
  src: string | null;
  /** The original path / URL (chip label fallback). */
  source: string;
}

export interface ConversationAttachmentItems {
  filePaths: readonly string[];
  imageItems: readonly ConversationImageItem[];
}

const EMPTY_ATTACHMENT_ITEMS: ConversationAttachmentItems = {
  filePaths: [],
  imageItems: [],
};

export function buildAttachmentItems({
  attachments,
  projectId,
  serverUrl,
  threadId,
}: {
  attachments: TimelineConversationAttachments | null;
  projectId: string | null;
  serverUrl: string;
  threadId: string;
}): ConversationAttachmentItems {
  if (!attachments) return EMPTY_ATTACHMENT_ITEMS;
  const context = { projectId, serverUrl, threadId };
  const imageItems: ConversationImageItem[] = [
    ...attachments.imageUrls.map((url) => ({
      alt: fileNameFromPath(url),
      src: resolveUserAttachmentImageUrl(url, context),
      source: url,
    })),
    ...attachments.localImagePaths.map((path) => ({
      alt: fileNameFromPath(path),
      src: resolveUserAttachmentImageUrl(path, context),
      source: path,
    })),
  ];
  if (imageItems.length === 0 && attachments.localFilePaths.length === 0) {
    return EMPTY_ATTACHMENT_ITEMS;
  }
  return { filePaths: attachments.localFilePaths, imageItems };
}
