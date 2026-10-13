import { describe, expect, it } from "vitest";
import {
  compileHighlightRules,
  findHighlightRanges,
} from "./highlight-rules.js";
import { IMPORTED_VSCODE_SETTINGS } from "./vscode-settings.js";

const MARKDOWN = { path: "notes/today.md", languageId: "markdown" };

function highlight(
  lines: readonly string[],
  document = MARKDOWN,
): { text: string; color: string | undefined }[] {
  const rules = compileHighlightRules(IMPORTED_VSCODE_SETTINGS, document);
  return findHighlightRanges(rules, lines).map((range) => ({
    text: (lines[range.lineNumber - 1] ?? "").slice(
      range.startColumn - 1,
      range.endColumn - 1,
    ),
    color: range.style.color,
  }));
}

describe("imported VS Code highlight rules", () => {
  it("colours #PRIORITY where it appears in a note", () => {
    const found = highlight(["- ship the thing #PRIORITY"]);
    expect(found).toContainEqual({ text: "#PRIORITY", color: "#FF5555" });
  });

  it("dims the text after #DONE while keeping the tag green", () => {
    // The rule has two capture groups, and the second decoration must land
    // on the second group rather than on the whole match.
    const found = highlight(["#DONE wrote the migration"]);
    expect(found).toContainEqual({ text: "#DONE", color: "#50FA7B" });
    expect(found).toContainEqual({
      text: " wrote the migration",
      color: "rgba(255, 255, 255, 0.25)",
    });
  });

  it("colours #LATER", () => {
    const found = highlight(["#LATER revisit this"]);
    expect(found).toContainEqual({ text: "#LATER", color: "#fcb103" });
  });

  it("resolves a theme colour reference for @mentions", () => {
    const found = highlight(["@rachel to confirm"]);
    expect(found.map((entry) => entry.color)).toContain(
      "theme.textLink.activeForeground",
    );
  });

  it("highlights a TODO written as an HTML comment", () => {
    const found = highlight(["<!-- TODO: split this note -->"]);
    expect(found.length).toBeGreaterThan(0);
  });

  it("matches case-insensitively, as the VS Code default does", () => {
    expect(highlight(["#done lowercase"]).length).toBeGreaterThan(0);
  });

  it("honours filterFileRegex, so CHANGELOG.md is left alone", () => {
    const inNote = highlight(["<!-- TODO: x -->"], MARKDOWN);
    const inChangelog = highlight(["<!-- TODO: x -->"], {
      path: "CHANGELOG.md",
      languageId: "markdown",
    });
    expect(inNote.length).toBeGreaterThan(0);
    // The TODO and FIXME rules exclude it; the language-filtered rules do not
    // apply to a bare TODO, so nothing should survive.
    expect(inChangelog).toEqual([]);
  });

  it("honours filterLanguageRegex, so markdown-only rules skip other languages", () => {
    const found = highlight(["#PRIORITY"], {
      path: "script.ts",
      languageId: "typescript",
    });
    expect(found.map((entry) => entry.color)).not.toContain("#FF5555");
  });
});

describe("findHighlightRanges safety", () => {
  it("terminates on a pattern that can match the empty string", () => {
    // `(@(.*))` matches at a bare `@` with an empty tail; without the
    // lastIndex nudge this would never finish.
    const rules = compileHighlightRules(IMPORTED_VSCODE_SETTINGS, MARKDOWN);
    expect(() => findHighlightRanges(rules, ["@", "@@", "@ @ @"])).not.toThrow();
  });

  it("skips a line long enough to make the TODO pattern backtrack", () => {
    const rules = compileHighlightRules(IMPORTED_VSCODE_SETTINGS, MARKDOWN);
    const long = `<!-- TODO ${"a ".repeat(3000)}`;
    const started = Date.now();
    const found = findHighlightRanges(rules, [long]);
    expect(found).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("ignores a rule whose regex does not compile", () => {
    const rules = compileHighlightRules(
      { "highlight.regexes": { "(unclosed": { decorations: [{ color: "#fff" }] } } },
      MARKDOWN,
    );
    expect(rules).toEqual([]);
  });

  it("drops a rule whose file filter does not compile rather than widening it", () => {
    const rules = compileHighlightRules(
      {
        "highlight.regexes": {
          "(x)": {
            filterFileRegex: "(unclosed",
            decorations: [{ color: "#fff" }],
          },
        },
      },
      MARKDOWN,
    );
    expect(rules).toEqual([]);
  });

  it("applies a group-less pattern to the whole match", () => {
    const rules = compileHighlightRules(
      {
        "highlight.regexes": {
          "WIP": { regexFlags: "g", decorations: [{ color: "#abcdef" }] },
        },
      },
      MARKDOWN,
    );
    const found = findHighlightRanges(rules, ["a WIP b"]);
    expect(found).toEqual([
      {
        lineNumber: 1,
        startColumn: 3,
        endColumn: 6,
        style: { color: "#abcdef" },
      },
    ]);
  });
});
