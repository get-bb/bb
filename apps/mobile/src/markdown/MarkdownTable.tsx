import type { AlignType, Table, TableCell } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import { memo, useMemo } from "react";
import { ScrollView, Text as RNText, View } from "react-native";
import { FONT_FAMILIES } from "@/theme/fonts";
import { nativeTypography } from "@/theme/theme.native";
import { buildTableModel } from "./blocks";
import { useMarkdownContext } from "./MarkdownContext";
import { renderInline } from "./render-inline";

/**
 * RN has no table layout, so every column gets an explicit width estimated
 * from its longest cell (in characters) and clamped; rows are flex rows of
 * fixed-width cells inside a horizontal ScrollView.
 */
const MIN_COLUMN_WIDTH = 64;
const MAX_COLUMN_WIDTH = 260;
const CELL_HORIZONTAL_PADDING = 8;
// Average glyph advance of Inter at 14px; over-estimates so short cells and
// medium-weight headers do not wrap.
const APPROX_CHAR_WIDTH = 8.4;
// Absorbs wide glyph runs (`m`, capitals) the average misses on short words.
const COLUMN_SLACK = 12;

function estimateColumnWidths(
  header: TableCell[],
  rows: TableCell[][],
  columnCount: number,
): number[] {
  const widths: number[] = [];
  for (let column = 0; column < columnCount; column += 1) {
    let longest = 0;
    const cells = [header[column], ...rows.map((row) => row[column])];
    for (const cell of cells) {
      if (cell === undefined) continue;
      // Longest line wins; cells with hard breaks wrap anyway.
      for (const line of mdastToString(cell).split("\n")) {
        longest = Math.max(longest, line.length);
      }
    }
    widths.push(
      Math.min(
        MAX_COLUMN_WIDTH,
        Math.max(
          MIN_COLUMN_WIDTH,
          Math.ceil(longest * APPROX_CHAR_WIDTH) +
            CELL_HORIZONTAL_PADDING * 2 +
            COLUMN_SLACK,
        ),
      ),
    );
  }
  return widths;
}

function textAlign(align: AlignType): "left" | "center" | "right" {
  return align === null ? "left" : align;
}

export const MarkdownTable = memo(function MarkdownTable({
  table,
}: {
  table: Table;
}) {
  const ctx = useMarkdownContext();
  const { tokens } = ctx;
  const model = useMemo(() => buildTableModel(table), [table]);
  const widths = useMemo(
    () => estimateColumnWidths(model.header, model.rows, model.columnCount),
    [model],
  );
  const type = nativeTypography.xs;
  const cellText = (
    cell: TableCell,
    column: number,
    header: boolean,
    key: string,
  ) => (
    <View
      key={key}
      style={{
        width: widths[column],
        paddingHorizontal: CELL_HORIZONTAL_PADDING,
        paddingVertical: 4,
        borderRightWidth: 1,
        borderColor: tokens.border,
        justifyContent: "center",
      }}
    >
      <RNText
        selectable={ctx.selectable}
        style={{
          fontFamily: header
            ? FONT_FAMILIES.sans.medium
            : FONT_FAMILIES.sans.regular,
          fontWeight: header ? "500" : "400",
          fontSize: type.fontSize,
          lineHeight: type.lineHeight,
          color: tokens.foreground,
          textAlign: textAlign(model.align[column] ?? null),
        }}
      >
        {renderInline(
          cell.children,
          ctx,
          header
            ? { weight: "medium", italic: false, strike: false }
            : undefined,
          key,
        )}
      </RNText>
    </View>
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      nestedScrollEnabled
    >
      <View
        style={{
          borderWidth: 1,
          borderRightWidth: 0,
          borderColor: tokens.border,
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            backgroundColor: tokens.surfaceRecessed,
            borderBottomWidth: 1,
            borderColor: tokens.border,
          }}
        >
          {model.header.map((cell, column) =>
            cellText(cell, column, true, `h.${column}`),
          )}
        </View>
        {model.rows.map((row, rowIndex) => (
          <View
            key={rowIndex}
            style={{
              flexDirection: "row",
              borderBottomWidth: rowIndex < model.rows.length - 1 ? 1 : 0,
              borderColor: tokens.border,
            }}
          >
            {row.map((cell, column) =>
              cellText(cell, column, false, `r.${rowIndex}.${column}`),
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
});
