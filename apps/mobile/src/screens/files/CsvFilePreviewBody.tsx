import { memo, useCallback, useMemo } from "react";
import {
  FlatList,
  ScrollView,
  Text as RNText,
  View,
  type ListRenderItem,
} from "react-native";
import { buildCsvPreviewData, getCsvTruncationNote } from "@/data/files";
import { useTheme } from "@/theme";
import { Text } from "@/ui";

const CELL_WIDTH = 140;
const ROW_HEIGHT = 32;
const CELL_PADDING = 8;
const FONT_SIZE = 12;

interface CsvRowProps {
  cells: readonly string[];
  columnCount: number;
  header: boolean;
  fontFamily: string;
  color: string;
  borderColor: string;
  backgroundColor: string | undefined;
}

const CsvRow = memo(function CsvRow({
  cells,
  columnCount,
  header,
  fontFamily,
  color,
  borderColor,
  backgroundColor,
}: CsvRowProps) {
  const padded = Array.from(
    { length: columnCount },
    (_, index) => cells[index] ?? "",
  );
  return (
    <View
      style={{
        flexDirection: "row",
        height: ROW_HEIGHT,
        backgroundColor,
        borderBottomWidth: 1,
        borderBottomColor: borderColor,
      }}
    >
      {padded.map((cell, index) => (
        <View
          key={index}
          style={{
            width: CELL_WIDTH,
            justifyContent: "center",
            paddingHorizontal: CELL_PADDING,
            borderRightWidth: 1,
            borderRightColor: borderColor,
          }}
        >
          <RNText
            numberOfLines={1}
            style={{
              fontFamily,
              fontSize: FONT_SIZE,
              color,
              fontWeight: header ? "600" : "400",
            }}
          >
            {cell}
          </RNText>
        </View>
      ))}
    </View>
  );
});

interface CsvFilePreviewBodyProps {
  content: string;
  testID?: string;
}

/** A horizontally scrollable grid: the first row sticky as the header. */
export function CsvFilePreviewBody({
  content,
  testID,
}: CsvFilePreviewBodyProps) {
  const { tokens, fonts } = useTheme();
  const data = useMemo(() => buildCsvPreviewData(content), [content]);
  const note = getCsvTruncationNote(data);
  const fontFamily = fonts.mono.regular;
  const renderItem = useCallback<ListRenderItem<string[]>>(
    ({ item, index }) => (
      <CsvRow
        cells={item}
        columnCount={data.columnCount}
        header={index === 0}
        fontFamily={fontFamily}
        color={tokens.foreground}
        borderColor={tokens.border}
        backgroundColor={
          index === 0
            ? tokens.surfaceRaisedSolid
            : index % 2 === 0
              ? tokens.surfaceRecessedSoftSolid
              : undefined
        }
      />
    ),
    [
      data.columnCount,
      fontFamily,
      tokens.border,
      tokens.foreground,
      tokens.surfaceRaisedSolid,
      tokens.surfaceRecessedSoftSolid,
    ],
  );
  const width = Math.max(1, data.columnCount) * CELL_WIDTH;
  return (
    <View className="flex-1" testID={testID}>
      {note ? (
        <View className="px-4 py-2">
          <Text variant="caption">{note}</Text>
        </View>
      ) : null}
      <ScrollView
        horizontal
        bounces={false}
        nestedScrollEnabled
        style={{ flex: 1 }}
      >
        <FlatList
          data={data.rows}
          keyExtractor={(_row, index) => String(index)}
          renderItem={renderItem}
          stickyHeaderIndices={[0]}
          getItemLayout={(_rows, index) => ({
            length: ROW_HEIGHT,
            offset: ROW_HEIGHT * index,
            index,
          })}
          style={{ width }}
          testID="file-preview-csv"
        />
      </ScrollView>
    </View>
  );
}
