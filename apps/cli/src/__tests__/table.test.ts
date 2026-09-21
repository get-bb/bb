import { describe, expect, it } from "vitest";
import { columnWidths, renderBorderlessTable, truncateCell } from "../table.js";

describe("CLI tables", () => {
  it.each(["🇺🇸", "❤️", "✈️", "1️⃣", "⌚"])(
    "preserves %s in rendered tables and truncates at grapheme boundaries",
    (emoji) => {
      const title = emoji.repeat(6);
      const rows = [[title]];
      expect(
        renderBorderlessTable(
          { head: ["TITLE"], colWidths: columnWidths(rows, [5]) },
          rows,
        ),
      ).toBe(`TITLE       \n------------\n${title}`);

      const truncatedRows = [[truncateCell(title, 7)]];
      expect(
        renderBorderlessTable(
          { head: ["TITLE"], colWidths: columnWidths(truncatedRows, [5]) },
          truncatedRows,
        ),
      ).toBe(`TITLE  \n-------\n${emoji.repeat(3)}…`);
    },
  );

  it("measures terminal columns for wide-script cells", () => {
    expect(columnWidths([["abc", "修复"]], [1, 1])).toEqual([3, 4]);
  });

  it("truncates cells by display width without splitting graphemes", () => {
    expect(truncateCell("修复侧边栏", 7)).toBe("修复侧…");
    expect(truncateCell("👨‍👩‍👧 family", 3)).toBe("👨‍👩‍👧…");
    expect(truncateCell("𠮷".repeat(40), 60)).toBe(`${"𠮷".repeat(29)}…`);
  });
});
