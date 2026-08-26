import { useRecyclingState } from "@shopify/flash-list";
import type { TimelineUserConversationRow } from "@bb/server-contract";
import { useCallback, useMemo } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import { Markdown, type MarkdownThreadMentions } from "@/markdown";
import { withAlpha } from "@/markdown/colors";
import { nativeTypography, useTheme } from "@/theme";
import { LONG_PRESS_DELAY_MS, Text } from "@/ui";
import {
  TIMELINE_ROW_HORIZONTAL_PADDING_PX,
  timelineRowLeftPadding,
} from "../../FallbackTimelineRow";
import { canEditUserMessage } from "../../../actions/message-actions-model";
import { useTimelineRowHost } from "../../host/TimelineRowHostProvider";
import { ConversationAttachments } from "./ConversationAttachments";
import {
  buildAuthoredMessageBody,
  USER_MESSAGE_COLLAPSED_MAX_LINES,
} from "./conversation-model";
import {
  TurnRequestLabel,
  useConversationAttachments,
  useConversationMarkdownHandlers,
} from "./conversation-shared";

const IS_IOS = process.env.EXPO_OS === "ios";

interface AuthoredUserMessageProps {
  row: TimelineUserConversationRow;
  depth: number;
  projectId: string;
  /** Long messages: the full body is shown (list disclosure state). */
  expanded: boolean;
  onToggle: () => void;
}

/** Conversation prose: the 17pt body on iOS, the web timeline size elsewhere. */
const PROSE_TEXT_SIZE = IS_IOS ? "base" : "sm";
/** Web `max-h-[15lh]` on the timeline body type. */
const COLLAPSED_BODY_MAX_HEIGHT =
  USER_MESSAGE_COLLAPSED_MAX_LINES *
  nativeTypography[PROSE_TEXT_SIZE].lineHeight;
/** The authored bubble leaves this much room on its left (web max-w-[70%]). */
const BUBBLE_LEFT_INSET_PX = 40;
/** iOS sent-message bubble: continuous corners, tinted, no outline. */
const BUBBLE_RADIUS = 18;
const BUBBLE_TINT_ALPHA = 0.12;
/** iOS bubble width cap (the sent-message idiom leaves the left side free). */
const BUBBLE_MAX_WIDTH = "85%";

/**
 * The person's own message (web `UserConversationMessage`): a right-aligned
 * bubble with the markdown body (mentions as pills), the attachment strip,
 * and the steer label above it. Long bodies clamp at fifteen lines / the
 * char cap with a Show more toggle; long-press opens the message action
 * sheet on both platforms (a per-row SwiftUI context-menu host would pin
 * the recycled cell's size to its first measurement).
 */
