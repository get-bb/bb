import type { PromptDraftAttachment } from "@bb/client-core";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import {
  ImageLightbox,
  openLightbox,
  stepLightbox,
  type LightboxImage,
  type LightboxState,
} from "@/screens/thread/timeline";
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

const THUMB = 64;
const THUMB_RADIUS = 12;
/** The corner remove button on an image thumbnail. */
const REMOVE_BUTTON = 20;
// The remove button sits on the photograph, so it is black/white like the
// lightbox chrome (web `bg-black/55 text-white`), not a palette token.
const REMOVE_BUTTON_BACKGROUND = "rgba(0, 0, 0, 0.6)";
const REMOVE_BUTTON_PRESSED_BACKGROUND = "rgba(0, 0, 0, 0.8)";
const REMOVE_BUTTON_FOREGROUND = "#ffffff";

/**
 * An image thumbnail with a small remove button in its top-right corner. A
 * tap on the picture opens the lightbox.
 */
function ImageChip({
  uri,
  label,
  onPress,
  onRemove,
  testID,
}: {
  uri: string;
  label: string;
  onPress: () => void;
  onRemove?: () => void;
  testID: string;
}) {
  const { tokens } = useTheme();
  return (
    <View
      testID={testID}
      accessibilityLabel={label}
      style={{ width: THUMB, height: THUMB }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="imagebutton"
        accessibilityLabel={`Preview ${label}`}
        testID={`${testID}-preview`}
        style={({ pressed }) => ({
          width: THUMB,
          height: THUMB,
          borderRadius: THUMB_RADIUS,
          borderWidth: 1,
          borderColor: tokens.border,
          backgroundColor: tokens.surfaceRaisedSolid,
          overflow: "hidden",
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Image
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          accessible={false}
        />
      </Pressable>
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          testID={`${testID}-remove`}
          style={({ pressed }) => ({
            position: "absolute",
            top: 4,
            right: 4,
            width: REMOVE_BUTTON,
            height: REMOVE_BUTTON,
            borderRadius: REMOVE_BUTTON / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed
              ? REMOVE_BUTTON_PRESSED_BACKGROUND
              : REMOVE_BUTTON_BACKGROUND,
          })}
        >
          <Icon name="X" size={12} color={REMOVE_BUTTON_FOREGROUND} />
        </Pressable>
      ) : null}
    </View>
  );
}

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

interface ResolvedAttachment {
  attachment: PromptDraftAttachment;
  /** Loadable image URI; null for files and for images without a source. */
  uri: string | null;
}

/**
 * Horizontal strip of attached files (image thumbnails, file chips, uploads
 * in flight). Image thumbnails open the same lightbox as timeline images.
 */
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
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  if (attachments.length === 0 && pending.length === 0) return null;

  const resolved: ResolvedAttachment[] = attachments.map((attachment) => ({
    attachment,
    uri:
      attachment.type === "localImage"
        ? (previewUriByPath.get(attachment.path) ??
          resolveImageUrl?.(attachment) ??
          null)
        : null,
  }));
  const lightboxImages: LightboxImage[] = resolved.flatMap(
    ({ attachment, uri }) =>
      uri === null ? [] : [{ src: uri, alt: attachment.name }],
  );

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          gap: 8,
          paddingHorizontal: 12,
          paddingTop: 10,
        }}
        testID={testID}
      >
        {resolved.map(({ attachment, uri }, index) => {
          const remove = disabled
            ? undefined
            : () => onRemove(attachment.path);
          if (uri !== null) {
            const imageIndex = lightboxImages.findIndex(
              (image) => image.src === uri,
            );
            return (
              <ImageChip
                key={attachment.path}
                uri={uri}
                label={attachment.name}
                onPress={() =>
                  setLightbox(openLightbox(lightboxImages, imageIndex))
                }
                onRemove={remove}
                testID={`${testID}-${index}`}
              />
            );
          }
          return (
            <ChipFrame
              key={attachment.path}
              label={attachment.name}
              onRemove={remove}
              testID={`${testID}-${index}`}
            >
              <View className="flex-row items-center gap-2 py-2 pl-2">
                <Icon
                  name={
                    attachment.type === "localImage" ? "Eye" : "FileAttachment"
                  }
                  size={16}
                  color={tokens.mutedForeground}
                />
                <Text variant="caption" numberOfLines={1} className="max-w-36">
                  {attachment.name}
                </Text>
              </View>
            </ChipFrame>
          );
        })}
        {pending.map((entry) =>
          entry.previewUri ? (
            <View
              key={entry.id}
              accessibilityLabel={`Uploading ${entry.name}`}
              testID={`${testID}-pending`}
              style={{
                width: THUMB,
                height: THUMB,
                borderRadius: THUMB_RADIUS,
                borderWidth: 1,
                borderColor: tokens.border,
                backgroundColor: tokens.surfaceRaisedSolid,
                overflow: "hidden",
              }}
            >
              <Image
                source={{ uri: entry.previewUri }}
                style={{ width: "100%", height: "100%", opacity: 0.5 }}
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
            <ChipFrame
              key={entry.id}
              label={`Uploading ${entry.name}`}
              testID={`${testID}-pending`}
            >
              <View className="flex-row items-center gap-2 py-2 pl-2">
                <Spinner />
                <Text variant="caption" numberOfLines={1} className="max-w-36">
                  {entry.name}
                </Text>
              </View>
            </ChipFrame>
          ),
        )}
      </ScrollView>
      <ImageLightbox
        state={lightbox}
        onClose={() => setLightbox(null)}
        onStep={(direction) =>
          setLightbox((current) =>
            current === null ? current : stepLightbox(current, direction),
          )
        }
      />
    </>
  );
}
