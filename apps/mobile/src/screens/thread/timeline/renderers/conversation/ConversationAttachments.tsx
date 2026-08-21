import { Image } from "expo-image";
import { Pressable, View } from "react-native";
import { fileNameFromPath } from "@bb/thread-view";
import { useTheme } from "@/theme";
import { cn, Icon, Text } from "@/ui";
import type { ConversationAttachmentItems } from "./conversation-model";

export interface ConversationAttachmentsProps extends ConversationAttachmentItems {
  /** `end` inside the authored bubble, `start` under generated/agent bodies. */
  align: "start" | "end";
  /** Tapping an image thumbnail (index into `imageItems`). */
  onImagePress: (index: number) => void;
}

/**
 * The attachment strip under a message (web `ConversationAttachments`):
 * image thumbnails that open the lightbox, and file chips. Chips are inert
 * until the file preview screen lands (Phase 6); an image the phone cannot
 * load (absolute path on a host without the route) renders as a chip too.
 */
export function ConversationAttachments({
  align,
  filePaths,
  imageItems,
  onImagePress,
}: ConversationAttachmentsProps) {
  const { tokens } = useTheme();
  if (filePaths.length === 0 && imageItems.length === 0) return null;
  const justify = align === "end" ? "justify-end" : "justify-start";
  const chipClass = cn(
    "max-w-full flex-row items-center gap-1 rounded-full border px-2 py-0.5",
    align === "end"
      ? "border-surface-selected-border bg-surface-raised"
      : "border-border bg-surface-recessed",
  );
  return (
    <View className="mt-2 gap-2" testID="conversation-attachments">
      {imageItems.length > 0 ? (
        <View className={cn("flex-row flex-wrap gap-2", justify)}>
          {imageItems.map((item, index) =>
            item.src === null ? (
              <View key={`${item.source}-${index}`} className={chipClass}>
                <Icon name="File" size={12} color={tokens.mutedForeground} />
                <Text variant="caption" numberOfLines={1}>
                  {item.alt}
                </Text>
              </View>
            ) : (
              <Pressable
                key={`${item.src}-${index}`}
                accessibilityRole="imagebutton"
                accessibilityLabel={item.alt || "Attached image"}
                onPress={() => onImagePress(index)}
                className={cn(
                  "overflow-hidden rounded-md border active:opacity-80",
                  align === "end"
                    ? "border-surface-selected-border bg-surface-raised"
                    : "border-border bg-surface-recessed",
                )}
                style={
                  align === "end"
                    ? { height: 80, width: 120 }
                    : { height: 64, width: 96 }
                }
                testID="conversation-attachment-image"
              >
                <Image
                  source={{ uri: item.src }}
                  contentFit="cover"
                  style={{ width: "100%", height: "100%" }}
                  accessible={false}
                  transition={100}
                />
              </Pressable>
            ),
          )}
        </View>
      ) : null}
      {filePaths.length > 0 ? (
        <View className={cn("flex-row flex-wrap gap-1.5", justify)}>
          {filePaths.map((path) => (
            <View
              key={path}
              className={chipClass}
              accessibilityLabel={path}
              testID="conversation-attachment-file"
            >
              <Icon
                name="FileAttachment"
                size={12}
                color={tokens.mutedForeground}
              />
              <Text variant="caption" numberOfLines={1}>
                {fileNameFromPath(path)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
