import { describe, expect, it } from "vitest";
import { highlightMarkdownCode } from "./markdown-code-highlight.js";

function tokens(html: string): Array<[string, string]> {
  return [
    ...html.matchAll(/class="sh__token--(\w+)"[^>]*>([^<]*)<\/span>/g),
  ].map((match) => [match[1]!, match[2]!]);
}

function tokenTypes(html: string): string[] {
  return tokens(html).map(([type]) => type);
}

describe("highlightMarkdownCode", () => {
  const shell = "# install the plugin\nbb plugin install ./plugins/monokai";

  it.each(["sh", "bash", "shell", "zsh", "console", "shellscript"])(
    "lexes a `#` comment in a %s fence as a comment, not a JS sign",
    (language) => {
      const html = highlightMarkdownCode({ code: shell, language });
      expect(tokens(html)).toContainEqual(["comment", "# install the plugin"]);
      // The JS lexer reads `/plugins/monokai` as a regex literal (string).
      expect(tokenTypes(html)).not.toContain("string");
    },
  );

  it.each([null, "ruby"])(
    "keeps the JavaScript lexer for a fence with language %j",
    (language) => {
      const html = highlightMarkdownCode({
        code: "const a = 1 // hi",
        language,
      });
      expect(tokens(html)).toContainEqual(["keyword", "const"]);
      expect(tokens(html)).toContainEqual(["comment", "// hi"]);
    },
  );

  it("keeps the previously mapped aliases highlighted", () => {
    expect(
      tokens(highlightMarkdownCode({ code: "# c\nx = 1", language: "py" })),
    ).toContainEqual(["comment", "# c"]);
    expect(
      tokens(
        highlightMarkdownCode({ code: "int main() {}", language: "hpp" }),
      ),
    ).toContainEqual(["class", "int"]);
    expect(
      tokens(highlightMarkdownCode({ code: "a { color: red }", language: "less" })),
    ).toContainEqual(["property", "color"]);
    expect(
      tokens(highlightMarkdownCode({ code: "fun f() {}", language: "kt" })),
    ).toContainEqual(["keyword", "fun"]);
  });

  it("highlights languages agents emit that v1 never mapped", () => {
    expect(
      tokens(highlightMarkdownCode({ code: "# top\nkey: v", language: "yaml" })),
    ).toContainEqual(["comment", "# top"]);
    expect(
      tokens(highlightMarkdownCode({ code: "-- c\nSELECT 1", language: "sql" })),
    ).toContainEqual(["comment", "-- c"]);
  });
});
