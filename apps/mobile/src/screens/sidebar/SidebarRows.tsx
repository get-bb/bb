import { isThreadRead, resolveThreadListIndicator } from "@bb/client-core";
import { memo, useEffect, useRef } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { getThreadDisplayTitle } from "@/data/threads";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme";
import { Icon, LONG_PRESS_DELAY_MS, Text, cn } from "@/ui";
import { useSidebarActions } from "./SidebarActionsProvider";
import {
  getCollapsedActivityIndicatorState,
  type SidebarEmptyRow,
  type SidebarEnvironmentRow,
  type SidebarHeaderRow,
  type SidebarThreadRow,
} from "./sidebar-list-rows";
import {
  ThreadRowSwipeable,
  type ThreadSwipeAction,
} from "./ThreadRowSwipeable";
import { ThreadStatusGlyph } from "./ThreadStatusGlyph";

const IS_IOS = process.env.EXPO_OS === "ios";

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
/** Space above a top-level group header (iOS grouped sections breathe more). */
const HEADER_GROUP_GAP = IS_IOS ? 12 : 6;
/**
 * Distance from a row's text edge to the center of the hairline that ties
 * its children to it (web `SIDEBAR_THREAD_ROW_GLYPH_CENTER_OFFSET_PX`).
 */
const GROUP_LINE_OFFSET = 8;
/** The single trailing column: status glyph, or the header "+" action. */
const TRAILING_SLOT_CLASS = "h-9 w-9 items-center justify-center";
/** System highlight while pressed (iOS) / hover tone (Android). */
const ROW_PRESS_CLASS = IS_IOS
  ? "active:bg-state-active"
  : "active:bg-state-hover";
const CHEVRON_TURN_MS = 200;
/** Rotation of the disclosure chevron while the group is expanded. */
const CHEVRON_OPEN_DEG = 90;

function rowPaddingLeft(depth: number): number {
  return ROW_BASE_PADDING + depth * ROW_DEPTH_STEP;
}

/**
 * `chevron.right` that turns to point down as a group expands. The turn
 * only animates when the same row toggles: a recycled list cell that now
 * shows another row (`rowKey` changed) snaps to that row's state.
 */
function DisclosureChevron({
  collapsed,
  size,
  rowKey,
}: {
  collapsed: boolean;
  size: number;
  /** Identity of the row the chevron belongs to. */
  rowKey: string;
}) {
  const { tokens } = useTheme();
  const degrees = useSharedValue(collapsed ? 0 : CHEVRON_OPEN_DEG);
  const shown = useRef({ rowKey, collapsed });
  useEffect(() => {
    const previous = shown.current;
    shown.current = { rowKey, collapsed };
    const target = collapsed ? 0 : CHEVRON_OPEN_DEG;
    if (previous.rowKey !== rowKey) {
      degrees.set(target);
    } else if (previous.collapsed !== collapsed) {
      degrees.set(withTiming(target, { duration: CHEVRON_TURN_MS }));
    }
  }, [collapsed, degrees, rowKey]);
  const turn = useAnimatedStyle(() => ({
    transform: [{ rotate: `${degrees.get()}deg` }],
  }));
  return (
    <Animated.View style={turn}>
      <Icon
        name="ChevronRight"
        size={size}
        weight="semibold"
        color={tokens.subtleForeground}
      />
    </Animated.View>
  );
}

/** Thread count of a collapsed group: tabular footnote (iOS) / chip. */
function CountChip({ count }: { count: number }) {
  if (IS_IOS) {
    return (
      <Text variant="footnote" tone="muted" numeric className="px-1">
        {count}
      </Text>
    );
  }
  return (
    <View className="rounded-sm bg-surface-selected px-1.5 py-px">
      <Text variant="chrome" numeric>
        {count}
      </Text>
    </View>
  );
}

/**
 * Hairline under the parent's text edge that runs the height of a nested row
 * (web `SIDEBAR_PROJECT_GROUP_LINE_CLASS`). Rows are flat list items, so each
 * nested row paints its own segment; contiguous rows read as one line. iOS
 * conveys nesting with indentation and inset separators instead.
 */
function GroupLine({ depth }: { depth: number }) {
  if (depth === 0 || IS_IOS) return null;
  return (
    <View
      pointerEvents="none"
      className="absolute bottom-0 top-0 w-px bg-border-hairline opacity-70"
      style={{ left: rowPaddingLeft(depth - 1) + GROUP_LINE_OFFSET }}
    />
  );
}

/** iOS table-cell separator, inset to the row's text column. */
function RowSeparator({ inset }: { inset: number }) {
  const { tokens } = useTheme();
  if (!IS_IOS) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: inset,
        right: 0,
        bottom: 0,
        height: StyleSheet.hairlineWidth,
        backgroundColor: tokens.borderHairline,
      }}
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
  onToggleCollapsed: (threadId: string) => void;
}

/**
 * A thread row. Tapping opens the thread; long-pressing opens the row's
 * action sheet (read, pin, rename, move, archive, delete) from the
 * enclosing `SidebarActionsProvider`; swipe actions on both platforms. One
 * plain `Pressable` on both: a native context menu (`Link.Menu`) removes
 * the row from the iOS accessibility tree, so VoiceOver and Maestro would
 * see nothing but the host, and a `Link.Preview` would mount the thread
 * screen (twice) and mark the thread read, since the preview reports
 * itself as focused.
 */
