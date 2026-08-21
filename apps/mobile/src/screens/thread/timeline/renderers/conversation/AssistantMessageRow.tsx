import type { TimelineConversationRow } from "@bb/server-contract";
import type { PromptTextMention } from "@bb/domain";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable } from "react-native";
import { resolveAssistantImageUrl } from "@/data/thread-detail";
import {
  Markdown,
  type MarkdownBlockPress,
  type MarkdownThreadMentions,
} from "@/markdown";
import { Text } from "@/ui";
import type { TimelineMessageActionsTarget } from "../../../actions/message-actions-model";
import { useTimelineRowHost } from "../../host/TimelineRowHostProvider";
import { TimelineRowShell } from "../shared/ExpandableRowHeader";
import { ConversationAttachments } from "./ConversationAttachments";
import {
  useConversationAttachments,
  useConversationMarkdownHandlers,
} from "./conversation-shared";

const EMPTY_MENTIONS: readonly PromptTextMention[] = [];

interface AssistantMessageRowProps {
  row: Extract<TimelineConversationRow, { role: "assistant" }>;
  depth: number;
  projectId: string;
}

/**
 * Agent prose (web `AssistantConversationMessage`): the full markdown body
 * at the top of the prominence ramp — never dimmed, never collapsed — with
 * `@thread:` pills, images through the host-files route (lightbox on tap),
 * and the attachment strip. Long-press opens the message actions; a
 * long-press on one paragraph also offers to quote just that block.
 */
export function AssistantMessageRow({
  row,
  depth,
  projectId,
}: AssistantMessageRowProps) {
  const { presentMessageActions, serverUrl, threadId, workspaceRootPath } =
    useTimelineRowHost();
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
  const threadMentions = useMemo<MarkdownThreadMentions>(
    () => ({ resolveThread: resolveThreadMention }),
    [resolveThreadMention],
  );
  const rowThreadId = row.threadId || threadId;
  const resolveImageSource = useCallback(
    (src: string) => {
      const url = resolveAssistantImageUrl(
        src,
        rowThreadId,
        workspaceRootPath,
        serverUrl,
      );
      return url === null ? null : { uri: url };
    },
    [rowThreadId, serverUrl, workspaceRootPath],
  );
  const text = row.text;
  // The target is read through a ref so the per-block long-press callback
  // below stays stable while the body streams (the markdown blocks are
  // memoized on their callbacks' identity).
  const target = useMemo<TimelineMessageActionsTarget>(
    () => ({
      rowId: row.id,
      role: "assistant",
      text,
      sourceSeqStart: row.sourceSeqStart,
      sourceSeqEnd: row.sourceSeqEnd,
      paragraph: null,
      editable: false,
      mentions: EMPTY_MENTIONS,
      attachments: row.attachments,
    }),
    [row.attachments, row.id, row.sourceSeqEnd, row.sourceSeqStart, text],
  );
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);
  const onLongPress = useCallback(
    () => presentMessageActions(targetRef.current),
    [presentMessageActions],
  );
  const onBlockLongPress = useCallback(
    (block: MarkdownBlockPress) =>
      presentMessageActions({ ...targetRef.current, paragraph: block.source }),
    [presentMessageActions],
  );
  const hasText = text.trim().length > 0;

  return (
    <TimelineRowShell depth={depth} kind="conversation:assistant">
      <Pressable
        accessible={false}
        onLongPress={hasText ? onLongPress : undefined}
        delayLongPress={350}
        className="py-1"
        testID="conversation-assistant-body"
      >
        {hasText ? (
          <Markdown
            content={text}
            threadMentions={threadMentions}
            selectable={false}
            serverHostname={serverHostname}
            onThreadPress={onThreadPress}
            onImagePress={onImagePress}
            onFilePress={onFilePress}
            onLinkPress={onLinkPress}
            onBlockLongPress={onBlockLongPress}
            resolveImageSource={resolveImageSource}
          />
        ) : attachmentItems.imageItems.length === 0 &&
          attachmentItems.filePaths.length === 0 ? (
          <Text className="text-sm text-muted-foreground">(empty message)</Text>
        ) : null}
        <ConversationAttachments
          align="start"
          filePaths={attachmentItems.filePaths}
          imageItems={attachmentItems.imageItems}
          onImagePress={openImage}
        />
      </Pressable>
    </TimelineRowShell>
  );
}
