import { describe, expect, it } from "vitest";
import {
  IMPORTED_VSCODE_SETTINGS,
  mergeSettings,
  parseJsonc,
  parseSettings,
} from "./vscode-settings.js";

describe("IMPORTED_VSCODE_SETTINGS", () => {
  it("carries every rule from the imported preferences", () => {
    const keys = Object.keys(IMPORTED_VSCODE_SETTINGS["highlight.regexes"] ?? {});
    expect(keys).toHaveLength(6);
  });

  it("keeps ordered TOC on", () => {
    expect(
      IMPORTED_VSCODE_SETTINGS["markdown.extension.toc.orderedList"],
    ).toBe(true);
  });

  it("validates against the schema it will be merged with", () => {
    expect(parseSettings(JSON.stringify(IMPORTED_VSCODE_SETTINGS))).not.toBeNull();
  });
});

describe("parseJsonc", () => {
  it("strips line comments, which a real settings.json has", () => {
    expect(parseJsonc('{"a": 1 // note\n}')).toEqual({ a: 1 });
  });

  it("strips block comments", () => {
    expect(parseJsonc('{/* hi */"a": 1}')).toEqual({ a: 1 });
  });

  it("allows a trailing comma", () => {
    expect(parseJsonc('{"a": 1,}')).toEqual({ a: 1 });
  });

  it("leaves a // inside a string alone", () => {
    expect(parseJsonc('{"url": "https://x.dev"}')).toEqual({
      url: "https://x.dev",
    });
  });

  it("returns null for malformed input instead of throwing", () => {
    expect(parseJsonc("{not json")).toBeNull();
  });
});

describe("parseSettings", () => {
  it("keeps unknown keys rather than rejecting the file", () => {
    const parsed = parseSettings('{"editor.fontSize": 15, "some.ext": true}');
    expect(parsed?.["editor.fontSize"]).toBe(15);
  });

  it("rejects a non-object", () => {
    expect(parseSettings("[1,2]")).toBeNull();
  });

  it("rejects a wrongly typed known key", () => {
    expect(parseSettings('{"markdown.extension.toc.orderedList": "yes"}')).toBeNull();
  });
});

describe("mergeSettings", () => {
  it("lets a later source win per key", () => {
    const merged = mergeSettings(
      { "editor.fontSize": 12 },
      { "editor.fontSize": 16 },
    );
    expect(merged["editor.fontSize"]).toBe(16);
  });

  it("replaces highlight.regexes wholesale rather than merging rules", () => {
    const merged = mergeSettings(IMPORTED_VSCODE_SETTINGS, {
      "highlight.regexes": { "(X)": { decorations: [{ color: "#fff" }] } },
    });
    expect(Object.keys(merged["highlight.regexes"] ?? {})).toEqual(["(X)"]);
  });

  it("keeps earlier keys an override does not mention", () => {
    const merged = mergeSettings(IMPORTED_VSCODE_SETTINGS, {
      "editor.fontSize": 15,
    });
    expect(merged["markdown.extension.toc.orderedList"]).toBe(true);
  });

  it("ignores a null source", () => {
    expect(mergeSettings(null, { "editor.fontSize": 11 })).toEqual({
      "editor.fontSize": 11,
    });
  });
});
