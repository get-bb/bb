import type { PromptDraftAttachment } from "@bb/client-core";
import { Image } from "expo-image";
import { Pressable, ScrollView, View } from "react-native";
import { useTheme } from "@/theme";
import { Icon, Spinner, Text } from "@/ui";
import type { PendingAttachment } from "./useComposerAttachments";

export interface AttachmentChipsProps {
  attachments: readonly PromptDraftAttachment[];
  pending: readonly PendingAttachment[];
  /** Local preview URIs for images uploaded from this device. */
  previewUriByPath: ReadonlyMap<string, string>;
  /** Remote URL for an uploaded attachment path (images without a local preview). */
  resolveImageUrl?: (attachment: PromptDraftAttachment) => string | null;
  onRemove: (path: string) => void;
  disabled?: boolean;
  testID?: string;
}

const THUMB = 56;

function ChipFrame({
  children,
  onRemove,
  label,
  testID,
}: {
  children: React.ReactNode;
  onRemove?: () => void;
  label: string;
  testID: string;
}) {
  const { tokens } = useTheme();
  return (
    <View
      testID={testID}
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: tokens.border,
        backgroundColor: tokens.surfaceRaisedSolid,
        paddingRight: onRemove ? 4 : 8,
        overflow: "hidden",
        maxWidth: 220,
      }}
    >
      {children}
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          testID={`${testID}-remove`}
          style={({ pressed }) => ({
            width: 24,
            height: 24,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? tokens.stateHover : "transparent",
          })}
        >
          <Icon name="X" size={14} color={tokens.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Horizontal strip of attached files (image thumbnails, file chips, uploads in flight). */
export function AttachmentChips({
  attachments,
  pending,
  previewUriByPath,
  resolveImageUrl,
  onRemove,
  disabled = false,
  testID = "composer-attachments",
}: AttachmentChipsProps) {
  const { tokens } = useTheme();
  if (attachments.length === 0 && pending.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 10 }}
      testID={testID}
    >
      {attachments.map((attachment, index) => {
        const isImage = attachment.type === "localImage";
        const uri = isImage
          ? (previewUriByPath.get(attachment.path) ??
            resolveImageUrl?.(attachment) ??
            null)
          : null;
        return (
          <ChipFrame
            key={attachment.path}
            label={attachment.name}
            onRemove={disabled ? undefined : () => onRemove(attachment.path)}
            testID={`${testID}-${index}`}
          >
            {isImage && uri ? (
              <Image
                source={{ uri }}
                style={{ width: THUMB, height: THUMB }}
                contentFit="cover"
                accessibilityLabel={attachment.name}
              />
            ) : (
              <View className="flex-row items-center gap-2 py-2 pl-2">
                <Icon
                  name={isImage ? "Eye" : "FileAttachment"}
                  size={16}
                  color={tokens.mutedForeground}
                />
                <Text variant="caption" numberOfLines={1} className="max-w-36">
                  {attachment.name}
                </Text>
              </View>
            )}
          </ChipFrame>
        );
      })}
      {pending.map((entry) => (
        <ChipFrame
          key={entry.id}
          label={`Uploading ${entry.name}`}
          testID={`${testID}-pending`}
        >
          {entry.previewUri ? (
            <View style={{ width: THUMB, height: THUMB }}>
              <Image
                source={{ uri: entry.previewUri }}
                style={{ width: THUMB, height: THUMB, opacity: 0.5 }}
                contentFit="cover"
              />
              <View
                style={{
                  position: "absolute",
                  inset: 0,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Spinner />
              </View>
            </View>
          ) : (
            <View className="flex-row items-center gap-2 py-2 pl-2">
              <Spinner />
              <Text variant="caption" numberOfLines={1} className="max-w-36">
                {entry.name}
              </Text>
            </View>
          )}
        </ChipFrame>
      ))}
    </ScrollView>
  );
}
