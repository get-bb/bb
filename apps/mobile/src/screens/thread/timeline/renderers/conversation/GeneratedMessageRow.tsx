import type { TimelineUserConversationRow } from "@bb/server-contract";
import { useCallback, useMemo } from "react";
import { Pressable, View } from "react-native";
import { isPluginSideChatSenderThread } from "@/data/thread-detail";
import {
  Markdown,
  MarkdownText,
  type MarkdownThreadMentions,
} from "@/markdown";
import { useTheme } from "@/theme";
import { Icon, Text } from "@/ui";
import { TIMELINE_ROW_DEPTH_INDENT_PX } from "../../FallbackTimelineRow";
import { useTimelineRowHost } from "../../host/TimelineRowHostProvider";
import {
  ExpandableRowHeader,
  TimelineRowShell,
} from "../shared/ExpandableRowHeader";
import { ConversationAttachments } from "./ConversationAttachments";
import {
  buildGeneratedMessageContent,
  generatedAgentSourceName,
  generatedConversationEmptyText,
  generatedConversationIconName,
  generatedConversationTitle,
  isForkSeedAnchorRow,
  isGeneratedMessageExpandable,
  systemMessageIsTitleOnly,
  type GeneratedConversationSourceKind,
} from "./conversation-model";
import {
  TurnRequestLabel,
  useConversationAttachments,
  useConversationMarkdownHandlers,
} from "./conversation-shared";

