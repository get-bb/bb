import { isThreadRead, resolveThreadListIndicator } from "@bb/client-core";
import { memo } from "react";
import { Pressable, View } from "react-native";
import { getThreadDisplayTitle } from "@/data/threads";
import { useTheme } from "@/theme";
import { Icon, Text, cn } from "@/ui";
import {
  getCollapsedActivityIndicatorState,
  type SidebarEmptyRow,
  type SidebarEnvironmentRow,
  type SidebarHeaderRow,
  type SidebarThreadRow,
} from "./sidebar-list-rows";
import { ThreadStatusGlyph } from "./ThreadStatusGlyph";

/** Web `getSidebarThreadRowPaddingLeft`: base + a step per nesting level. */
const ROW_BASE_PADDING = 12;
const ROW_DEPTH_STEP = 18;
const ROW_MIN_HEIGHT = 44;
const HEADER_MIN_HEIGHT = 36;

function rowPaddingLeft(depth: number): number {
  return ROW_BASE_PADDING + depth * ROW_DEPTH_STEP;
}

function DisclosureChevron({
  collapsed,
  size = 16,
}: {
  collapsed: boolean;
  size?: number;
}) {
  const { tokens } = useTheme();
  return (
    <Icon
      name={collapsed ? "ChevronRight" : "ChevronDown"}
      size={size}
      color={tokens.subtleForeground}
    />
  );
}

function CountChip({ count }: { count: number }) {
  return (
    <View className="rounded-sm bg-surface-selected px-1.5 py-px">
      <Text variant="chrome">{count}</Text>
    </View>
  );
}

export type SidebarRowSubtitle =
  | { kind: "project"; name: string }
  | { kind: "snippet"; text: string };

export interface SidebarThreadRowViewProps {
  row: SidebarThreadRow;
  selected: boolean;
  /**
   * Second line: the project name outside project mode (with a folder icon
   * so it reads as a project, not a second title), a search snippet, or
   * nothing.
   */
  subtitle: SidebarRowSubtitle | null;
  onPress: (row: SidebarThreadRow) => void;
  onLongPress: (row: SidebarThreadRow) => void;
  onToggleCollapsed: (threadId: string) => void;
}

export const SidebarThreadRowView = memo(function SidebarThreadRowView({
  row,
  selected,
  subtitle,
  onPress,
  onLongPress,
  onToggleCollapsed,
}: SidebarThreadRowViewProps) {
  const { tokens } = useTheme();
  const { thread } = row;
  const title = getThreadDisplayTitle(thread);
  const unread = !isThreadRead(thread) && thread.parentThreadId === null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitleText(subtitle)}
      accessibilityState={{ selected }}
      onPress={() => onPress(row)}
      onLongPress={() => onLongPress(row)}
      delayLongPress={350}
      className={cn(
        "flex-row items-center gap-2 pr-3 active:bg-state-hover",
        selected && "bg-surface-selected",
      )}
      style={{
        minHeight: ROW_MIN_HEIGHT,
        paddingLeft: rowPaddingLeft(row.depth),
      }}
      testID={`thread-row-${thread.id}`}
    >
      {row.childCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            row.collapsed ? "Show child threads" : "Hide child threads"
          }
          hitSlop={8}
          onPress={() => onToggleCollapsed(thread.id)}
          className="h-8 w-6 items-center justify-center rounded-sm active:bg-state-active"
          testID={`thread-row-toggle-${thread.id}`}
        >
          <DisclosureChevron collapsed={row.collapsed} />
        </Pressable>
      ) : null}
      <View className="min-w-0 flex-1 py-1.5">
        <Text
          variant="body"
          weight={unread ? "medium" : undefined}
          numberOfLines={1}
          className={cn(!unread && "text-foreground/90")}
        >
          {title}
        </Text>
        {subtitle?.kind === "project" ? (
          <View className="flex-row items-center gap-1">
            <Icon name="Folder" size={12} color={tokens.mutedForeground} />
            <Text
              variant="caption"
              numberOfLines={1}
              className="min-w-0 shrink"
            >
              {subtitle.name}
            </Text>
          </View>
        ) : subtitle?.kind === "snippet" ? (
          <Text variant="caption" numberOfLines={1}>
            {subtitle.text}
          </Text>
        ) : null}
      </View>
      <View className="w-5 items-center justify-center">
        <ThreadStatusGlyph kind={row.indicator} />
      </View>
    </Pressable>
  );
});

/** The project-name subtitle for a row, or nothing when there is no name. */
export function projectSubtitle(
  name: string | null,
): SidebarRowSubtitle | null {
  return name === null ? null : { kind: "project", name };
}

function subtitleText(subtitle: SidebarRowSubtitle | null): string | undefined {
  if (subtitle === null) return undefined;
  return subtitle.kind === "project" ? subtitle.name : subtitle.text;
}

