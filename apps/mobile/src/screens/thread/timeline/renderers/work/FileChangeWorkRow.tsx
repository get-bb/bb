import { Pressable, ScrollView, View } from "react-native";
import { TERMINAL_FONT_SIZE, TERMINAL_LINE_HEIGHT } from "@/ansi";
import { displayDiffPath, FileChangeDiffBlock } from "@/diff";
import { useTheme } from "@/theme";
import { Icon, Text } from "@/ui";
// Leaf import (not the panel barrel, which pulls in every tab content).
import { useOptionalPanel } from "../../../../panel/PanelProvider";
import { useTimelineRowHost } from "../../host/TimelineRowHostProvider";
import type { TimelineRowRendererProps } from "../../renderers";
import { WorkRowShell } from "./WorkRowShell";

/**
 * `work:file-change`: title (action verb + file path, `+N -M` diff stats)
 * over the native diff card built from `change.diff` through the client-core
 * renderable-patch rules, plus the provider's stderr when it reported any,
 * and — when a workspace panel hosts this screen — an "Open in Diff tab"
 * action that focuses the file's current diff. Rows inside a closed step take
 * the muted summary title tone; every file-change row starts collapsed (it
 * never auto-expands).
 */
export function FileChangeWorkRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps<"work:file-change">) {
  const row = item.row;
  const { workspaceRootPath } = useTimelineRowHost();
  const panel = useOptionalPanel();
  const { tokens } = useTheme();
  return (
    <WorkRowShell
      item={item}
      expandable={item.expandable}
      expanded={expanded}
      onToggle={onToggle}
    >
      <View className="gap-2">
        <FileChangeDiffBlock
          change={row.change}
          workspaceRootPath={workspaceRootPath}
          testID="timeline-file-change-diff"
        />
        {row.stderr ? (
          <ScrollView
            horizontal
            bounces={false}
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
            className="rounded-md border border-surface-destructive-border bg-surface-destructive"
            contentContainerStyle={{
              flexGrow: 1,
              paddingHorizontal: 8,
              paddingVertical: 6,
            }}
            testID="timeline-file-change-stderr"
          >
            <Text
              variant="mono"
              tone="destructive"
              style={{
                fontSize: TERMINAL_FONT_SIZE,
                lineHeight: TERMINAL_LINE_HEIGHT,
              }}
            >
              {row.stderr}
            </Text>
          </ScrollView>
        ) : null}
        {panel ? (
          <Pressable
            onPress={() =>
              panel.openDiff(
                displayDiffPath(row.change.path, workspaceRootPath),
              )
            }
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Open in Diff tab"
            className="flex-row items-center gap-1.5 self-start rounded-md px-1 py-0.5 active:bg-state-hover"
            testID="timeline-file-change-open-diff"
          >
            <Icon name="FileDiff" size={14} color={tokens.mutedForeground} />
            <Text variant="chrome" tone="primary">
              Open in Diff tab
            </Text>
          </Pressable>
        ) : null}
      </View>
    </WorkRowShell>
  );
}
