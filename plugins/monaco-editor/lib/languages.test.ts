import { describe, expect, it } from "vitest";
import { CLAIMED_EXTENSIONS, languageForPath } from "./languages.js";

describe("CLAIMED_EXTENSIONS", () => {
  it("leaves Markdown files to bb's rendered preview", () => {
    expect(CLAIMED_EXTENSIONS).not.toContain("md");
    expect(CLAIMED_EXTENSIONS).not.toContain("markdown");
    expect(CLAIMED_EXTENSIONS).toEqual(
      expect.arrayContaining(["mdx", "ts", "json", "txt"]),
    );
  });

  it("still highlights Markdown opened from the file tree", () => {
    expect(languageForPath("docs/guide.md")).toBe("markdown");
    expect(languageForPath("README.markdown")).toBe("markdown");
  });
});
