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

  it.each(["sh", "bash", "zsh", "shell", "console"])(
    "lexes a `#` comment in a %s fence as a comment, not JS punctuation",
    (language) => {
      const lines = tokenizeCodeLines(
        "# install the plugin\nbb plugin install ./plugins/monokai",
        language,
      );
      expect(lines[0]).toEqual([
        { text: "# install the plugin", type: "comment" },
      ]);
      // The JS lexer reads `/plugins/monokai` as a regex literal (string).
      expect(lines[1]!.some((span) => span.type === "string")).toBe(false);
    },
  );

  it.each([null, "ruby"])(
    "lexes a fence with language %j with the JavaScript tokenizer",
    (language) => {
      const lines = tokenizeCodeLines(
        "const a = 'x' // hi\nfunction f() { return a }",
        language,
      );
      expect(lines).toHaveLength(2);
      expect(lines[0]![0]).toEqual({ text: "const", type: "keyword" });
      expect(lines[0]!.at(-1)).toEqual({ text: "// hi", type: "comment" });
      expect(lines[1]![0]).toEqual({ text: "function", type: "keyword" });
    },
  );
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
