import type { PromptDraftAttachment } from "@bb/client-core";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";
import { haptic } from "@/lib/haptics";
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
/** The corner remove badge on an image thumbnail. */
const REMOVE_BUTTON = 20;
// The remove badge sits on the photograph, so it is black/white like the
// lightbox chrome (web `bg-black/55 text-white`), not a palette token: a
// white `xmark.circle.fill` over a soft shadow.
const REMOVE_BUTTON_FOREGROUND = "#ffffff";
const REMOVE_BUTTON_SHADOW = "0 1px 3px rgba(0, 0, 0, 0.4)";
const CHIP_ENTER_MS = 180;
const CHIP_EXIT_MS = 140;

/**
 * An image thumbnail with a small remove badge in its top-right corner. A
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
    <Animated.View
      entering={FadeIn.duration(CHIP_ENTER_MS)}
      exiting={FadeOut.duration(CHIP_EXIT_MS)}
      layout={LinearTransition.duration(CHIP_ENTER_MS)}
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
          borderCurve: "continuous",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: tokens.borderHairline,
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
            boxShadow: REMOVE_BUTTON_SHADOW,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Icon
            name="CircleX"
            symbol="xmark.circle.fill"
            size={REMOVE_BUTTON}
            color={REMOVE_BUTTON_FOREGROUND}
          />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

/** A file chip: capsule, hairline outline, optional remove. */
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
    <Animated.View
      entering={FadeIn.duration(CHIP_ENTER_MS)}
      exiting={FadeOut.duration(CHIP_EXIT_MS)}
      layout={LinearTransition.duration(CHIP_ENTER_MS)}
      testID={testID}
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: tokens.borderHairline,
        backgroundColor: tokens.surfaceRaisedSolid,
        paddingRight: onRemove ? 4 : 12,
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
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icon
            name="CircleX"
            symbol="xmark.circle.fill"
            size={16}
            color={tokens.mutedForeground}
          />
        </Pressable>
      ) : null}
    </Animated.View>
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
 * Chips fade in and out and the strip reflows as they come and go.
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
  const remove = (path: string) => {
    haptic("selection");
    onRemove(path);
  };

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
          const removeThis = disabled
            ? undefined
            : () => remove(attachment.path);
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
                onRemove={removeThis}
                testID={`${testID}-${index}`}
              />
            );
          }
          return (
            <ChipFrame
              key={attachment.path}
              label={attachment.name}
              onRemove={removeThis}
              testID={`${testID}-${index}`}
            >
              <View className="flex-row items-center gap-2 py-2 pl-3">
                <Icon
                  name={
                    attachment.type === "localImage" ? "Eye" : "FileAttachment"
                  }
                  symbol={
                    attachment.type === "localImage" ? "photo" : "doc.fill"
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
            <Animated.View
              key={entry.id}
              entering={FadeIn.duration(CHIP_ENTER_MS)}
              exiting={FadeOut.duration(CHIP_EXIT_MS)}
              layout={LinearTransition.duration(CHIP_ENTER_MS)}
              accessibilityLabel={`Uploading ${entry.name}`}
              testID={`${testID}-pending`}
              style={{
                width: THUMB,
                height: THUMB,
                borderRadius: THUMB_RADIUS,
                borderCurve: "continuous",
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: tokens.borderHairline,
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
            </Animated.View>
          ) : (
            <ChipFrame
              key={entry.id}
              label={`Uploading ${entry.name}`}
              testID={`${testID}-pending`}
            >
              <View className="flex-row items-center gap-2 py-2 pl-3">
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
