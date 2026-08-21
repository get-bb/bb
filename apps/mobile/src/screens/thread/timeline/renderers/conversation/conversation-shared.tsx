import { turnRequestLabel } from "@bb/client-core";
import type { PromptMentionResource } from "@bb/domain";
import type {
  TimelineConversationAttachments,
  TimelineConversationTurnRequest,
} from "@bb/server-contract";
import { useCallback, useMemo } from "react";
import { View } from "react-native";
import type {
  MarkdownImagePress,
  MarkdownLinkTarget,
  MarkdownLocalFileLink,
  MarkdownThreadMentionPress,
} from "@/markdown";
import { useTheme } from "@/theme";
import { Icon, ShimmerText, Text, type IconName } from "@/ui";
import { useTimelineRowHost } from "../../host/TimelineRowHostProvider";
import {
  buildAttachmentItems,
  type ConversationAttachmentItems,
} from "./conversation-model";

/**
 * The "steer" turn-request label under a user or generated message (web
 * `TurnRequestLabel`): nothing for plain messages, shimmering while a steer
 * is still pending.
 */
export function TurnRequestLabel({
  turnRequest,
  icon = "CornerDownRight",
}: {
  turnRequest: TimelineConversationTurnRequest;
  icon?: IconName;
}) {
  const { tokens } = useTheme();
  const label = turnRequestLabel(turnRequest);
  if (label === null) return null;
  const pending =
    turnRequest.kind === "steer" && turnRequest.status === "pending";
  return (
    <View
      className="flex-row items-center gap-1"
      testID="conversation-turn-request"
    >
      <Icon name={icon} size={12} color={tokens.mutedForeground} />
      {pending ? (
        <ShimmerText variant="caption">{label}</ShimmerText>
      ) : (
        <Text variant="caption">{label}</Text>
      )}
    </View>
  );
}

/**
 * Attachment items for a message plus the lightbox opener for its images,
 * resolved against the active profile's server.
 */
export function useConversationAttachments(
  attachments: TimelineConversationAttachments | null,
  projectId: string,
): {
  items: ConversationAttachmentItems;
  openImage: (index: number) => void;
} {
  const { serverUrl, threadId, openImageLightbox } = useTimelineRowHost();
  const items = useMemo(
    () =>
      buildAttachmentItems({
        attachments,
        projectId: projectId.length > 0 ? projectId : null,
        serverUrl,
        threadId,
      }),
    [attachments, projectId, serverUrl, threadId],
  );
  const openImage = useCallback(
    (index: number) => {
      const loadable = items.imageItems.flatMap((item) =>
        item.src === null ? [] : [{ src: item.src, alt: item.alt }],
      );
      const tapped = items.imageItems[index];
      const start =
        tapped?.src == null
          ? 0
          : loadable.findIndex((image) => image.src === tapped.src);
      openImageLightbox(loadable, Math.max(start, 0));
    },
    [items.imageItems, openImageLightbox],
  );
  return { items, openImage };
}

interface ConversationMarkdownHandlers {
  onThreadPress: (mention: MarkdownThreadMentionPress) => void;
  onImagePress: (image: MarkdownImagePress) => void;
  /** Absolute local file links open the file preview. */
  onFilePress: (link: MarkdownLocalFileLink) => void;
  /** Relative `path[:line]` references open the preview (root picker when ambiguous). */
  onLinkPress: (link: MarkdownLinkTarget) => boolean;
  resolveThreadMention: (threadId: string) => PromptMentionResource | null;
  /** Hostname the profile reaches the server on (localhost link rewrite). */
  serverHostname: string | undefined;
}

/** Stable markdown callbacks shared by every conversation body. */
export function useConversationMarkdownHandlers(): ConversationMarkdownHandlers {
  const {
    openThread,
    openImageLightbox,
    openLocalFileLink,
    onMarkdownLinkPress,
    resolveThreadMention,
    serverUrl,
  } = useTimelineRowHost();
  const onThreadPress = useCallback(
    (mention: MarkdownThreadMentionPress) => openThread(mention.threadId),
    [openThread],
  );
  const onImagePress = useCallback(
    (image: MarkdownImagePress) =>
      openImageLightbox([{ src: image.src, alt: image.alt }], 0),
    [openImageLightbox],
  );
  const serverHostname = useMemo(() => {
    try {
      return new URL(serverUrl).hostname;
    } catch {
      return undefined;
    }
  }, [serverUrl]);
  return {
    onThreadPress,
    onImagePress,
    onFilePress: openLocalFileLink,
    onLinkPress: onMarkdownLinkPress,
    resolveThreadMention,
    serverHostname,
  };
}
