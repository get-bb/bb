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

/**
 * One left text edge per depth, shared by headers, thread rows, environment
 * rows, and empty rows (web `getSidebarThreadRowPaddingLeft`: base + a step
 * per nesting level). Nothing leads the text: the disclosure chevron sits
 * after the label, so a parent row and a leaf row start at the same x.
 */
const ROW_BASE_PADDING = 16;
const ROW_DEPTH_STEP = 24;
/** Right inset of every row; the trailing slot ends here. */
const ROW_PADDING_RIGHT = 8;
const ROW_MIN_HEIGHT = 44;
const HEADER_MIN_HEIGHT = 36;
/**
 * Distance from a row's text edge to the center of the hairline that ties
 * its children to it (web `SIDEBAR_THREAD_ROW_GLYPH_CENTER_OFFSET_PX`).
 */
const GROUP_LINE_OFFSET = 8;
/** The single trailing column: status glyph, or the header "+" action. */
const TRAILING_SLOT_CLASS = "h-9 w-9 items-center justify-center";

function rowPaddingLeft(depth: number): number {
  return ROW_BASE_PADDING + depth * ROW_DEPTH_STEP;
}

function DisclosureChevron({
  collapsed,
  size,
}: {
  collapsed: boolean;
  size: number;
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

/**
 * Hairline under the parent's text edge that runs the height of a nested row
 * (web `SIDEBAR_PROJECT_GROUP_LINE_CLASS`). Rows are flat list items, so each
 * nested row paints its own segment; contiguous rows read as one line.
 */
function GroupLine({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <View
      pointerEvents="none"
      className="absolute bottom-0 top-0 w-px bg-border-hairline opacity-70"
      style={{ left: rowPaddingLeft(depth - 1) + GROUP_LINE_OFFSET }}
    />
  );
}

export type SidebarRowSubtitle =
  | { kind: "project"; name: string }
  | { kind: "snippet"; text: string };

interface SidebarThreadRowViewProps {
  row: SidebarThreadRow;
  /**
   * Optional second line. The home list passes null (one line per row, like
   * the web sidebar); search passes a snippet or the project name, and the
   * archive passes the project name.
   */
  subtitle: SidebarRowSubtitle | null;
  onPress: (row: SidebarThreadRow) => void;
  onLongPress: (row: SidebarThreadRow) => void;
  onToggleCollapsed: (threadId: string) => void;
}

export const SidebarThreadRowView = memo(function SidebarThreadRowView({
  row,
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
      onPress={() => onPress(row)}
      onLongPress={() => onLongPress(row)}
      delayLongPress={350}
      className="flex-row items-center gap-1 active:bg-state-hover"
      style={{
        minHeight: ROW_MIN_HEIGHT,
        paddingLeft: rowPaddingLeft(row.depth),
        paddingRight: ROW_PADDING_RIGHT,
      }}
      testID={`thread-row-${thread.id}`}
    >
      <GroupLine depth={row.depth} />
      <View className="min-w-0 flex-1 py-1.5">
        <View className="flex-row items-center gap-1">
          <Text
            variant="body"
            weight={unread ? "medium" : undefined}
            numberOfLines={1}
            className={cn("min-w-0 shrink", !unread && "text-foreground/90")}
          >
            {title}
          </Text>
          {row.childCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                row.collapsed ? "Show child threads" : "Hide child threads"
              }
              hitSlop={10}
              onPress={() => onToggleCollapsed(thread.id)}
              className="h-6 w-6 items-center justify-center rounded-sm active:bg-state-active"
              testID={`thread-row-toggle-${thread.id}`}
            >
              <DisclosureChevron collapsed={row.collapsed} size={14} />
            </Pressable>
          ) : null}
        </View>
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
      <View className={TRAILING_SLOT_CLASS}>
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

interface SidebarHeaderRowViewProps {
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
      onLongPress={() => onLongPress(row)}
      delayLongPress={350}
      className="flex-row items-center gap-1 active:bg-state-hover"
      style={{
        minHeight: HEADER_MIN_HEIGHT,
        paddingLeft: rowPaddingLeft(row.depth),
        paddingRight: ROW_PADDING_RIGHT,
        marginTop: row.depth === 0 ? 6 : 0,
      }}
      testID={`sidebar-header-${testIdSuffix}`}
    >
      <GroupLine depth={row.depth} />
      {row.target.kind === "machine" ? (
        <Icon name="Laptop" size={14} color={tokens.subtleForeground} />
      ) : row.target.kind === "pinned" ? (
        <Icon name="Pin" size={14} color={tokens.subtleForeground} />
      ) : null}
      <Text variant="sectionLabel" numberOfLines={1} className="min-w-0 shrink">
        {row.label}
      </Text>
      <View className="h-6 w-6 items-center justify-center">
        <DisclosureChevron collapsed={row.collapsed} size={12} />
      </View>
      <View className="flex-1" />
      {row.collapsed && row.threadCount > 0 ? (
        <CountChip count={row.threadCount} />
      ) : null}
      {indicator !== "none" ? (
        <View className={TRAILING_SLOT_CLASS}>
          <ThreadStatusGlyph kind={indicator} />
        </View>
      ) : null}
      {onCreateThread ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`New thread in ${row.label}`}
          hitSlop={6}
          onPress={() => onCreateThread(row)}
          className={cn(
            TRAILING_SLOT_CLASS,
            "rounded-md active:bg-state-active",
          )}
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

interface SidebarEnvironmentRowViewProps {
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
        className="flex-row items-center gap-1 active:bg-state-hover"
        style={{
          minHeight: HEADER_MIN_HEIGHT,
          paddingLeft: rowPaddingLeft(row.depth),
          paddingRight: ROW_PADDING_RIGHT,
        }}
        testID={`environment-row-${row.environmentId}`}
      >
        <GroupLine depth={row.depth} />
        <Icon name="GitBranch" size={14} color={tokens.subtleForeground} />
        <Text
          variant="label"
          tone="muted"
          numberOfLines={1}
          className="min-w-0 shrink"
        >
          {row.label}
        </Text>
        <View className="h-6 w-6 items-center justify-center">
          <DisclosureChevron collapsed={row.collapsed} size={12} />
        </View>
        <View className="flex-1" />
        {row.collapsed ? <CountChip count={row.threadCount} /> : null}
        {indicator !== "none" ? (
          <View className={TRAILING_SLOT_CLASS}>
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
      className="justify-center"
      style={{
        minHeight: HEADER_MIN_HEIGHT,
        paddingLeft: rowPaddingLeft(row.depth),
        paddingRight: ROW_PADDING_RIGHT,
      }}
    >
      <GroupLine depth={row.depth} />
      <Text variant="caption" numberOfLines={1}>
        {row.label}
      </Text>
    </View>
  );
}
