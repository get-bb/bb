import { Image, type ImageLoadEventData } from "expo-image";
import { memo, useState } from "react";
import { Pressable, Text as RNText, View } from "react-native";
import { FONT_FAMILIES } from "@/theme/fonts";
import { nativeTypography } from "@/theme/theme.native";
import { useMarkdownContext } from "./MarkdownContext";

export interface MarkdownImageProps {
  src: string;
  alt: string;
}

/** Web `max-h-96`. */
const MAX_IMAGE_HEIGHT = 384;
/** Placeholder height until the intrinsic size is known. */
const PENDING_IMAGE_HEIGHT = 160;

/**
 * Block image: full width, natural aspect ratio once loaded (capped at
 * `MAX_IMAGE_HEIGHT`), tap → `onImagePress` for the lightbox. Source
 * resolution (cookies, headers, local file routes) is the host's job via
 * `resolveImageSource`; a null resolution renders the alt text.
 */
export const MarkdownImage = memo(function MarkdownImage({
  src,
  alt,
}: MarkdownImageProps) {
  const ctx = useMarkdownContext();
  const { tokens } = ctx;
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const source = ctx.resolveImageSource
    ? ctx.resolveImageSource(src)
    : { uri: src };

  if (source === null || failed) {
    return (
      <RNText
        style={{
          fontFamily: FONT_FAMILIES.sans.regular,
          fontWeight: "400",
          fontSize: nativeTypography.xs.fontSize,
          lineHeight: nativeTypography.xs.lineHeight,
          color: tokens.mutedForeground,
        }}
      >
        [Image: {alt.length > 0 ? alt : "image"}]
      </RNText>
    );
  }

  const onImagePress = ctx.onImagePress;
  const handleLoad = (event: ImageLoadEventData) => {
    const { width, height } = event.source;
    if (width > 0 && height > 0) {
      setAspectRatio(width / height);
    }
  };

  return (
    <Pressable
      accessibilityRole={onImagePress ? "imagebutton" : "image"}
      accessibilityLabel={alt.length > 0 ? alt : "Image"}
      disabled={onImagePress === undefined}
      onPress={() => onImagePress?.({ src, alt })}
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        width: "100%",
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: "100%",
          maxHeight: MAX_IMAGE_HEIGHT,
          aspectRatio: aspectRatio ?? undefined,
          height: aspectRatio === null ? PENDING_IMAGE_HEIGHT : undefined,
          borderRadius: 6,
          overflow: "hidden",
          backgroundColor: tokens.surfaceRecessed,
        }}
      >
        <Image
          source={source}
          contentFit="contain"
          contentPosition="left center"
          style={{ width: "100%", height: "100%" }}
          onLoad={handleLoad}
          onError={() => setFailed(true)}
          accessible={false}
          transition={120}
        />
      </View>
    </Pressable>
  );
});