export function AuthoredUserMessage({
  row,
  depth,
  projectId,
  expanded,
  onToggle,
}: AuthoredUserMessageProps) {
  const { tokens } = useTheme();
  const { presentMessageActions } = useTimelineRowHost();
  const { onThreadPress, onFilePress, resolveThreadMention, serverHostname } =
    useConversationMarkdownHandlers();
  const { items: attachmentItems, openImage } = useConversationAttachments(
    row.attachments,
    projectId,
  );
  const body = useMemo(
    () =>
      buildAuthoredMessageBody({
        expanded,
        initiator: row.initiator,
        mentions: row.mentions,
        text: row.text,
      }),
    [expanded, row.initiator, row.mentions, row.text],
  );
  const threadMentions = useMemo<MarkdownThreadMentions>(
    () => ({ mentions: body.mentions, resolveThread: resolveThreadMention }),
    [body.mentions, resolveThreadMention],
  );
  const messageText = row.text.trim();
  const editable = canEditUserMessage(row);
  const actionsTarget = useMemo(
    () => ({
      rowId: row.id,
      role: "user" as const,
      text: row.text,
      sourceSeqStart: row.sourceSeqStart,
      sourceSeqEnd: row.sourceSeqEnd,
      paragraph: null,
      editable,
      mentions: row.mentions,
      attachments: row.attachments,
    }),
    [
      editable,
      row.attachments,
      row.id,
      row.mentions,
      row.sourceSeqEnd,
      row.sourceSeqStart,
      row.text,
    ],
  );
  const onLongPress = useCallback(
    () => presentMessageActions(actionsTarget),
    [actionsTarget, presentMessageActions],
  );

  // Collapsed bodies clamp to a fixed height; whether that clamp hides
  // anything is a layout fact (blocks have margins), measured off the
  // unclamped content. Recycling state: a reused cell must not inherit the
  // previous message's measurement.
  const [overflowing, setOverflowing] = useRecyclingState(false, [row.id]);
  const handleBodyLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next =
        event.nativeEvent.layout.height > COLLAPSED_BODY_MAX_HEIGHT + 1;
      setOverflowing((current) => (current === next ? current : next));
    },
    [setOverflowing],
  );
  const showToggle = expanded || body.cappedByLength || overflowing;

  return (
    <View
      className="items-end py-1"
      style={{
        paddingLeft: timelineRowLeftPadding(depth) + BUBBLE_LEFT_INSET_PX,
        paddingRight: TIMELINE_ROW_HORIZONTAL_PADDING_PX,
      }}
      testID="timeline-row-conversation:user"
    >
      {row.turnRequest.kind === "steer" ? (
        <View className="mb-1 flex-row justify-end">
          <TurnRequestLabel
            turnRequest={row.turnRequest}
            icon="ArrowTurnForward"
          />
        </View>
      ) : null}
      <Pressable
        // Not an accessibility element of its own: the body text stays
        // reachable by screen readers and UI tests; long-press is a shortcut.
        accessible={false}
        onLongPress={onLongPress}
        delayLongPress={LONG_PRESS_DELAY_MS}
        className={
          IS_IOS
            ? "px-3.5 py-2.5 active:opacity-90"
            : "max-w-full rounded-xl border border-border-seam bg-surface-recessed px-3.5 py-2.5 active:opacity-90"
        }
        style={
          IS_IOS
            ? {
                maxWidth: BUBBLE_MAX_WIDTH,
                borderRadius: BUBBLE_RADIUS,
                borderCurve: "continuous",
                backgroundColor: withAlpha(tokens.primary, BUBBLE_TINT_ALPHA),
              }
            : undefined
        }
        testID="conversation-user-bubble"
      >
        {body.prefixText !== null ? (
          <Text className="text-sm text-muted-foreground" numberOfLines={1}>
            {body.prefixText.trimEnd()}
          </Text>
        ) : null}
        {messageText.length > 0 ? (
          <View
            style={
              expanded
                ? undefined
                : { maxHeight: COLLAPSED_BODY_MAX_HEIGHT, overflow: "hidden" }
            }
          >
            <View onLayout={handleBodyLayout}>
              {body.parseAsMarkdown ? (
                <Markdown
                  content={body.content}
                  textSize={PROSE_TEXT_SIZE}
                  promptMentions={body.mentions}
                  threadMentions={threadMentions}
                  selectable={false}
                  serverHostname={serverHostname}
                  onThreadPress={onThreadPress}
                  onFilePress={onFilePress}
                  onLongPress={onLongPress}
                />
              ) : (
                <Text variant={IS_IOS ? "bodyLarge" : "body"}>
                  {body.content}
                </Text>
              )}
            </View>
          </View>
        ) : (
          <Text className="text-sm text-muted-foreground">
            Sent attachments
          </Text>
        )}
        <ConversationAttachments
          align="end"
          filePaths={attachmentItems.filePaths}
          imageItems={attachmentItems.imageItems}
          onImagePress={openImage}
        />
        {showToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={onToggle}
            hitSlop={6}
            className="mt-1 self-end active:opacity-70"
            testID="conversation-user-overflow-toggle"
          >
            <Text variant="caption" className="font-medium">
              {expanded ? "Show less" : "Show more"}
            </Text>
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  );
}
