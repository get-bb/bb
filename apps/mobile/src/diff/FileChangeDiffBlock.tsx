import type { TimelineFileChange } from "@bb/server-contract";
import { memo, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { cn, Text } from "@/ui";
import { DiffFileCard } from "./DiffFileCard";
import { DIFF_FONT_SIZE, DIFF_LINE_HEIGHT } from "./DiffHunkView";
import { DIFF_DEFAULT_MAX_LINES } from "./diff-rows";
import { buildFileChangeDiffView } from "./file-change-diff";
import type { DiffFile } from "./parse-unified-diff";

export interface FileChangeDiffBlockProps {
  change: TimelineFileChange;
  /**
   * Workspace root the agent ran in (`environment.path`); stripped from the
   * displayed path. Pass `undefined` while the environment is loading.
   */
  workspaceRootPath: string | undefined;
  onAddToChat?: (file: DiffFile) => void;
  maxLines?: number;
  testID?: string;
}

/**
 * Timeline `file-change` body, mirroring the web `TimelineFileDiffBlock`:
 * the parsed diff as a card, the raw text when the provider's diff is not a
 * patch, or "No diff available.".
 */
export const FileChangeDiffBlock = memo(function FileChangeDiffBlock({
  change,
  workspaceRootPath,
  onAddToChat,
  maxLines = DIFF_DEFAULT_MAX_LINES,
  testID,
}: FileChangeDiffBlockProps) {
  const view = useMemo(() => buildFileChangeDiffView(change), [change]);
  switch (view.kind) {
    case "diff":
      return (
        <DiffFileCard
          file={view.file}
          showLineNumbers={view.showLineNumbers}
          workspaceRootPath={workspaceRootPath}
          collapsible={false}
          onAddToChat={onAddToChat}
          maxLines={maxLines}
          testID={testID}
        />
      );
    case "plain":
      return (
        <PlainDiffBlock text={view.text} maxLines={maxLines} testID={testID} />
      );
    case "none":
      return (
        <View
          className="rounded-md border border-border bg-surface-raised px-2 py-1.5"
          testID={testID}
        >
          <Text variant="caption">No diff available.</Text>
        </View>
      );
  }
});

interface PlainDiffBlockProps {
  text: string;
  maxLines: number;
  testID?: string;
}

/** Monospace fallback for diffs that do not parse: the web's `EventCodeBlock`. */
function PlainDiffBlock({ text, maxLines, testID }: PlainDiffBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => text.split("\n"), [text]);
  const hidden =
    !expanded && Number.isFinite(maxLines) && lines.length > maxLines
      ? lines.length - maxLines
      : 0;
  const visible = hidden > 0 ? lines.slice(0, maxLines) : lines;
  return (
    <View
      className="overflow-hidden rounded-md border border-border bg-surface-raised"
      testID={testID}
    >
      <ScrollView
        horizontal
        bounces={false}
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <View className="px-2 py-1.5" style={{ flexGrow: 1 }}>
          {visible.map((line, index) => (
            <Text
              key={index}
              variant="mono"
              tone="muted"
              numberOfLines={1}
              style={{ fontSize: DIFF_FONT_SIZE, lineHeight: DIFF_LINE_HEIGHT }}
            >
              {line.length === 0 ? " " : line}
            </Text>
          ))}
        </View>
      </ScrollView>
      {hidden > 0 ? (
        <Pressable
          onPress={() => setExpanded(true)}
          accessibilityRole="button"
          accessibilityLabel={`Show ${hidden} more lines`}
          className={cn(
            "items-center border-t border-border py-1 active:bg-state-hover",
          )}
        >
          <Text variant="chrome" tone="primary">
            Show {hidden.toLocaleString("en-US")} more lines
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
