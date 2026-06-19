import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { promptEditorExtensions } from "./prompt-editor-extensions";
import { findUltracodeRanges } from "./prompt-ultracode-highlight-extension";

const schema = getSchema(
  promptEditorExtensions({ richTextEditing: false, getPlaceholder: () => "" }),
);

function paragraphDoc(text: string): Node {
  return Node.fromJSON(schema, {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
}

function highlighted(text: string): string[] {
  const doc = paragraphDoc(text);
  return findUltracodeRanges(doc).map(({ from, to }) =>
    doc.textBetween(from, to),
  );
}

describe("findUltracodeRanges", () => {
  it("highlights a standalone keyword regardless of case", () => {
    expect(highlighted("run this ultracode now")).toEqual(["ultracode"]);
    expect(highlighted("UltraCode please")).toEqual(["UltraCode"]);
  });

  it("highlights every occurrence in the prompt", () => {
    expect(highlighted("ultracode and ultracode again")).toEqual([
      "ultracode",
      "ultracode",
    ]);
  });

  it("returns positions that resolve back to the matched word", () => {
    const doc = paragraphDoc("go ultracode go");
    const ranges = findUltracodeRanges(doc);
    expect(ranges).toHaveLength(1);
    // Paragraph opens at pos 0, so its text starts at 1: "go " is 3 chars.
    expect(doc.textBetween(ranges[0].from, ranges[0].to)).toBe("ultracode");
  });

  it("ignores substrings so only the whole keyword lights up", () => {
    expect(highlighted("ultracodes myultracode supercode")).toEqual([]);
  });

  it("returns nothing when the keyword is absent", () => {
    expect(highlighted("just a normal prompt")).toEqual([]);
  });
});
