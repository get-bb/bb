import { describe, expect, it } from "vitest";
import { parseSkillMetadata, skillFrontmatterBlock } from "../src/metadata.js";

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
const body = `\n# Title\n\n${"Body text.\n".repeat(500)}---\nname: body-name\n---\n`;

const cases: Record<string, string> = {
  plain: `---\nname: review\ndescription: Review diffs\n---${body}`,
  crlf: `---\r\nname: review\r\ndescription: Review diffs\r\n---\r\n${body}`,
  bom: `${BYTE_ORDER_MARK}---\nname: review\ndescription: Review diffs\n---${body}`,
  language: `---yaml\nname: review\ndescription: Review diffs\n---${body}`,
  emptyBlock: `---\n---${body}`,
  longerClosingRule: `---\nname: review\ndescription: Review diffs\n-----${body}`,
  multilineDescription: `---\nname: review\ndescription: |\n  Line one\n  Line two\n---${body}`,
  unterminated: `---\nname: review\ndescription: Review diffs\n`,
  leadingWhitespace: `\n\n  ---\nname: review\ndescription: Review diffs\n---${body}`,
  leadingWhitespaceUnterminated: `\n\n\n\n\n---\nname: review\n`,
  noOpeningDelimiter: `# Review\n${body}`,
  noDelimiterAnywhere: "name: review\ndescription: Review diffs\n",
  quadrupleOpening: `----\nname: review\n---${body}`,
  invalidYaml: `---\nname: [unclosed\n---${body}`,
  openingOnly: "---",
  empty: "",
};

describe("skillFrontmatterBlock", () => {
  it.each(Object.entries(cases))(
    "parses %s exactly like the whole file",
    (_name, content) => {
      const block = skillFrontmatterBlock(content);
      expect(content.startsWith(block)).toBe(true);
      expect(parseSkillMetadata(block)).toEqual(parseSkillMetadata(content));
    },
  );

  it("drops the body after the closing delimiter", () => {
    expect(skillFrontmatterBlock(cases.plain!)).toBe(
      "---\nname: review\ndescription: Review diffs\n---",
    );
  });
});