interface GeneratedMessageRowProps {
  row: TimelineUserConversationRow;
  sourceKind: GeneratedConversationSourceKind;
  depth: number;
  projectId: string;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * "Message from <thread>" header: the lead-in plus the source name as a
 * tappable thread chip (web `GeneratedAgentSourceTitle` / mention pill).
 */
function AgentSourceTitle({
  leadIn,
  sourceName,
  sourceThreadId,
  onOpenThread,
}: {
  leadIn: string;
  sourceName: string;
  sourceThreadId: string | null;
  onOpenThread: (() => void) | null;
}) {
  const { tokens } = useTheme();
  return (
    <View className="min-w-0 flex-row items-center gap-1">
      <Text className="text-sm text-muted-foreground" numberOfLines={1}>
        {leadIn}
      </Text>
      {sourceThreadId === null || onOpenThread === null ? (
        <Text
          className="min-w-0 shrink text-sm font-medium text-foreground/70"
          numberOfLines={1}
        >
          {sourceName}
        </Text>
      ) : (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open thread ${sourceName}`}
          onPress={onOpenThread}
          hitSlop={4}
          className="min-w-0 shrink flex-row items-center gap-1 rounded-full border border-pill-surface-border bg-surface-raised-solid/50 py-0.5 pl-1.5 pr-2 active:opacity-70"
          testID="conversation-source-thread"
        >
          <Icon name="MessageSquare" size={12} color={tokens.pillIcon} />
          <Text
            className="min-w-0 shrink text-xs text-pill-foreground"
            numberOfLines={1}
          >
            {sourceName}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * A message that BB or another thread injected into this one (web
 * `GeneratedConversationMessage`): a one-line header with the source, a
 * truncated one-line preview while collapsed, and the full markdown body,
 * attachments, and steer label once expanded. Ownership notices are
 * title-only.
 */
export function GeneratedMessageRow({
  row,
  sourceKind,
  depth,
  projectId,
  expanded,
  onToggle,
}: GeneratedMessageRowProps) {
  const {
    openThread,
    presentMessageActions,
    senderThreadMetadataById,
    threadOriginKind,
  } = useTimelineRowHost();
  const {
    onThreadPress,
    onImagePress,
    onFilePress,
    onLinkPress,
    resolveThreadMention,
    serverHostname,
  } = useConversationMarkdownHandlers();
  const { items: attachmentItems, openImage } = useConversationAttachments(
    row.attachments,
    projectId,
  );

  const senderMetadata =
    row.senderThreadId === null
      ? null
      : (senderThreadMetadataById.get(row.senderThreadId) ?? null);
  const sourceIsPluginSideChat =
    sourceKind === "agent" && isPluginSideChatSenderThread(senderMetadata);
  const sourceThreadId = sourceKind === "agent" ? row.senderThreadId : null;
  const sourceName =
    sourceKind === "agent"
      ? generatedAgentSourceName(senderMetadata, sourceIsPluginSideChat)
      : "BB";
  // The fork leading icon belongs to the seed anchor only; later cross-thread
  // messages in a forked thread keep their own icon.
  const originKind = isForkSeedAnchorRow(row) ? threadOriginKind : null;

  const title = useMemo(
    () =>
      generatedConversationTitle({
        originKind,
        sourceKind,
        sourceName,
        sourceThreadId,
        sourceIsPluginSideChat,
        systemMessageKind: row.systemMessageKind,
        systemMessageSubject: row.systemMessageSubject,
      }),
    [
      originKind,
      row.systemMessageKind,
      row.systemMessageSubject,
      sourceIsPluginSideChat,
      sourceKind,
      sourceName,
      sourceThreadId,
    ],
  );
  const content = useMemo(
    () =>
      buildGeneratedMessageContent({
        initiator: row.initiator,
        mentions: row.mentions,
        text: row.text,
      }),
    [row.initiator, row.mentions, row.text],
  );
  const threadMentions = useMemo<MarkdownThreadMentions>(
    () => ({
      mentions: content.messageMentions,
      resolveThread: resolveThreadMention,
    }),
    [content.messageMentions, resolveThreadMention],
  );
  const previewThreadMentions = useMemo<MarkdownThreadMentions>(
    () => ({
      mentions: content.preview?.mentions ?? [],
      resolveThread: resolveThreadMention,
    }),
    [content.preview?.mentions, resolveThreadMention],
  );

  const titleOnly = systemMessageIsTitleOnly(sourceKind, row.systemMessageKind);
  const hasExpandedOnlyContent =
    attachmentItems.filePaths.length > 0 ||
    attachmentItems.imageItems.length > 0 ||
    row.turnRequest.kind === "steer";
  const expandable =
    !titleOnly &&
    isGeneratedMessageExpandable({
      hasExpandedOnlyContent,
      messageText: content.messageText,
      previewTruncated: content.previewTruncated,
    });
  const isExpanded = expandable && expanded;
  const leadingIcon = generatedConversationIconName(
    sourceKind,
    originKind,
    row.systemMessageKind,
  );
  const openSourceThread =
    sourceThreadId === null || sourceIsPluginSideChat
      ? null
      : () => openThread(sourceThreadId);
  const messageText = content.messageText;
  const messageMentions = content.messageMentions;
  const onLongPress = useCallback(
    () =>
      presentMessageActions({
        rowId: row.id,
        role: "user",
        text: messageText,
        sourceSeqStart: row.sourceSeqStart,
        sourceSeqEnd: row.sourceSeqEnd,
        paragraph: null,
        // Generated (agent / system sourced) rows are never the person's own
        // request, so they are not editable.
        editable: false,
        mentions: messageMentions,
        attachments: row.attachments,
      }),
    [
      messageMentions,
      messageText,
      presentMessageActions,
      row.attachments,
      row.id,
      row.sourceSeqEnd,
      row.sourceSeqStart,
    ],
  );
  // Images in agent-sourced bodies render as alt text (web `imagePolicy:
  // "alt-text"` for non-side-chat agents): another thread's host paths are
  // not loadable here.
  const resolveImageSource = useCallback(() => null, []);
  const suppressImages = sourceKind === "agent" && !sourceIsPluginSideChat;

  return (
    <TimelineRowShell depth={depth} kind="conversation:user">
      <ExpandableRowHeader
        title={title}
        titleContent={
          sourceKind === "agent" ? (
            <AgentSourceTitle
              leadIn={title.segments[0]?.text ?? "Message from"}
              sourceName={sourceName}
              sourceThreadId={sourceThreadId}
              onOpenThread={openSourceThread}
            />
          ) : undefined
        }
        leadingIcon={leadingIcon}
        expandable={expandable}
        expanded={isExpanded}
        onToggle={onToggle}
        dimmed={false}
        onLongPress={messageText.length > 0 ? onLongPress : undefined}
        testID="conversation-generated-header"
      />
      {!titleOnly && !isExpanded && content.preview !== null ? (
        <Pressable
          accessible={false}
          disabled={!expandable}
          onPress={onToggle}
          onLongPress={onLongPress}
          className="flex-row items-baseline border-l border-border pb-1 pl-2 active:opacity-70"
          style={{ marginLeft: TIMELINE_ROW_DEPTH_INDENT_PX / 2 }}
          testID="conversation-generated-preview"
        >
          <View className="min-w-0 flex-1">
            {content.preview.parseAsMarkdown ? (
              <MarkdownText
                content={content.preview.content}
                promptMentions={content.preview.mentions}
                threadMentions={previewThreadMentions}
                numberOfLines={1}
                serverHostname={serverHostname}
                onThreadPress={onThreadPress}
              />
            ) : (
              <Text className="text-sm" numberOfLines={1}>
                {content.preview.content}
              </Text>
            )}
          </View>
          {expandable ? (
            <Text className="text-sm text-muted-foreground">…</Text>
          ) : null}
        </Pressable>
      ) : null}
      {!titleOnly && isExpanded ? (
        <Pressable
          accessible={false}
          onLongPress={onLongPress}
          className="border-l border-border pb-1 pl-2"
          style={{ marginLeft: TIMELINE_ROW_DEPTH_INDENT_PX / 2 }}
          testID="conversation-generated-body"
        >
          {messageText.length > 0 ? (
            <Markdown
              content={messageText}
              promptMentions={content.messageMentions}
              threadMentions={threadMentions}
              selectable={false}
              serverHostname={serverHostname}
              onThreadPress={onThreadPress}
              onImagePress={onImagePress}
              onFilePress={onFilePress}
              onLinkPress={onLinkPress}
              resolveImageSource={
                suppressImages ? resolveImageSource : undefined
              }
            />
          ) : (
            <Text className="text-sm text-muted-foreground">
              {generatedConversationEmptyText(sourceKind)}
            </Text>
          )}
          <ConversationAttachments
            align="start"
            filePaths={attachmentItems.filePaths}
            imageItems={attachmentItems.imageItems}
            onImagePress={openImage}
          />
          {row.turnRequest.kind === "steer" ? (
            <View className="mt-1 flex-row items-center">
              <TurnRequestLabel turnRequest={row.turnRequest} />
            </View>
          ) : null}
        </Pressable>
      ) : null}
    </TimelineRowShell>
  );
}