export interface SidebarHeaderRowViewProps {
  row: SidebarHeaderRow;
  onToggleCollapsed: (row: SidebarHeaderRow) => void;
  onLongPress: (row: SidebarHeaderRow) => void;
  /** Present when the group can host a new thread ("+" trailing action). */
  onCreateThread: ((row: SidebarHeaderRow) => void) | null;
}

export const SidebarHeaderRowView = memo(function SidebarHeaderRowView({
  row,
  onToggleCollapsed,
  onLongPress,
  onCreateThread,
}: SidebarHeaderRowViewProps) {
  const { tokens } = useTheme();
  const indicator = row.collapsed
    ? resolveThreadListIndicator(
        getCollapsedActivityIndicatorState(row.activity),
      )
    : "none";
  const isBuiltIn =
    row.target.kind === "pinned" || row.target.kind === "threads";
  const testIdSuffix =
    row.target.kind === "project"
      ? row.target.project.id
      : row.target.kind === "machine"
        ? row.target.key
        : row.target.kind === "section"
          ? row.target.section.id
          : row.target.kind;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.label}
      accessibilityState={{ expanded: !row.collapsed }}
      onPress={() => onToggleCollapsed(row)}
      onLongPress={isBuiltIn ? undefined : () => onLongPress(row)}
      delayLongPress={350}
      className="flex-row items-center gap-1.5 pr-1 active:bg-state-hover"
      style={{
        minHeight: HEADER_MIN_HEIGHT,
        paddingLeft: rowPaddingLeft(row.depth) - 4,
        marginTop: row.depth === 0 ? 6 : 0,
      }}
      testID={`sidebar-header-${testIdSuffix}`}
    >
      <DisclosureChevron collapsed={row.collapsed} size={14} />
      {row.target.kind === "machine" ? (
        <Icon name="Laptop" size={14} color={tokens.subtleForeground} />
      ) : row.target.kind === "pinned" ? (
        <Icon name="Pin" size={14} color={tokens.subtleForeground} />
      ) : null}
      <Text variant="sectionLabel" numberOfLines={1} className="min-w-0 flex-1">
        {row.label}
      </Text>
      {row.collapsed && row.threadCount > 0 ? (
        <CountChip count={row.threadCount} />
      ) : null}
      {indicator !== "none" ? (
        <View className="w-5 items-center justify-center">
          <ThreadStatusGlyph kind={indicator} />
        </View>
      ) : null}
      {onCreateThread ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`New thread in ${row.label}`}
          hitSlop={6}
          onPress={() => onCreateThread(row)}
          className="h-8 w-8 items-center justify-center rounded-md active:bg-state-active"
          testID={`sidebar-header-new-thread-${testIdSuffix}`}
        >
          <Icon
            name="MessageSquarePlus"
            size={18}
            color={tokens.subtleForeground}
          />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

export interface SidebarEnvironmentRowViewProps {
  row: SidebarEnvironmentRow;
  onToggleCollapsed: (environmentId: string) => void;
}

export const SidebarEnvironmentRowView = memo(
  function SidebarEnvironmentRowView({
    row,
    onToggleCollapsed,
  }: SidebarEnvironmentRowViewProps) {
    const { tokens } = useTheme();
    const indicator = row.collapsed
      ? resolveThreadListIndicator(
          getCollapsedActivityIndicatorState(row.activity),
        )
      : "none";
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.label}
        accessibilityState={{ expanded: !row.collapsed }}
        onPress={() => onToggleCollapsed(row.environmentId)}
        className="flex-row items-center gap-2 pr-3 active:bg-state-hover"
        style={{
          minHeight: HEADER_MIN_HEIGHT,
          paddingLeft: rowPaddingLeft(row.depth),
        }}
        testID={`environment-row-${row.environmentId}`}
      >
        <DisclosureChevron collapsed={row.collapsed} size={14} />
        <Icon name="GitBranch" size={16} color={tokens.subtleForeground} />
        <Text
          variant="label"
          tone="muted"
          numberOfLines={1}
          className="min-w-0 flex-1"
        >
          {row.label}
        </Text>
        {row.collapsed ? <CountChip count={row.threadCount} /> : null}
        {indicator !== "none" ? (
          <View className="w-5 items-center justify-center">
            <ThreadStatusGlyph kind={indicator} />
          </View>
        ) : null}
      </Pressable>
    );
  },
);

export function SidebarEmptyRowView({ row }: { row: SidebarEmptyRow }) {
  return (
    <View
      className="justify-center pr-3"
      style={{
        minHeight: HEADER_MIN_HEIGHT,
        paddingLeft: rowPaddingLeft(row.depth) + 6,
      }}
    >
      <Text variant="caption" numberOfLines={1}>
        {row.label}
      </Text>
    </View>
  );
}
