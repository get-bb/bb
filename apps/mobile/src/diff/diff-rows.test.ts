import { describe, expect, it } from "vitest";
import { nativeThemes } from "@/theme/theme.native";
import { buildDiffPalette, withAlpha } from "./diff-colors";
import {
  buildDiffRows,
  formatDiffLineText,
  maxLineNumberDigits,
  type DiffHunkSource,
} from "./diff-rows";
import type { DiffHunk } from "./parse-unified-diff";

function hunk(start: number, count: number): DiffHunk {
  return {
    header: `@@ -${start},${count} +${start},${count} @@`,
    oldStart: start,
    oldLines: count,
    newStart: start,
    newLines: count,
    lines: Array.from({ length: count }, (_, index) => ({
      type: "context" as const,
      oldNo: start + index,
      newNo: start + index,
      text: `line ${start + index}`,
    })),
  };
}

function file(...hunks: DiffHunk[]): DiffHunkSource {
  return { hunks };
}

describe("buildDiffRows", () => {
  it("flattens hunks into header + line rows with stable keys", () => {
    const { rows, hiddenLines, totalLines } = buildDiffRows(
      file(hunk(1, 2), hunk(10, 1)),
    );
    expect(rows.map((row) => row.key)).toEqual([
      "h0",
      "h0:0",
      "h0:1",
      "h1",
      "h1:0",
    ]);
    expect(rows[0]).toMatchObject({ kind: "hunk", header: "@@ -1,2 +1,2 @@" });
    expect(hiddenLines).toBe(0);
    expect(totalLines).toBe(3);
  });

  it("caps large diffs behind a more row, but not for a handful of extra lines", () => {
    const capped = buildDiffRows(file(hunk(1, 50), hunk(100, 50)), {
      maxLines: 30,
    });
    expect(capped.hiddenLines).toBe(70);
    expect(capped.totalLines).toBe(100);
    const last = capped.rows[capped.rows.length - 1]!;
    expect(last).toEqual({ kind: "more", key: "more", hiddenLines: 70 });
    expect(capped.rows.filter((row) => row.kind === "line")).toHaveLength(30);
    // Only the first hunk header is visible; the second is hidden with its lines.
    expect(capped.rows.filter((row) => row.kind === "hunk")).toHaveLength(1);

    const slack = buildDiffRows(file(hunk(1, 45)), { maxLines: 30 });
    expect(slack.hiddenLines).toBe(0);
    expect(slack.rows).toHaveLength(46);
  });

  it("does not hide a hunk header that sits exactly at the cap", () => {
    const result = buildDiffRows(file(hunk(1, 30), hunk(100, 60)), {
      maxLines: 30,
    });
    expect(result.rows.filter((row) => row.kind === "hunk")).toHaveLength(1);
    expect(result.rows[result.rows.length - 1]).toMatchObject({
      kind: "more",
      hiddenLines: 60,
    });
  });

  it("shows everything when expanded or uncapped", () => {
    const big = file(hunk(1, 500));
    expect(
      buildDiffRows(big, { maxLines: 10, expanded: true }).hiddenLines,
    ).toBe(0);
    expect(
      buildDiffRows(big, { maxLines: Number.POSITIVE_INFINITY }).rows,
    ).toHaveLength(501);
  });
});

describe("gutter + text helpers", () => {
  it("sizes the gutter from the widest line number", () => {
    expect(maxLineNumberDigits(file())).toBe(2);
    expect(maxLineNumberDigits(file(hunk(1, 5)))).toBe(2);
    expect(maxLineNumberDigits(file(hunk(990, 20)))).toBe(4);
  });

  it("expands tabs", () => {
    expect(formatDiffLineText("\tif (x) {\n")).toBe("    if (x) {\n");
    expect(formatDiffLineText("plain")).toBe("plain");
  });
});

describe("withAlpha", () => {
  it("rewrites hex and rgb colors and leaves unknown strings alone", () => {
    expect(withAlpha("#40a02b", 0.14)).toBe("rgba(64, 160, 43, 0.14)");
    expect(withAlpha("#abc", 0.5)).toBe("rgba(170, 187, 204, 0.5)");
    expect(withAlpha("#40a02bff", 0.2)).toBe("rgba(64, 160, 43, 0.2)");
    expect(withAlpha("rgba(76, 79, 105, 0.025)", 0.3)).toBe(
      "rgba(76, 79, 105, 0.3)",
    );
    expect(withAlpha("rgb(1 2 3 / 50%)", 1)).toBe("rgba(1, 2, 3, 1)");
    expect(withAlpha("transparent", 0.5)).toBe("transparent");
    expect(withAlpha("#zz", 0.5)).toBe("#zz");
  });

  it("builds a palette from the theme anchors", () => {
    const tokens = nativeThemes.default.light;
    const palette = buildDiffPalette(tokens);
    expect(palette.addedLineBg).toBe(withAlpha(tokens.diffAdded, 0.14));
    expect(palette.addedLineBg).toMatch(/^rgba\(/u);
    expect(palette.removedGutterBg).toBe(withAlpha(tokens.diffRemoved, 0.26));
    expect(palette.addedMarker).toBe(tokens.diffAdded);
    expect(palette.hunkHeaderFg).toBe(tokens.mutedForeground);
  });
});
