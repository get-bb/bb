import type { WorkspaceDiffTarget } from "@bb/domain";
import type { DiffFileEntry } from "@bb/server-contract";
import { formatDiffCount } from "@bb/thread-view";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { describeDiffTarget } from "@/data/diff";
import { useTheme } from "@/theme";
import { cn, Icon, Spinner, Text, type IconName } from "@/ui";

interface DiffTabHeaderProps {
  files: readonly DiffFileEntry[];
  /** The TOC holds only the leading slice of a larger diff. */
  truncated: boolean;
  target: WorkspaceDiffTarget;
  onPickTarget: () => void;
  targetDisabled: boolean;
  areAllCollapsed: boolean;
  onToggleCollapseAll: () => void;
  collapseDisabled: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  refreshDisabled: boolean;
}

/**
 * Totals from the TOC (the same `--numstat` the shortstat summarizes), so
 * the pills are exact without any patch text in hand.
 */
function summarizeDiffFiles(files: readonly DiffFileEntry[]): {
  fileCount: number;
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return { fileCount: files.length, additions, deletions };
}

function IconButton({
  icon,
  label,
  onPress,
  disabled,
  busy,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled: boolean;
  busy?: boolean;
  testID: string;
}) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy }}
      className={cn(
        "h-8 w-8 items-center justify-center rounded-md active:bg-state-hover",
        disabled && "opacity-40",
      )}
      testID={testID}
    >
      {busy ? (
        <Spinner size="small" />
      ) : (
        <Icon name={icon} size={16} color={tokens.mutedForeground} />
      )}
    </Pressable>
  );
}

/**
 * The diff tab's toolbar: file count and +/- totals, the target picker
 * trigger, collapse-all / expand-all, refresh.
 */
export function DiffTabHeader({
  files,
  truncated,
  target,
  onPickTarget,
  targetDisabled,
  areAllCollapsed,
  onToggleCollapseAll,
  collapseDisabled,
  onRefresh,
  refreshing,
  refreshDisabled,
}: DiffTabHeaderProps) {
  const { tokens } = useTheme();
  const stats = useMemo(() => summarizeDiffFiles(files), [files]);
  return (
    <View
      className="flex-row items-center gap-2 border-b border-border-hairline px-4 py-2"
      testID="diff-tab-header"
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
        <Pressable
          onPress={onPickTarget}
          disabled={targetDisabled}
          accessibilityRole="button"
          accessibilityLabel={`Diff target: ${describeDiffTarget(target)}`}
          className={cn(
            "h-8 min-w-0 shrink flex-row items-center gap-1 rounded-md border border-border bg-background px-2 active:bg-state-hover",
            targetDisabled && "opacity-40",
          )}
          testID="diff-tab-target"
        >
          <Text className="min-w-0 shrink text-xs" numberOfLines={1}>
            {describeDiffTarget(target)}
          </Text>
          <Icon name="ChevronDown" size={12} color={tokens.mutedForeground} />
        </Pressable>
        <View
          className="shrink-0 flex-row items-center gap-1"
          accessibilityLabel={`${stats.fileCount} files, ${stats.additions} additions, ${stats.deletions} deletions`}
          testID="diff-tab-stats"
        >
          <Text variant="caption" numberOfLines={1}>
            {stats.fileCount === 1 ? "1 file" : `${stats.fileCount} files`}
            {truncated ? "+" : ""}
          </Text>
          {stats.additions > 0 ? (
            <Text className="text-xs text-diff-added" testID="diff-tab-added">
              +{formatDiffCount(stats.additions)}
            </Text>
          ) : null}
          {stats.deletions > 0 ? (
            <Text
              className="text-xs text-diff-removed"
              testID="diff-tab-removed"
            >
              -{formatDiffCount(stats.deletions)}
            </Text>
          ) : null}
        </View>
      </View>
      <IconButton
        icon={areAllCollapsed ? "ChevronsDown" : "ChevronsUp"}
        label={areAllCollapsed ? "Expand all files" : "Collapse all files"}
        onPress={onToggleCollapseAll}
        disabled={collapseDisabled}
        testID="diff-tab-collapse-all"
      />
      <IconButton
        icon="RotateCcw"
        label="Refresh diff"
        onPress={onRefresh}
        disabled={refreshDisabled}
        busy={refreshing}
        testID="diff-tab-refresh"
      />
    </View>
  );
}
