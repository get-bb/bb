import type { WorkspaceDiffTarget } from "@bb/domain";
import type { DiffFileEntry } from "@bb/server-contract";
import { formatDiffCount } from "@bb/thread-view";
import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { describeDiffTarget } from "@/data/diff";
import { useTheme } from "@/theme";
import { Icon, Spinner, Text, type IconName } from "@/ui";

/** The target capsule. */
const TRIGGER_HEIGHT = 32;
const ICON_BUTTON_SIZE = 32;

interface DiffTabHeaderProps {
  files: readonly DiffFileEntry[];
  /** The TOC holds only the leading slice of a larger diff. */
  truncated: boolean;
  target: WorkspaceDiffTarget;
  /** Presents the target picker sheet (`DiffTargetPickerSheet`). */
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
 * the tallies are exact without any patch text in hand.
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

/** A tinted bar-button glyph (32pt). */
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
      style={({ pressed }) => [
        styles.iconButton,
        { opacity: disabled ? 0.35 : pressed ? 0.5 : 1 },
      ]}
      testID={testID}
    >
      {busy ? (
        <Spinner size="small" />
      ) : (
        <Icon name={icon} size={20} color={tokens.primary} />
      )}
    </Pressable>
  );
}

/**
 * The diff tab's toolbar: the target capsule (a pressable that presents the
 * target picker sheet on both platforms — it shows text, so it is not a
 * native-menu trigger; see `NativeMenu`), file count and +/- totals in
 * tabular figures, collapse-all / expand-all, refresh.
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
  const label = describeDiffTarget(target);
  return (
    <View
      style={[styles.header, { borderBottomColor: tokens.borderHairline }]}
      testID="diff-tab-header"
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-2">
        <Pressable
          onPress={onPickTarget}
          disabled={targetDisabled}
          accessibilityRole="button"
          accessibilityLabel={`Diff target: ${label}`}
          accessibilityState={{ disabled: targetDisabled }}
          style={({ pressed }) => [
            styles.trigger,
            {
              backgroundColor: pressed ? tokens.stateActive : tokens.secondary,
              opacity: targetDisabled ? 0.4 : 1,
            },
          ]}
          testID="diff-tab-target"
        >
          <Text variant="label" numberOfLines={1} className="min-w-0 shrink">
            {label}
          </Text>
          <Icon
            name="ChevronDown"
            symbol="chevron.up.chevron.down"
            size={12}
            weight="semibold"
            color={tokens.mutedForeground}
          />
        </Pressable>
        <View
          className="shrink-0 flex-row items-center gap-1.5"
          accessibilityLabel={`${stats.fileCount} files, ${stats.additions} additions, ${stats.deletions} deletions`}
          testID="diff-tab-stats"
        >
          <Text variant="footnote" tone="muted" numeric numberOfLines={1}>
            {stats.fileCount === 1 ? "1 file" : `${stats.fileCount} files`}
            {truncated ? "+" : ""}
          </Text>
          {stats.additions > 0 ? (
            <Text
              variant="footnote"
              numeric
              style={{ color: tokens.success }}
              testID="diff-tab-added"
            >
              +{formatDiffCount(stats.additions)}
            </Text>
          ) : null}
          {stats.deletions > 0 ? (
            <Text
              variant="footnote"
              numeric
              style={{ color: tokens.destructiveText }}
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

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trigger: {
    minWidth: 0,
    flexShrink: 1,
    height: TRIGGER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 12,
    paddingRight: 8,
    borderRadius: TRIGGER_HEIGHT / 2,
    borderCurve: "continuous",
  },
  iconButton: {
    width: ICON_BUTTON_SIZE,
    height: ICON_BUTTON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
});
