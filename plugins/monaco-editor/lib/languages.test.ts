import { describe, expect, it } from "vitest";
import { CLAIMED_EXTENSIONS, languageForPath } from "./languages.js";

describe("CLAIMED_EXTENSIONS", () => {
  it.each(["md", "markdown", "html", "htm"])(
    "leaves .%s files to bb's rendered preview",
    (extension) => {
      expect(CLAIMED_EXTENSIONS).not.toContain(extension);
    },
  );

  it("keeps code files available in the editor", () => {
    expect(CLAIMED_EXTENSIONS).toEqual(
      expect.arrayContaining(["mdx", "ts", "json", "txt", "vue", "svelte"]),
    );
  });

  it("still highlights Markdown opened from the file tree", () => {
    expect(languageForPath("docs/guide.md")).toBe("markdown");
    expect(languageForPath("README.markdown")).toBe("markdown");
  });
});
