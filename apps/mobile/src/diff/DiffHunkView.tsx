import { memo, useMemo } from "react";
import { Pressable, ScrollView, Text as RNText, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";
import { buildDiffPalette, type DiffPalette } from "./diff-colors";
import {
  buildDiffRows,
  formatDiffLineText,
  maxLineNumberDigits,
  type DiffHunkSource,
  type DiffRow,
} from "./diff-rows";
import type { DiffHunk, DiffLineType } from "./parse-unified-diff";

/** Web `GitDiffCardBody`: `--diffs-font-size: 12px; --diffs-line-height: 18px`. */
export const DIFF_FONT_SIZE = 12;
export const DIFF_LINE_HEIGHT = 18;
/** Fira Code advance width is 0.6em; gutter columns are sized from it. */
const DIFF_CHAR_WIDTH = DIFF_FONT_SIZE * 0.6;
const GUTTER_COLUMN_PADDING = 6;
const MARKER_COLUMN_WIDTH = 14;
const CONTENT_PADDING_X = 8;

function lineBackground(
  palette: DiffPalette,
  type: DiffLineType,
  gutter: boolean,
): string | undefined {
  switch (type) {
    case "add":
      return gutter ? palette.addedGutterBg : palette.addedLineBg;
    case "del":
      return gutter ? palette.removedGutterBg : palette.removedLineBg;
    case "context":
    case "meta":
      return gutter ? palette.gutterBg : undefined;
  }
}

interface GutterRowProps {
  type: DiffLineType | "hunk" | "more";
  oldNo: number | undefined;
  newNo: number | undefined;
  showLineNumbers: boolean;
  columnWidth: number;
  palette: DiffPalette;
  fontFamily: string;
}

const GutterRow = memo(function GutterRow({
  type,
  oldNo,
  newNo,
  showLineNumbers,
  columnWidth,
  palette,
  fontFamily,
}: GutterRowProps) {
  const isLine = type !== "hunk" && type !== "more";
  const backgroundColor = isLine
    ? lineBackground(palette, type, true)
    : type === "hunk"
      ? palette.hunkHeaderBg
      : palette.gutterBg;
  const marker = type === "add" ? "+" : type === "del" ? "-" : "";
  const markerColor =
    type === "add"
      ? palette.addedMarker
      : type === "del"
        ? palette.removedMarker
        : palette.gutterFg;
  const numberStyle = {
    fontFamily,
    fontSize: DIFF_FONT_SIZE,
    lineHeight: DIFF_LINE_HEIGHT,
    color: palette.gutterFg,
    textAlign: "right" as const,
    width: columnWidth,
    includeFontPadding: false,
  };
  return (
    <View
      style={{
        flexDirection: "row",
        height: DIFF_LINE_HEIGHT,
        backgroundColor,
        paddingLeft: GUTTER_COLUMN_PADDING,
      }}
    >
      {showLineNumbers ? (
        <>
          <RNText style={numberStyle} numberOfLines={1}>
            {isLine && oldNo !== undefined ? String(oldNo) : ""}
          </RNText>
          <RNText
            style={[numberStyle, { marginLeft: GUTTER_COLUMN_PADDING }]}
            numberOfLines={1}
          >
            {isLine && newNo !== undefined ? String(newNo) : ""}
          </RNText>
        </>
      ) : null}
      <RNText
        style={{
          fontFamily,
          fontSize: DIFF_FONT_SIZE,
          lineHeight: DIFF_LINE_HEIGHT,
          color: markerColor,
          width: MARKER_COLUMN_WIDTH,
          textAlign: "center",
          includeFontPadding: false,
        }}
        numberOfLines={1}
      >
        {marker}
      </RNText>
    </View>
  );
});

interface ContentRowProps {
  type: DiffLineType | "hunk";
  text: string;
  palette: DiffPalette;
  fontFamily: string;
}

const ContentRow = memo(function ContentRow({
  type,
  text,
  palette,
  fontFamily,
}: ContentRowProps) {
  const backgroundColor =
    type === "hunk"
      ? palette.hunkHeaderBg
      : lineBackground(palette, type, false);
  const color =
    type === "hunk"
      ? palette.hunkHeaderFg
      : type === "meta"
        ? palette.metaFg
        : palette.lineFg;
  return (
    <View
      style={{
        height: DIFF_LINE_HEIGHT,
        backgroundColor,
        paddingHorizontal: CONTENT_PADDING_X,
        justifyContent: "center",
      }}
    >
      <RNText
        style={{
          fontFamily,
          fontSize: DIFF_FONT_SIZE,
          lineHeight: DIFF_LINE_HEIGHT,
          color,
          includeFontPadding: false,
        }}
        numberOfLines={1}
      >
        {text}
      </RNText>
    </View>
  );
});

export interface DiffHunkViewProps {
  /** Hunks to draw, in order. */
  hunks: readonly DiffHunk[];
  /** False for synthesized patches whose hunk headers are invented. */
  showLineNumbers?: boolean;
  /**
   * Visible line cap; beyond it a "Show N more lines" row appears. Pass
   * `Infinity` to show everything.
   */
  maxLines?: number;
  /** Controlled expansion; when omitted the cap is never lifted. */
  expanded?: boolean;
  onExpand?: () => void;
  testID?: string;
}

/**
 * The body of a diff card: every hunk as fixed-height monospace rows with a
 * pinned gutter (old/new line numbers + `+`/`-` marker) and a horizontally
 * scrolling content column. Rows are memoized; one `Text` per line.
 */
export const DiffHunkView = memo(function DiffHunkView({
  hunks,
  showLineNumbers = true,
  maxLines,
  expanded = false,
  onExpand,
  testID,
}: DiffHunkViewProps) {
  const { tokens, fonts } = useTheme();
  const palette = useMemo(() => buildDiffPalette(tokens), [tokens]);
  const fontFamily = fonts.mono.regular;
  const file = useMemo<DiffHunkSource>(() => ({ hunks }), [hunks]);
  const { rows, hiddenLines } = useMemo(
    () => buildDiffRows(file, { maxLines, expanded }),
    [file, maxLines, expanded],
  );
  const digits = useMemo(() => maxLineNumberDigits(file), [file]);
  const columnWidth = Math.ceil(digits * DIFF_CHAR_WIDTH) + 2;

  const gutter = rows.map((row) => (
    <GutterRow
      key={row.key}
      type={row.kind === "line" ? row.line.type : row.kind}
      oldNo={row.kind === "line" ? row.line.oldNo : undefined}
      newNo={row.kind === "line" ? row.line.newNo : undefined}
      showLineNumbers={showLineNumbers}
      columnWidth={columnWidth}
      palette={palette}
      fontFamily={fontFamily}
    />
  ));

  const content = rows.map((row) => renderContentRow(row, palette, fontFamily));

  return (
    <View style={{ flexDirection: "row" }} testID={testID}>
      <View
        style={{
          borderRightWidth: 1,
          borderRightColor: palette.border,
        }}
      >
        {gutter}
      </View>
      <ScrollView
        horizontal
        bounces={false}
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <View style={{ flexGrow: 1 }}>{content}</View>
      </ScrollView>
      {hiddenLines > 0 ? (
        <MoreOverlay hiddenLines={hiddenLines} onExpand={onExpand} />
      ) : null}
    </View>
  );
});

function renderContentRow(
  row: DiffRow,
  palette: DiffPalette,
  fontFamily: string,
) {
  switch (row.kind) {
    case "hunk":
      return (
        <ContentRow
          key={row.key}
          type="hunk"
          text={row.header}
          palette={palette}
          fontFamily={fontFamily}
        />
      );
    case "line":
      return (
        <ContentRow
          key={row.key}
          type={row.line.type}
          text={formatDiffLineText(row.line.text)}
          palette={palette}
          fontFamily={fontFamily}
        />
      );
    case "more":
      // The gutter draws a blank row at this height; the overlay button
      // (absolutely positioned over both columns) carries the label.
      return <View key={row.key} style={{ height: DIFF_LINE_HEIGHT }} />;
  }
}

function MoreOverlay({
  hiddenLines,
  onExpand,
}: {
  hiddenLines: number;
  onExpand: (() => void) | undefined;
}) {
  return (
    <Pressable
      onPress={onExpand}
      disabled={!onExpand}
      accessibilityRole="button"
      accessibilityLabel={`Show ${hiddenLines} more lines`}
      testID="diff-show-more"
      className="absolute inset-x-0 bottom-0 flex-row items-center justify-center bg-surface-raised-solid active:bg-state-hover"
      style={{ height: DIFF_LINE_HEIGHT }}
    >
      <Text variant="chrome" tone="primary">
        Show {hiddenLines.toLocaleString("en-US")} more lines
      </Text>
    </Pressable>
  );
}
