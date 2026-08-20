import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { cn, Icon, Pill, Spinner, Text, type PillVariant } from "@/ui";
import type { ChildThreadSummary } from "@/data/thread-detail";
import { PanelToggleButton } from "../panel/PanelToggleButton";
import type { ThreadStatusPill } from "./thread-detail-header-model";

export interface ThreadDetailHeaderGitAction {
  /** Primary git action label ("Commit" / "Squash merge"). */
  label: string;
  /** Opens the git sheet (commit / squash merge). */
  onPress: () => void;
  pending: boolean;
}

export interface ThreadDetailHeaderProps {
  title: string;
  statusPill: ThreadStatusPill;
  /** "project · host · worktree · branch" parts (empty = hidden). */
  environmentParts: readonly string[];
  childSummary: ChildThreadSummary;
  /** Pill shown beside the title for side chats / child threads. */
  childPillLabel: "child" | "side chat" | null;
  onOpenTableOfContents: () => void;
  tableOfContentsEnabled: boolean;
  /** Tap the title to rename (null while the thread is loading). */
  onPressTitle: (() => void) | null;
  /** Opens the thread actions menu (null while the thread is loading). */
  onOpenActions: (() => void) | null;
  /** Git action button (null when the workspace has nothing to commit/merge). */
  gitAction: ThreadDetailHeaderGitAction | null;
  /** Opens the workspace panel (Info / Diff / Files / Terminal); null while loading. */
  onOpenPanel: (() => void) | null;
  /** The workspace panel is presented. */
  panelActive: boolean;
}

function pillVariantForTone(tone: ThreadStatusPill["tone"]): PillVariant {
  switch (tone) {
    case "error":
      return "destructive";
    case "attention":
      return "emphasis";
    case "working":
    case "idle":
    case "muted":
      return "secondary";
  }
}

/**
 * Thread header under the native bar: the title (tap to rename), the
 * runtime status pill, the environment line, the child-thread roll-up, the
 * git action button, the workspace panel button, the table-of-contents
 * button, and the actions menu.
 */
export function ThreadDetailHeader({
  title,
  statusPill,
  environmentParts,
  childSummary,
  childPillLabel,
  onOpenTableOfContents,
  tableOfContentsEnabled,
  onPressTitle,
  onOpenActions,
  gitAction,
  onOpenPanel,
  panelActive,
}: ThreadDetailHeaderProps) {
  const { tokens } = useTheme();
  const pillVariant = pillVariantForTone(statusPill.tone);
  return (
    <View
      className="gap-1.5 border-b border-border-hairline px-4 pb-3 pt-2"
      testID="thread-detail-header"
    >
      <Pressable
        accessibilityRole={onPressTitle ? "button" : undefined}
        accessibilityLabel={onPressTitle ? "Rename thread" : undefined}
        accessibilityHint={onPressTitle ? "Opens the rename form" : undefined}
        disabled={!onPressTitle}
        onPress={onPressTitle ?? undefined}
        className="-mx-1 rounded-md px-1 active:bg-state-hover"
        testID="thread-detail-title-button"
      >
        <Text variant="heading" numberOfLines={2} testID="thread-detail-title">
          {title}
        </Text>
      </Pressable>
      <View className="flex-row flex-wrap items-center gap-2">
        <Pill variant={pillVariant}>
          <View
            className="flex-row items-center gap-1.5"
            testID="thread-status-pill"
          >
            {statusPill.spinning ? (
              <Spinner
                size="small"
                color={
                  pillVariant === "emphasis"
                    ? tokens.background
                    : tokens.mutedForeground
                }
              />
            ) : null}
            <Text
              className={cn(
                "text-xs",
                pillVariant === "emphasis"
                  ? "text-background"
                  : pillVariant === "destructive"
                    ? "text-destructive-foreground"
                    : "text-secondary-foreground",
              )}
              numberOfLines={1}
            >
              {statusPill.label}
            </Text>
          </View>
        </Pill>
        {childPillLabel ? (
          <Pill variant="outline">{childPillLabel}</Pill>
        ) : null}
        {childSummary.count > 0 ? (
          <Pill variant="outline">
            {`${childSummary.count} child thread${childSummary.count === 1 ? "" : "s"}${
              childSummary.activity.pending
                ? " · needs input"
                : childSummary.activity.working
                  ? " · working"
                  : ""
            }`}
          </Pill>
        ) : null}
        <View className="flex-1" />
        {/* Actions sit on the pill row, not the title row: the dev client's
            floating gear covers the header's top-right corner on the
            simulator. Icon-only (labels in accessibility) so the row holds
            the status, the child pill, contents and the menu without
            wrapping. */}
        <PanelToggleButton
          onPress={onOpenPanel ?? (() => undefined)}
          active={panelActive}
          disabled={onOpenPanel === null}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Table of contents"
          onPress={onOpenTableOfContents}
          disabled={!tableOfContentsEnabled}
          hitSlop={6}
          className={cn(
            "h-8 w-8 items-center justify-center rounded-md active:bg-state-hover",
            !tableOfContentsEnabled && "opacity-40",
          )}
          testID="thread-toc-button"
        >
          <Icon name="ListView" size={18} color={tokens.foreground} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Thread actions"
          onPress={onOpenActions ?? undefined}
          disabled={!onOpenActions}
          hitSlop={6}
          className={cn(
            "h-8 w-8 items-center justify-center rounded-md active:bg-state-hover",
            !onOpenActions && "opacity-40",
          )}
          testID="thread-actions-button"
        >
          <Icon name="MoreHorizontal" size={18} color={tokens.foreground} />
        </Pressable>
      </View>
      {environmentParts.length > 0 || gitAction ? (
        <View className="flex-row items-center gap-2">
          <Text
            variant="caption"
            numberOfLines={1}
            className="min-w-0 flex-1"
            testID="thread-detail-environment"
          >
            {environmentParts.join(" · ")}
          </Text>
          {/* The git action belongs to the workspace line. */}
          {gitAction ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gitAction.label}
              onPress={gitAction.onPress}
              disabled={gitAction.pending}
              className={cn(
                "h-7 flex-row items-center gap-1 rounded-md border border-border px-2 active:bg-state-hover",
                gitAction.pending && "opacity-60",
              )}
              testID="thread-git-button"
            >
              {gitAction.pending ? (
                <Spinner size="small" color={tokens.mutedForeground} />
              ) : (
                <Icon
                  name="GitBranch"
                  size={14}
                  color={tokens.mutedForeground}
                />
              )}
              <Text variant="caption" className="text-foreground">
                {gitAction.label}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