export const SidebarThreadRowView = memo(function SidebarThreadRowView({
  row,
  subtitle,
  onToggleCollapsed,
}: SidebarThreadRowViewProps) {
  const { tokens } = useTheme();
  const actions = useSidebarActions();
  const { thread } = row;
  const title = getThreadDisplayTitle(thread);
  const read = isThreadRead(thread);
  const unread = !read && thread.parentThreadId === null;
  const pinned = thread.pinnedAt !== null;
  const archived = thread.archivedAt !== null;
  const textInset = rowPaddingLeft(row.depth);
  const rowStyle: ViewStyle = {
    minHeight: ROW_MIN_HEIGHT,
    paddingLeft: textInset,
    paddingRight: ROW_PADDING_RIGHT,
  };

  const content = (
    <>
      <GroupLine depth={row.depth} />
      <View className="min-w-0 flex-1 py-1.5">
        <View className="flex-row items-center gap-1">
          <Text
            variant={IS_IOS ? "bodyLarge" : "body"}
            weight={unread ? (IS_IOS ? "semibold" : "medium") : undefined}
            numberOfLines={1}
            className={cn(
              "min-w-0 shrink",
              !unread && !IS_IOS && "text-foreground/90",
            )}
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
              onPress={() => {
                haptic("selection");
                onToggleCollapsed(thread.id);
              }}
              className="h-6 w-6 items-center justify-center rounded-sm active:bg-state-active"
              testID={`thread-row-toggle-${thread.id}`}
            >
              <DisclosureChevron
                collapsed={row.collapsed}
                size={13}
                rowKey={row.key}
              />
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
      <RowSeparator inset={textInset} />
    </>
  );

  const leading: ThreadSwipeAction = read
    ? {
        key: "unread",
        label: "Unread",
        icon: "Mail",
        color: tokens.primary,
        onPress: () => actions.toggleThreadRead(thread),
      }
    : {
        key: "read",
        label: "Read",
        icon: "MailOpen",
        color: tokens.primary,
        onPress: () => actions.toggleThreadRead(thread),
      };
  const trailing: ThreadSwipeAction[] = [
    {
      key: pinned ? "unpin" : "pin",
      label: pinned ? "Unpin" : "Pin",
      icon: pinned ? "PinOff" : "Pin",
      color: tokens.warning,
      onPress: () => actions.toggleThreadPinned(thread),
    },
    archived
      ? {
          key: "unarchive",
          label: "Unarchive",
          icon: "ArchiveRestore",
          color: tokens.success,
          onPress: () => actions.unarchiveThread(thread),
        }
      : {
          key: "archive",
          label: "Archive",
          icon: "Archive",
          color: tokens.destructive,
          onPress: () => actions.archiveThread(thread),
        },
  ];

  return (
    <ThreadRowSwipeable
      threadId={thread.id}
      leading={leading}
      trailing={trailing}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={subtitleText(subtitle)}
        onPress={() => actions.openThread(thread)}
        onLongPress={() => actions.openThreadMenu(thread)}
        delayLongPress={LONG_PRESS_DELAY_MS}
        className={cn("flex-row items-center gap-1", ROW_PRESS_CLASS)}
        style={rowStyle}
        testID={`thread-row-${thread.id}`}
      >
        {content}
      </Pressable>
    </ThreadRowSwipeable>
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

/**
 * A group header (pinned, project, machine, section, threads): sentence-case
 * footnote label, a turning disclosure chevron, the tabular count and the
 * rolled-up status while collapsed, and the "+" new-thread action. Tapping
 * toggles the group (selection haptic); long-pressing opens its menu.
 */
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
      onPress={() => {
        haptic("selection");
        onToggleCollapsed(row);
      }}
      onLongPress={() => onLongPress(row)}
      delayLongPress={LONG_PRESS_DELAY_MS}
      className={cn("flex-row items-center gap-1", ROW_PRESS_CLASS)}
      style={{
        minHeight: HEADER_MIN_HEIGHT,
        paddingLeft: rowPaddingLeft(row.depth),
        paddingRight: ROW_PADDING_RIGHT,
        marginTop: row.depth === 0 ? HEADER_GROUP_GAP : 0,
      }}
      testID={`sidebar-header-${testIdSuffix}`}
    >
      <GroupLine depth={row.depth} />
      {row.target.kind === "machine" ? (
        <Icon name="Laptop" size={13} color={tokens.subtleForeground} />
      ) : row.target.kind === "pinned" ? (
        <Icon name="Pin" size={13} color={tokens.subtleForeground} />
      ) : null}
      <Text variant="sectionLabel" numberOfLines={1} className="min-w-0 shrink">
        {row.label}
      </Text>
      <View className="h-6 w-6 items-center justify-center">
        <DisclosureChevron
          collapsed={row.collapsed}
          size={11}
          rowKey={row.key}
        />
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
            color={IS_IOS ? tokens.primary : tokens.subtleForeground}
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
        onPress={() => {
          haptic("selection");
          onToggleCollapsed(row.environmentId);
        }}
        className={cn("flex-row items-center gap-1", ROW_PRESS_CLASS)}
        style={{
          minHeight: HEADER_MIN_HEIGHT,
          paddingLeft: rowPaddingLeft(row.depth),
          paddingRight: ROW_PADDING_RIGHT,
        }}
        testID={`environment-row-${row.environmentId}`}
      >
        <GroupLine depth={row.depth} />
        <Icon name="GitBranch" size={13} color={tokens.subtleForeground} />
        <Text
          variant="label"
          tone="muted"
          numberOfLines={1}
          className="min-w-0 shrink"
        >
          {row.label}
        </Text>
        <View className="h-6 w-6 items-center justify-center">
          <DisclosureChevron
            collapsed={row.collapsed}
            size={11}
            rowKey={row.key}
          />
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
