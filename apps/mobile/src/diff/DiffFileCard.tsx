import { formatDiffCount } from "@bb/thread-view";
import { memo, useCallback, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { cn, Icon, Text } from "@/ui";
import { DiffHunkView } from "./DiffHunkView";
import { DIFF_DEFAULT_MAX_LINES } from "./diff-rows";
import { displayDiffPath } from "./file-change-diff";
import type { DiffChangeKind, DiffFile } from "./parse-unified-diff";

export interface DiffFileCardProps {
  file: DiffFile;
  /** False for synthesized patches whose hunk headers are invented. */
  showLineNumbers?: boolean;
  /**
   * Workspace root to strip from the displayed path (timeline diffs carry
   * absolute paths). Undefined leaves the path as-is.
   */
  workspaceRootPath?: string | null;
  /**
   * Collapse control. Provide `collapsed` + `onToggleCollapsed` to control it;
   * provide nothing for an uncontrolled card; pass `collapsible={false}` to
   * hide the chevron (timeline rows collapse at the row level).
   */
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Renders an "Add to chat" action in the header when provided. */
  onAddToChat?: (file: DiffFile) => void;
  /** Visible line cap before "Show N more lines"; `Infinity` disables it. */
  maxLines?: number;
  /**
   * Body rendered instead of the hunks (the diff tab's skeleton / "Load
   * diff" / "too large" / error states). The card is collapsible whenever a
   * body exists, hunks or not.
   */
  body?: ReactNode;
  /** Rendered under the hunks / body while expanded (truncation notices). */
  footer?: ReactNode;
  /**
   * Always label the change kind (added / deleted / renamed / binary) in the
   * header. By default the label only shows when the card has no hunks.
   */
  showChangeKind?: boolean;
  testID?: string;
}

const CHANGE_KIND_LABEL: Record<DiffChangeKind, string | null> = {
  added: "added",
  deleted: "deleted",
  renamed: "renamed",
  copied: "copied",
  type_changed: "type changed",
  modified: null,
};

/**
 * One file's diff: header (collapse chevron, path — `old → new` for renames
 * and copies — `+N`/`-M` tally in the diff colors, optional add-to-chat
 * action) over `DiffHunkView`. Binary files and pure renames have no body.
 */
export const DiffFileCard = memo(function DiffFileCard({
  file,
  showLineNumbers = true,
  workspaceRootPath,
  collapsible = true,
  collapsed,
  onToggleCollapsed,
  onAddToChat,
  maxLines = DIFF_DEFAULT_MAX_LINES,
  body,
  footer,
  showChangeKind = false,
  testID,
}: DiffFileCardProps) {
  const { tokens } = useTheme();
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isControlled = collapsed !== undefined;
  const isCollapsed = isControlled ? collapsed : uncontrolledCollapsed;
  const hasBody = body !== undefined || file.hunks.length > 0;

  const toggle = useCallback(() => {
    if (onToggleCollapsed) onToggleCollapsed();
    if (!isControlled) setUncontrolledCollapsed((value) => !value);
  }, [isControlled, onToggleCollapsed]);
  const expand = useCallback(() => setExpanded(true), []);

  const path = displayDiffPath(file.path, workspaceRootPath);
  const previousPath =
    file.previousPath !== null && file.previousPath !== file.path
      ? displayDiffPath(file.previousPath, workspaceRootPath)
      : null;
  const kindLabel = file.binary
    ? "binary"
    : hasBody && !showChangeKind
      ? null
      : CHANGE_KIND_LABEL[file.changeKind];
  const showAdditions =
    file.changeKind !== "deleted" && file.stats.additions > 0;
  const showDeletions = file.changeKind !== "added" && file.stats.deletions > 0;
  const showChevron = collapsible && hasBody;
  const label = previousPath ? `${previousPath} → ${path}` : path;

  return (
    <View
      className="overflow-hidden rounded-lg border border-border bg-background"
      testID={testID}
    >
      <Pressable
        onPress={showChevron ? toggle : undefined}
        disabled={!showChevron}
        // No explicit label: iOS aggregates the children (path, tally) so
        // VoiceOver reads them and UI tests can match them; the role + state
        // carry the collapse affordance.
        accessibilityRole={showChevron ? "button" : undefined}
        accessibilityState={
          showChevron ? { expanded: !isCollapsed } : undefined
        }
        className={cn(
          "min-h-10 flex-row items-center gap-1.5 bg-surface-raised px-2 py-1.5",
          !isCollapsed && hasBody && "border-b border-border",
        )}
        testID={testID ? `${testID}-header` : undefined}
      >
        {collapsible ? (
          <Icon
            name={isCollapsed || !hasBody ? "ChevronRight" : "ChevronDown"}
            size={14}
            color={hasBody ? tokens.mutedForeground : tokens.subtleForeground}
          />
        ) : null}
        <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
          {previousPath ? (
            <>
              <Text
                variant="mono"
                className="min-w-0 shrink text-xs text-muted-foreground"
                numberOfLines={1}
                ellipsizeMode="head"
              >
                {previousPath}
              </Text>
              <Icon
                name="ArrowRight"
                size={12}
                color={tokens.subtleForeground}
              />
            </>
          ) : null}
          <Text
            variant="mono"
            className="min-w-0 shrink text-xs font-medium text-foreground"
            numberOfLines={1}
            ellipsizeMode="head"
          >
            {path}
          </Text>
          {kindLabel ? (
            <Text variant="chrome" className="shrink-0">
              {kindLabel}
            </Text>
          ) : null}
        </View>
        <View className="shrink-0 flex-row items-center gap-1">
          {showAdditions ? (
            <Text className="text-xs text-diff-added">
              +{formatDiffCount(file.stats.additions)}
            </Text>
          ) : null}
          {showDeletions ? (
            <Text className="text-xs text-diff-removed">
              -{formatDiffCount(file.stats.deletions)}
            </Text>
          ) : null}
          {onAddToChat ? (
            <Pressable
              onPress={() => onAddToChat(file)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Add ${label} to chat`}
              className="ml-1 h-7 w-7 items-center justify-center rounded-md active:bg-state-hover"
              testID={testID ? `${testID}-add-to-chat` : undefined}
            >
              <Icon
                name="MessageSquarePlus"
                size={16}
                color={tokens.mutedForeground}
              />
            </Pressable>
          ) : null}
        </View>
      </Pressable>
      {body !== undefined && !isCollapsed ? (
        body
      ) : hasBody && !isCollapsed ? (
        <DiffHunkView
          hunks={file.hunks}
          showLineNumbers={showLineNumbers}
          maxLines={maxLines}
          expanded={expanded}
          onExpand={expand}
          testID={testID ? `${testID}-body` : undefined}
        />
      ) : null}
      {footer !== undefined && !isCollapsed ? footer : null}
    </View>
  );
});
