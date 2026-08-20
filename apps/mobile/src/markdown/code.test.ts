import { describe, expect, it } from "vitest";
import {
  CODE_HIGHLIGHT_CHAR_LIMIT,
  codeTokenColor,
  normalizeCodeLanguage,
  tokenizeCodeLines,
} from "./code";

const TOKENS = {
  foreground: "#111111",
  mutedForeground: "#666666",
  subtleForeground: "#999999",
};

describe("tokenizeCodeLines", () => {
  it("splits on newlines and merges adjacent spans of one type", () => {
    const lines = tokenizeCodeLines(
      "const a = 1;\n\n// hi there\nreturn `t${a}`\n",
      "ts",
    );
    expect(lines.map((line) => line.map((span) => span.text).join(""))).toEqual(
      ["const a = 1;", "", "// hi there", "return `t${a}`", ""],
    );
    expect(lines[0]![0]).toEqual({ text: "const", type: "keyword" });
    // Comment tokens carry their newline; it must not leak into the text.
    expect(lines[2]).toEqual([{ text: "// hi there", type: "comment" }]);
    // "`" + "t" are two string tokens that merge into one span.
    const stringSpans = lines[3]!.filter((span) => span.type === "string");
    expect(stringSpans[0]).toEqual({ text: "`t", type: "string" });
  });

  it("uses presets for known languages and stays plain for mermaid / oversized input", () => {
    const python = tokenizeCodeLines("def f():\n    pass", "python");
    expect(python[0]![0]).toEqual({ text: "def", type: "keyword" });

    const mermaid = tokenizeCodeLines("graph TD\nA-->B", "mermaid");
    expect(mermaid).toEqual([
      [{ text: "graph TD", type: "identifier" }],
      [{ text: "A-->B", type: "identifier" }],
    ]);

    const huge = "x".repeat(CODE_HIGHLIGHT_CHAR_LIMIT + 1);
    expect(tokenizeCodeLines(huge, "js")).toEqual([
      [{ text: huge, type: "identifier" }],
    ]);
  });

  it("renders an unknown language through the core tokenizer", () => {
    const lines = tokenizeCodeLines('echo "hi" # c', "bash");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.map((span) => span.text).join("")).toBe('echo "hi" # c');
    expect(lines[0]!.some((span) => span.type === "string")).toBe(true);
  });
});

describe("codeTokenColor", () => {
  it("maps neutral token types to theme tiers and hued types per mode", () => {
    expect(codeTokenColor("identifier", "light", TOKENS)).toBe("#111111");
    expect(codeTokenColor("sign", "light", TOKENS)).toBe("#666666");
    expect(codeTokenColor("comment", "dark", TOKENS)).toBe("#999999");
    expect(codeTokenColor("keyword", "light", TOKENS)).not.toBe(
      codeTokenColor("keyword", "dark", TOKENS),
    );
  });
});

describe("normalizeCodeLanguage", () => {
  it("lowercases and trims, null for empty", () => {
    expect(normalizeCodeLanguage(" TypeScript ")).toBe("typescript");
    expect(normalizeCodeLanguage("")).toBeNull();
    expect(normalizeCodeLanguage(null)).toBeNull();
  });
});
