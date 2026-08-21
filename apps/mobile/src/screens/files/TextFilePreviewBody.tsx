import type { FilePreviewLineRange } from "@bb/client-core";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  Text as RNText,
  View,
  type LayoutChangeEvent,
  type ListRenderItem,
} from "react-native";
import {
  splitPreviewLines,
  truncateFilePreviewCode,
  type FilePreviewCodeTruncation,
} from "@/data/files";
import { withAlpha } from "@/diff/diff-colors";
import { useTheme } from "@/theme";
import { Text } from "@/ui";

/** Same metrics as the diff cards (`DiffHunkView`). */
const FILE_PREVIEW_FONT_SIZE = 12;
const FILE_PREVIEW_LINE_HEIGHT = 18;
const CHAR_WIDTH = FILE_PREVIEW_FONT_SIZE * 0.6;
const GUTTER_PADDING = 8;
const CONTENT_PADDING = 10;
/** Lines longer than this are clipped (minified bundles would make a mile-wide row). */
const MAX_LINE_CHARS = 400;
const SHOW_MORE_ROW_HEIGHT = 44;
const LIST_PADDING_TOP = 8;
const FLASH_MS = 1600;

export interface TextFilePreviewBodyHandle {
  /** Scroll so `lineNumber` sits near the top third of the viewport. */
  scrollToLine: (lineNumber: number) => void;
}

interface TextFilePreviewBodyProps {
  content: string;
  /** Highlighted on mount and scrolled into view. */
  lineRange: FilePreviewLineRange | null;
  /** Long-pressed a line (1-based). Omit to disable line actions. */
  onLongPressLine?: (lineNumber: number) => void;
  testID?: string;
}

interface LineRowProps {
  index: number;
  text: string;
  gutterWidth: number;
  highlighted: boolean;
  selected: boolean;
  fontFamily: string;
  gutterColor: string;
  textColor: string;
  highlightColor: string;
  selectedColor: string;
  onLongPress?: (lineNumber: number) => void;
}

const LineRow = memo(function LineRow({
  index,
  text,
  gutterWidth,
  highlighted,
  selected,
  fontFamily,
  gutterColor,
  textColor,
  highlightColor,
  selectedColor,
  onLongPress,
}: LineRowProps) {
  const lineNumber = index + 1;
  const backgroundColor = selected
    ? selectedColor
    : highlighted
      ? highlightColor
      : undefined;
  return (
    <Pressable
      onLongPress={onLongPress ? () => onLongPress(lineNumber) : undefined}
      delayLongPress={300}
      disabled={!onLongPress}
      style={{
        flexDirection: "row",
        height: FILE_PREVIEW_LINE_HEIGHT,
        backgroundColor,
      }}
      testID={`file-line-${lineNumber}`}
    >
      <RNText
        style={{
          fontFamily,
          fontSize: FILE_PREVIEW_FONT_SIZE,
          lineHeight: FILE_PREVIEW_LINE_HEIGHT,
          color: gutterColor,
          width: gutterWidth,
          textAlign: "right",
          paddingRight: GUTTER_PADDING,
          includeFontPadding: false,
        }}
        numberOfLines={1}
      >
        {lineNumber}
      </RNText>
      <RNText
        style={{
          fontFamily,
          fontSize: FILE_PREVIEW_FONT_SIZE,
          lineHeight: FILE_PREVIEW_LINE_HEIGHT,
          color: textColor,
          paddingLeft: CONTENT_PADDING,
          paddingRight: CONTENT_PADDING,
          includeFontPadding: false,
        }}
        numberOfLines={1}
      >
        {text.length > MAX_LINE_CHARS
          ? `${text.slice(0, MAX_LINE_CHARS)}…`
          : text}
      </RNText>
    </Pressable>
  );
});

function isWithin(range: FilePreviewLineRange | null, lineNumber: number) {
  return (
    range !== null &&
    lineNumber >= range.startLineNumber &&
    lineNumber <= range.endLineNumber
  );
}

/**
 * Monospace source view: a virtualized line list (fixed-height rows, so
 * jump-to-line is exact) inside a horizontal scroller sized to the longest
 * line, line numbers in a gutter, the requested range tinted, long-press on
 * a line for the actions sheet. Files above the code budget render a prefix
 * with a "Show whole file" row. Always a plain FlatList: gorhom's sheet list
 * does not lay out inside the horizontal scroller, and a nested native list
 * still scrolls inside the panel sheet.
 */
export const TextFilePreviewBody = forwardRef<
  TextFilePreviewBodyHandle,
  TextFilePreviewBodyProps
