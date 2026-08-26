import type { ThreadResponse } from "@bb/server-contract";
import { Stack } from "expo-router";
import { Pressable, useWindowDimensions, View } from "react-native";
import { useTheme } from "@/theme";
import { cn, Icon, sfSymbolFor, Text } from "@/ui";
import { PanelToggleButton } from "../panel/PanelToggleButton";
import { useThreadActions } from "./actions/use-thread-actions";
import type { ThreadStatusPill } from "./thread-detail-header-model";

const IS_IOS = process.env.EXPO_OS === "ios";
/**
 * Room the bar items take on one side: the iOS 26 glass group holding the
 * panel and menu buttons (about 110pt) plus its margins. The back button
 * side is narrower, but the title is centered, so the wider side bounds
 * both.
 */
const BAR_ITEMS_INSET = 131;
/** The minimal back button plus its margins. */
const BACK_ITEM_INSET = 68;
const TITLE_MIN_WIDTH = 120;

/**
 * The thread screen's native header pieces. There is one header only: the
 * title (tap to rename) with a status subtitle while the thread needs
 * attention, has an error, or waits on a host, and two items on the right —
 * the workspace panel and the "…" menu. On iOS those are native bar items
 * (`Stack.Toolbar`: a selected-state button and a pull-down `UIMenu` built
 * from the thread action model); on Android they stay `headerRight`
 * Pressables that open the bottom sheet. Everything else the old two-layer
 * header carried (environment line, child roll-up, git action) lives in
 * the menu.
 */

interface ThreadHeaderTitleProps {
  title: string;
  statusPill: ThreadStatusPill;
  /** Pill shown beside the title for side chats / child threads. */
  childPillLabel: "child" | "side chat" | null;
  /** Tap the title to rename (null while the thread is loading). */
  onPressTitle: (() => void) | null;
}

/**
 * Subtitle shown under the title. Idle threads show none, and working threads
 * show none either: the timeline's working indicator already carries that.
 */
