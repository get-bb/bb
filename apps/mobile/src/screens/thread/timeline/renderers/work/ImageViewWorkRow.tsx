import { fileNameFromPath } from "@bb/thread-view";
import { Image, type ImageLoadEventData } from "expo-image";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { buildThreadHostFileContentUrl } from "@/data/thread-detail/file-content-urls";
import { useTheme } from "@/theme";
import { EmptyStatePanel, Text } from "@/ui";
import { useTimelineRowHost } from "../../host/TimelineRowHostProvider";
import type { TimelineRowRendererProps } from "../../renderers";
import { WorkRowShell } from "./WorkRowShell";

/** Web `max-w-96` / placeholder height before the intrinsic size is known. */
const MAX_IMAGE_WIDTH = 384;
const PENDING_IMAGE_HEIGHT = 160;
const MAX_IMAGE_HEIGHT = 384;

/**
 * `work:image-view`: the image the agent looked at, served by the profile's
 * server from the thread host (`/threads/:id/host-files/content`; the
 * shared cookie jar carries bb connect auth), tap → the timeline's shared
 * lightbox. Load failures show the path instead. Auto-expands while it is
 * the live frontier.
 */
export function ImageViewWorkRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps<"work:image-view">) {
  const row = item.row;
  const { serverUrl } = useTimelineRowHost();
  const uri = buildThreadHostFileContentUrl(serverUrl, row.threadId, row.path);
  return (
    <WorkRowShell
      item={item}
      expandable={item.expandable}
      expanded={expanded}
      onToggle={onToggle}
    >
      <ImageViewBody
        // Remount when the source or the row's settled state changes so a
        // failed load gets a fresh start (web resets its state the same way).
        key={`${uri}|${row.status}|${row.completedAt ?? ""}`}
        uri={uri}
        path={row.path}
      />
    </WorkRowShell>
  );
}

function ImageViewBody({ uri, path }: { uri: string; path: string }) {
  const { tokens } = useTheme();
  const { openImageLightbox } = useTimelineRowHost();
  const [failed, setFailed] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const imageName = fileNameFromPath(path);
  const title = `Viewed image: ${imageName}`;

  const handleLoad = useCallback((event: ImageLoadEventData) => {
    const { width, height } = event.source;
    if (width > 0 && height > 0) setAspectRatio(width / height);
  }, []);

  if (failed) {
    return (
      <View testID="timeline-image-view-unavailable">
        <EmptyStatePanel className="py-4">
          <Text className="text-center text-sm text-muted-foreground">
            Image preview unavailable.
          </Text>
          <Text
            variant="mono"
            tone="muted"
            className="pt-1 text-center text-xs"
          >
            {path}
          </Text>
        </EmptyStatePanel>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={`Open image preview: ${imageName}`}
      onPress={() => openImageLightbox([{ src: uri, alt: title }], 0)}
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        width: "100%",
        maxWidth: MAX_IMAGE_WIDTH,
        opacity: pressed ? 0.85 : 1,
      })}
      testID="timeline-image-view"
    >
      <View
        style={{
          width: "100%",
          maxHeight: MAX_IMAGE_HEIGHT,
          aspectRatio: aspectRatio ?? undefined,
          height: aspectRatio === null ? PENDING_IMAGE_HEIGHT : undefined,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: tokens.border,
          overflow: "hidden",
          backgroundColor: tokens.surfaceRecessed,
        }}
      >
        <Image
          source={{ uri }}
          contentFit="contain"
          style={{ width: "100%", height: "100%" }}
          onLoad={handleLoad}
          onError={() => setFailed(true)}
          accessible={false}
          transition={120}
        />
      </View>
    </Pressable>
  );
}
