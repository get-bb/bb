import { describe, expect, it } from "vitest";
import { columnWidths, truncateCell } from "../table.js";

describe("CLI tables", () => {
  it("measures terminal columns for wide-script cells", () => {
    expect(columnWidths([["abc", "修复"]], [1, 1])).toEqual([3, 4]);
  });

  it("truncates cells by display width without splitting graphemes", () => {
    expect(truncateCell("修复侧边栏", 7)).toBe("修复侧…");
    expect(truncateCell("👨‍👩‍👧 family", 3)).toBe("👨‍👩‍👧…");
    expect(truncateCell("𠮷".repeat(40), 60)).toBe(`${"𠮷".repeat(29)}…`);
  });
});
