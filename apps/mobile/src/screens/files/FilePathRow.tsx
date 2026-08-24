import { memo } from "react";
import { Pressable, View } from "react-native";
import { buildHighlightSegments, splitPathForRow } from "@/data/files";
import { useTheme } from "@/theme";
import { cn, Icon, LONG_PRESS_DELAY_MS, Text, type IconName } from "@/ui";

interface FilePathRowProps {
  /** Root-relative (or absolute) path shown split into name + directory. */
  path: string;
  /** Match offsets in `path` to highlight (fuzzy search / filter). */
  positions?: readonly number[];
  icon?: IconName;
  /** Right-aligned hint (e.g. "3 files" for a directory, "Workspace" for a recent). */
  trailingText?: string;
  trailing?: "chevron" | null;
  onPress: () => void;
  onLongPress?: () => void;
  testID?: string;
}

/**
 * A file (or directory) row: name on the first line, directory on the
 * second, both with the matched characters emphasized. Long-press is the
 * copy menu.
 */
export const FilePathRow = memo(function FilePathRow({
  path,
  positions = [],
  icon = "File",
  trailingText,
  trailing = null,
  onPress,
  onLongPress,
  testID,
}: FilePathRowProps) {
  const { tokens } = useTheme();
  const { directory, name } = splitPathForRow(path);
  const nameOffset = path.length - name.length;
  const namePositions = positions
    .filter((position) => position >= nameOffset)
    .map((position) => position - nameOffset);
  const directoryPositions = positions.filter(
    (position) => position < directory.length,
  );
  const nameSegments = buildHighlightSegments(name, namePositions);
  const directorySegments = buildHighlightSegments(
    directory,
    directoryPositions,
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={path}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_DELAY_MS}
      testID={testID}
      className="min-h-[44px] flex-row items-center gap-3 px-4 py-2 active:bg-state-hover"
    >
      <Icon
        name={icon}
        size={18}
        color={
          icon.startsWith("Folder") ? tokens.fileAccent : tokens.mutedForeground
        }
      />
      <View className="min-w-0 flex-1">
        <Text className="text-sm text-foreground" numberOfLines={1}>
          {nameSegments.map((segment, index) => (
            <Text
              key={index}
              className={cn(
                "text-sm",
                segment.matched
                  ? "font-semibold text-primary"
                  : "text-foreground",
              )}
            >
              {segment.text}
            </Text>
          ))}
        </Text>
        {directory.length > 0 ? (
          <Text variant="caption" numberOfLines={1}>
            {directorySegments.map((segment, index) => (
              <Text
                key={index}
                variant="caption"
                className={cn(segment.matched && "font-semibold text-primary")}
              >
                {segment.text}
              </Text>
            ))}
          </Text>
        ) : null}
      </View>
      {trailingText ? (
        <Text variant="caption" numberOfLines={1}>
          {trailingText}
        </Text>
      ) : null}
      {trailing === "chevron" ? (
        <Icon name="ChevronRight" size={16} color={tokens.mutedForeground} />
      ) : null}
    </Pressable>
  );
});
