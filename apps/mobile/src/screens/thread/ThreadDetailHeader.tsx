import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { cn, Icon, Text } from "@/ui";
import { PanelToggleButton } from "../panel/PanelToggleButton";
import type { ThreadStatusPill } from "./thread-detail-header-model";

/**
 * The thread screen's native header pieces. There is one header only: the
 * title (tap to rename) with a status subtitle while the thread needs
 * attention, has an error, or waits on a host, and two buttons on the right — the workspace panel
 * and the "…" menu. Everything else the old two-layer header carried
 * (environment line, child roll-up, git action) lives in the menu sheet.
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
      className="max-w-[240px] items-center"
      testID="thread-detail-header"
    >
      <Text
        variant="heading"
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
          variant="caption"
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
