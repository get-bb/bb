import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { Button, EmptyStatePanel, Icon, Spinner, Text } from "@/ui";
import { ImageLightbox } from "../thread/timeline/lightbox/ImageLightbox";
import {
  openLightbox,
  type LightboxState,
} from "../thread/timeline/lightbox/lightbox-model";

interface ImageFilePreviewBodyProps {
  /** Loadable URL: a `data:` URL (workspace files) or a content route (cookies). */
  url: string;
  name: string;
  testID?: string;
}

/** The image fitted to the viewport; tap for the pinch-zoom lightbox. */
export function ImageFilePreviewBody({
  url,
  name,
  testID,
}: ImageFilePreviewBodyProps) {
  const { tokens } = useTheme();
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  return (
    <View className="flex-1" testID={testID}>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={name}
        onPress={() => setLightbox(openLightbox([{ src: url, alt: name }], 0))}
        className="flex-1 items-center justify-center p-3"
        testID="file-preview-image"
      >
        {failed ? (
          <EmptyStatePanel>Could not decode this image.</EmptyStatePanel>
        ) : (
          <Image
            source={{ uri: url }}
            contentFit="contain"
            style={{
              width: "100%",
              height: "100%",
              backgroundColor: tokens.surfaceRecessedSolid,
              borderRadius: 8,
            }}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setFailed(true);
            }}
          />
        )}
        {loading && !failed ? (
          <View
            pointerEvents="none"
            className="absolute inset-0 items-center justify-center"
          >
            <Spinner />
          </View>
        ) : null}
      </Pressable>
      <ImageLightbox
        state={lightbox}
        onClose={() => setLightbox(null)}
        onStep={() => undefined}
      />
    </View>
  );
}

interface VideoFilePreviewBodyProps {
  mimeType: string;
  /** Null when the bytes only exist inline (no external URL to hand off). */
  externalUrl: string | null;
  onOpenExternally: () => void;
  testID?: string;
}

/**
 * Video playback is not bundled in this build (no expo-av / expo-video), so
 * the body is a hand-off card to the system player via the raw route URL.
 */
export function VideoFilePreviewBody({
  mimeType,
  externalUrl,
  onOpenExternally,
  testID,
}: VideoFilePreviewBodyProps) {
  const { tokens } = useTheme();
  return (
    <View
      className="flex-1 items-center justify-center gap-4 p-6"
      testID={testID}
    >
      <Icon name="Play" size={40} color={tokens.mutedForeground} />
      <Text className="text-center text-sm text-muted-foreground">
        Video ({mimeType}) opens outside the app.
      </Text>
      {externalUrl !== null ? (
        <Button icon="ExternalLink" onPress={onOpenExternally}>
          Open video
        </Button>
      ) : (
        <Text variant="caption" className="text-center">
          This source has no shareable URL.
        </Text>
      )}
    </View>
  );
}
