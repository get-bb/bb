import { describe, expect, it } from "vitest";
import {
  countWords,
  displayWidth,
  truncateToWidth,
  truncateToWidthAtWordBoundary,
} from "../../src/services/lib/text-measure.js";

describe("text measure", () => {
  it("counts words in scripts that do not separate them with spaces", () => {
    expect(countWords("fix the flaky login bug")).toBe(5);
    expect(
      countWords("请帮我修复侧边栏线程行在分叉之后显示错误环境标记的问题"),
    ).toBeGreaterThanOrEqual(5);
    expect(
      countWords("サイドバーのスレッド行が誤った環境バッジを表示する"),
    ).toBeGreaterThanOrEqual(5);
  });

  it("ignores punctuation and whitespace when counting words", () => {
    expect(countWords("  fix,  the   bug!  ")).toBe(3);
    expect(countWords("")).toBe(0);
  });

  it("charges wide characters two columns and narrow characters one", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("修复")).toBe(4);
    expect(displayWidth("포크")).toBe(4);
    expect(displayWidth("修复 bug")).toBe(8);
  });

  it("treats an astral ideograph as a single wide character", () => {
    expect("𠮷".length).toBe(2);
    expect(displayWidth("𠮷")).toBe(2);
  });

  it("treats a joined emoji sequence as one cluster", () => {
    expect(displayWidth("👨‍👩‍👧")).toBe(2);
    expect(truncateToWidth("👨‍👩‍👧x", 2)).toBe("👨‍👩‍👧");
  });

  it("never emits a lone surrogate when truncating", () => {
    expect(truncateToWidth("𠮷𠮷𠮷", 3)).toBe("𠮷");
    expect(truncateToWidth("𠮷𠮷𠮷", 3)).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u,
    );
  });

  it("returns an empty string when nothing fits", () => {
    expect(truncateToWidth("修", 1)).toBe("");
    expect(truncateToWidth("", 10)).toBe("");
  });

  it("breaks at the last word boundary that fits the budget", () => {
    expect(truncateToWidthAtWordBoundary("alpha beta gamma delta", 14)).toBe(
      "alpha beta",
    );
    expect(truncateToWidthAtWordBoundary("alpha beta", 40)).toBe("alpha beta");
  });

  it("hard-cuts when the first word alone exceeds the budget", () => {
    expect(truncateToWidthAtWordBoundary("abcdefghij", 4)).toBe("abcd");
  });
});
