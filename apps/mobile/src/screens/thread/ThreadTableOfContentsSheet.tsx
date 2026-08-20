import { useWindowDimensions, View } from "react-native";
import { ListRow, Sheet, Text, type SheetController } from "@/ui";
import type { TimelineTableOfContentsEntry } from "./timeline";

export interface ThreadTableOfContentsSheetProps {
  controller: SheetController;
  entries: readonly TimelineTableOfContentsEntry[];
  onSelect: (entry: TimelineTableOfContentsEntry) => void;
}

/**
 * The user's messages in order; picking one scrolls the timeline to it.
 * Lists the loaded window only (older pages join as they are scrolled in).
 */
export function ThreadTableOfContentsSheet({
  controller,
  entries,
  onSelect,
}: ThreadTableOfContentsSheetProps) {
  const { height } = useWindowDimensions();
  return (
    <Sheet
      controller={controller}
      title="Contents"
      layout="scroll"
      maxDynamicContentSize={Math.round(height * 0.75)}
    >
      {entries.length === 0 ? (
        <View className="px-4 py-6">
          <Text variant="caption" className="text-center">
            No messages yet.
          </Text>
        </View>
      ) : (
        entries.map((entry, index) => (
          <ListRow
            key={entry.key}
            title={entry.preview}
            titleLines={2}
            leading={
              <Text variant="chrome" className="w-6 text-right">
                {index + 1}
              </Text>
            }
            onPress={() => {
              controller.dismiss();
              onSelect(entry);
            }}
            testID={`thread-toc-entry-${index}`}
          />
        ))
      )}
    </Sheet>
  );
}
