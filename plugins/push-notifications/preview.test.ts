import { describe, expect, it } from "vitest";
import { markdownPreview } from "./preview.js";

describe("Markdown push previews", () => {
  it.each([
    [
      "**Ready** with _nested **emphasis**_ and ~~old text~~",
      "Ready with nested emphasis and old text",
    ],
    ["# Release ready\n\nDetails", "Release ready"],
    ["> **Needs attention**\n> Details", "Needs attention"],
    ["- First **item**\n- Second item", "First item"],
    ["1. First item\n2. Second item", "First item"],
    ["- [x] Tests pass\n- [ ] Ship", "☑ Tests pass"],
    ["- [ ] Approval needed", "☐ Approval needed"],
    ["See [the report](https://example.com/report)", "See the report"],
    [
      "See [the report][report]\n\n[report]: https://example.com/report",
      "See the report",
    ],
    ["![Build status](https://example.com/status.png)", "Build status"],
    ["```sh\necho '*literal*'\necho second\n```", "echo '*literal*'"],
    ["Run `echo '*literal*'` now", "Run echo '*literal*' now"],
    ["| Check | Result |\n| --- | --- |\n| Tests | Pass |", "Check · Result"],
    ["\\*literal\\* and snake_case", "*literal* and snake_case"],
    ["---\n\n**Ready**", "Ready"],
    ["\n\nPlain text\nMore details", "Plain text"],
    ["[report]: https://example.com/report", ""],
    ["---", ""],
    ["", ""],
  ])("converts %j to visible preview text", (input, expected) => {
    expect(markdownPreview(input)).toBe(expected);
  });
});