function headerSubtitle(
  statusPill: ThreadStatusPill,
  childPillLabel: ThreadHeaderTitleProps["childPillLabel"],
): string | null {
  const parts: string[] = [];
  if (statusPill.tone !== "idle" && statusPill.tone !== "working") {
    parts.push(statusPill.label);
  }
  if (childPillLabel) parts.push(childPillLabel);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function ThreadHeaderTitle({
  title,
  statusPill,
  childPillLabel,
  onPressTitle,
}: ThreadHeaderTitleProps) {
  const { tokens } = useTheme();
  const { width } = useWindowDimensions();
  // UIKit centers a custom title view in the bar and sizes it from our
  // layout, so it never shrinks to the room between the bar items: bound it
  // by the wider side (the two-item right group) on both sides, or a long
  // title runs under the buttons.
  const maxWidth = Math.max(
    TITLE_MIN_WIDTH,
    width - BACK_ITEM_INSET - BAR_ITEMS_INSET,
  );
  const subtitle = headerSubtitle(statusPill, childPillLabel);
  const subtitleColor =
    statusPill.tone === "error"
      ? tokens.destructiveText
      : statusPill.tone === "attention"
        ? tokens.warningText
        : tokens.mutedForeground;
  return (
    <Pressable
      // Not one accessibility element: the title and the status line stay
      // separately readable (and findable by UI automation).
      accessible={false}
      disabled={!onPressTitle}
      onPress={onPressTitle ?? undefined}
      hitSlop={8}
      className="items-center"
      style={{ maxWidth }}
      testID="thread-detail-header"
    >
      <Text
        // 17/600 headline in the system face: the native title metrics.
        variant="headline"
        numberOfLines={1}
        className="text-center"
        accessibilityRole={onPressTitle ? "button" : undefined}
        accessibilityHint={onPressTitle ? "Opens the rename form" : undefined}
        testID="thread-detail-title"
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          variant="footnote"
          numberOfLines={1}
          style={{ color: subtitleColor }}
          testID="thread-status-pill"
        >
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

interface ThreadHeaderActionsProps {
  /** Opens the thread actions menu (null while the thread is loading). */
  onOpenActions: (() => void) | null;
  /** Opens the workspace panel (Info / Diff / Files / Terminal); null while loading. */
  onOpenPanel: (() => void) | null;
  /** The workspace panel is presented. */
  panelActive: boolean;
}

/** Android `headerRight`: the panel toggle and the "…" sheet button. */
export function ThreadHeaderActions({
  onOpenActions,
  onOpenPanel,
  panelActive,
}: ThreadHeaderActionsProps) {
  const { tokens } = useTheme();
  return (
    <View className="flex-row items-center gap-0.5">
      <PanelToggleButton
        onPress={onOpenPanel ?? (() => undefined)}
        active={panelActive}
        disabled={onOpenPanel === null}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Thread actions"
        onPress={onOpenActions ?? undefined}
        disabled={!onOpenActions}
        hitSlop={6}
        className={cn(
          "h-9 w-9 items-center justify-center rounded-full active:bg-state-hover",
          !onOpenActions && "opacity-40",
        )}
        testID="thread-actions-button"
      >
        <Icon name="MoreHorizontal" size={20} color={tokens.foreground} />
      </Pressable>
    </View>
  );
}

export interface ThreadHeaderGitAction {
  label: string;
  pending: boolean;
  onPress: () => void;
}

interface ThreadHeaderToolbarProps {
  /** Undefined while loading: the items render disabled. */
  thread: ThreadResponse | undefined;
  panelActive: boolean;
  onOpenPanel: () => void;
  /** The primary git action (Commit / Squash merge); null hides the row. */
  gitAction: ThreadHeaderGitAction | null;
  /** Menu heading: "project · host · worktree · branch" (+ child roll-up). */
  menuTitle: string | null;
  onDeleted: () => void;
  onHandoffToNewThread: () => void;
  onNewThreadInWorktree: (() => void) | null;
  /** Opens the rename prompt. */
  onRename: () => void;
}

const PANEL_SYMBOL =
  sfSymbolFor("PanelBottom") ?? "rectangle.bottomthird.inset.filled";

/**
 * iOS header items: the workspace-panel button (selected while the panel is
 * up) and the "…" menu. Renders nothing elsewhere; Android keeps
 * `ThreadHeaderActions`. Every `Stack.Toolbar.*` element is a direct child
 * of the one `Stack.Toolbar` (expo-router converts the tree into native
 * `UIBarButtonItem`s, so the pieces cannot be split into components).
 */
export function ThreadHeaderToolbar(props: ThreadHeaderToolbarProps) {
  if (!IS_IOS) return null;
  if (props.thread === undefined) {
    return (
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={PANEL_SYMBOL}
          accessibilityLabel="Workspace panel"
          disabled
        />
        <Stack.Toolbar.Menu
          icon="ellipsis.circle"
          accessibilityLabel="Thread actions"
          disabled
        />
      </Stack.Toolbar>
    );
  }
  return <ThreadHeaderToolbarReady {...props} thread={props.thread} />;
}

function ThreadHeaderToolbarReady({
  thread,
  panelActive,
  onOpenPanel,
  gitAction,
  menuTitle,
  onDeleted,
  onHandoffToNewThread,
  onNewThreadInWorktree,
  onRename,
}: ThreadHeaderToolbarProps & { thread: ThreadResponse }) {
  const model = useThreadActions({
    thread,
    onDeleted,
    onHandoffToNewThread,
    onNewThreadInWorktree,
    onRename,
  });
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        icon={PANEL_SYMBOL}
        accessibilityLabel="Workspace panel"
        selected={panelActive}
        onPress={onOpenPanel}
      />
      <Stack.Toolbar.Menu
        icon="ellipsis.circle"
        accessibilityLabel="Thread actions"
        title={menuTitle ?? undefined}
      >
        {gitAction ? (
          <Stack.Toolbar.MenuAction
            icon="arrow.triangle.branch"
            disabled={gitAction.pending}
            onPress={gitAction.onPress}
          >
            {gitAction.label}
          </Stack.Toolbar.MenuAction>
        ) : null}
        {model.actions.map((action) =>
          action.key === "move" ? null : (
            <Stack.Toolbar.MenuAction
              key={action.key}
              icon={action.symbol ?? sfSymbolFor(action.icon)}
              destructive={action.destructive}
              disabled={action.disabled || action.pending}
              onPress={action.onPress}
            >
              {action.label}
            </Stack.Toolbar.MenuAction>
          ),
        )}
        <Stack.Toolbar.Menu title="Move to section" icon="folder">
          {model.sectionChoices.map((choice) => (
            <Stack.Toolbar.MenuAction
              key={choice.key}
              isOn={choice.selected}
              onPress={choice.onPress}
            >
              {choice.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}