>(function TextFilePreviewBody(
  { content, lineRange, onLongPressLine, testID },
  ref,
) {
  const { tokens, fonts } = useTheme();
  const [showWholeFile, setShowWholeFile] = useState(false);
  const truncation = useMemo<FilePreviewCodeTruncation | null>(
    () => (showWholeFile ? null : truncateFilePreviewCode(content)),
    [content, showWholeFile],
  );
  const lines = useMemo(
    () => splitPreviewLines(truncation ? truncation.contents : content),
    [content, truncation],
  );
  const maxChars = useMemo(
    () =>
      lines.reduce(
        (max, line) => Math.max(max, Math.min(line.length, MAX_LINE_CHARS)),
        0,
      ),
    [lines],
  );
  const digits = String(Math.max(lines.length, 1)).length;
  const gutterWidth = Math.ceil(digits * CHAR_WIDTH) + GUTTER_PADDING * 2;
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }, []);
  const contentWidth = Math.max(
    viewport.width,
    gutterWidth + CONTENT_PADDING * 2 + Math.ceil(maxChars * CHAR_WIDTH) + 16,
  );

  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  // A jumped-to line is tinted briefly so the eye finds it.
  const [flashLine, setFlashLine] = useState<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    },
    [],
  );
  const listRef = useRef<FlatList<string>>(null);
  const scrollToLine = useCallback(
    (lineNumber: number) => {
      const index = Math.min(Math.max(lineNumber, 1), lines.length) - 1;
      if (index < 0) return;
      listRef.current?.scrollToIndex({
        index,
        viewPosition: 0.3,
        animated: false,
      });
      setFlashLine(index + 1);
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashLine(null), FLASH_MS);
    },
    [lines.length],
  );
  useImperativeHandle(ref, () => ({ scrollToLine }), [scrollToLine]);

  const highlightColor = withAlpha(tokens.primary, 0.18);
  const selectedColor = withAlpha(tokens.primary, 0.3);
  const handleLongPress = useMemo(
    () =>
      onLongPressLine
        ? (lineNumber: number) => {
            setSelectedLine(lineNumber);
            onLongPressLine(lineNumber);
          }
        : undefined,
    [onLongPressLine],
  );
  const fontFamily = fonts.mono.regular;
  const renderItem = useCallback<ListRenderItem<string>>(
    ({ item, index }) => (
      <LineRow
        index={index}
        text={item}
        gutterWidth={gutterWidth}
        highlighted={isWithin(lineRange, index + 1) || flashLine === index + 1}
        selected={selectedLine === index + 1}
        fontFamily={fontFamily}
        gutterColor={tokens.mutedForeground}
        textColor={tokens.foreground}
        highlightColor={highlightColor}
        selectedColor={selectedColor}
        onLongPress={handleLongPress}
      />
    ),
    [
      flashLine,
      fontFamily,
      gutterWidth,
      handleLongPress,
      highlightColor,
      lineRange,
      selectedColor,
      selectedLine,
      tokens.foreground,
      tokens.mutedForeground,
    ],
  );
  const initialIndex =
    lineRange === null
      ? undefined
      : Math.min(Math.max(lineRange.startLineNumber - 1, 0), lines.length - 1);

  const footer = truncation ? (
    <Pressable
      accessibilityRole="button"
      onPress={() => setShowWholeFile(true)}
      className="flex-row items-center justify-center gap-2 border-t border-border bg-surface-raised-solid active:bg-state-hover"
      style={{ height: SHOW_MORE_ROW_HEIGHT, width: contentWidth }}
      testID="file-preview-show-whole-file"
    >
      <Text variant="chrome" tone="primary">
        Showing {truncation.renderedLineCount.toLocaleString("en-US")} of{" "}
        {truncation.totalLineCount.toLocaleString("en-US")} lines · Show whole
        file
      </Text>
    </Pressable>
  ) : null;

  return (
    <View className="flex-1" onLayout={onLayout} testID={testID}>
      {viewport.height > 0 ? (
        <ScrollView
          horizontal
          bounces={false}
          showsHorizontalScrollIndicator
          nestedScrollEnabled
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <FlatList
            ref={listRef}
            data={lines}
            extraData={`${selectedLine ?? 0}:${flashLine ?? 0}:${gutterWidth}`}
            keyExtractor={(_line, index) => String(index)}
            renderItem={renderItem}
            getItemLayout={(_data, index) => ({
              length: FILE_PREVIEW_LINE_HEIGHT,
              offset: LIST_PADDING_TOP + FILE_PREVIEW_LINE_HEIGHT * index,
              index,
            })}
            initialScrollIndex={initialIndex}
            initialNumToRender={
              Math.ceil(viewport.height / FILE_PREVIEW_LINE_HEIGHT) + 10
            }
            windowSize={7}
            removeClippedSubviews
            style={{ width: contentWidth, height: viewport.height }}
            contentContainerStyle={{
              paddingTop: LIST_PADDING_TOP,
              paddingBottom: 24,
            }}
            ListFooterComponent={footer}
            testID="file-preview-lines"
          />
        </ScrollView>
      ) : null}
    </View>
  );
});
