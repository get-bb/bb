import type { Paragraph, Root } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import { describe, expect, it } from "vitest";
import type { PromptTextMention } from "@bb/domain";
import { buildTableModel, splitParagraphSegments } from "./blocks";
import { MARKDOWN_DIRECTIVE_LIMIT } from "./directives";
import type { BbDirectiveNode } from "./mdast-nodes";
import {
  clearParseMarkdownCache,
  parseMarkdown,
  parseMarkdownUncached,
  splitMarkdownFrontmatter,
  type ParseMarkdownOptions,
} from "./parse";
import { substitutePromptMentions } from "./prompt-mentions";

const RAW_ID = "thr_abcdefghjk";
const OTHER_RAW_ID = "thr_23456789ab";

const ALL_OFF: ParseMarkdownOptions = {
  preserveSoftBreaks: false,
  threadMentions: false,
  promptMentions: false,
  directives: false,
};

function firstParagraph(tree: Root): Paragraph {
  const node = tree.children[0];
  if (node?.type !== "paragraph") {
    throw new Error(`expected paragraph, got ${node?.type ?? "nothing"}`);
  }
  return node;
}

function inlineTypes(tree: Root): string[] {
  return firstParagraph(tree).children.map((child) => child.type);
}

describe("parseMarkdown", () => {
  it("parses GFM (tables, strikethrough, task lists) and math blocks", () => {
    const tree = parseMarkdownUncached(
      [
        "| a | b |",
        "| --- | ---: |",
        "| 1 | 2 |",
        "",
        "~~gone~~",
        "",
        "- [x] done",
        "- [ ] todo",
        "",
        "$$",
        "E = mc^2",
        "$$",
        "",
        "costs $5 to $10",
      ].join("\n"),
    );
    const types = tree.children.map((node) => node.type);
    expect(types).toEqual(["table", "paragraph", "list", "math", "paragraph"]);
    const table = tree.children[0];
    if (table?.type !== "table") throw new Error("no table");
    expect(buildTableModel(table)).toMatchObject({
      align: [null, "right"],
      columnCount: 2,
    });
    const list = tree.children[2];
    if (list?.type !== "list") throw new Error("no list");
    expect(list.children.map((item) => item.checked)).toEqual([true, false]);
    // Single-dollar math is off: "$5 to $10" stays prose.
    const last = tree.children[4];
    if (last?.type !== "paragraph") throw new Error("no paragraph");
    expect(last.children.map((child) => child.type)).toEqual(["text"]);
  });

  it("keeps single newlines as soft text unless preserveSoftBreaks is on", () => {
    const content = "line one\nline two";
    expect(inlineTypes(parseMarkdownUncached(content, ALL_OFF))).toEqual([
      "text",
    ]);
    expect(
      inlineTypes(
        parseMarkdownUncached(content, {
          ...ALL_OFF,
          preserveSoftBreaks: true,
        }),
      ),
    ).toEqual(["text", "break", "text"]);
  });

  it("memoizes by content and options", () => {
    clearParseMarkdownCache();
    const a = parseMarkdown("# hi", ALL_OFF);
    const b = parseMarkdown("# hi", ALL_OFF);
    const c = parseMarkdown("# hi", { ...ALL_OFF, preserveSoftBreaks: true });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(parseMarkdown("# other", ALL_OFF)).not.toBe(a);
  });

  it("leaves directive syntax literal when directives are off", () => {
    const tree = parseMarkdownUncached('::task{id="1"}\n\nat 13:30', ALL_OFF);
    expect(tree.children.map((node) => node.type)).toEqual([
      "paragraph",
      "paragraph",
    ]);
    expect(mdastToString(tree.children[0])).toBe('::task{id="1"}');
  });
});

describe("splitMarkdownFrontmatter", () => {
  it("splits a leading YAML block and leaves other documents alone", () => {
    expect(splitMarkdownFrontmatter("---\ntitle: x\n---\n# Body")).toEqual({
      frontmatter: "title: x",
      body: "# Body",
    });
    expect(splitMarkdownFrontmatter("# Body\n---\nnot frontmatter")).toEqual({
      frontmatter: null,
      body: "# Body\n---\nnot frontmatter",
    });
  });
});

describe("thread mentions", () => {
  const options: ParseMarkdownOptions = { ...ALL_OFF, threadMentions: true };

  it("rewrites @thread tokens and raw ids in prose into mention nodes", () => {
    const tree = parseMarkdownUncached(
      `see @thread:abc123 and ${RAW_ID}, then ${OTHER_RAW_ID}.`,
      options,
    );
    const children = firstParagraph(tree).children;
    expect(children.map((child) => child.type)).toEqual([
      "text",
      "bbThreadMention",
      "text",
      "bbThreadMention",
      "text",
      "bbThreadMention",
      "text",
    ]);
    expect(children[1]).toMatchObject({
      threadId: "abc123",
      rawThreadId: false,
      inlineCode: false,
    });
    expect(children[3]).toMatchObject({ threadId: RAW_ID, rawThreadId: true });
    expect(children[6]).toMatchObject({ type: "text", value: "." });
  });

  it("turns an inline-code span that is exactly a raw id into a pill, keeps mixed code literal", () => {
    const tree = parseMarkdownUncached(
      `run \`${RAW_ID}\` but not \`${RAW_ID}/x\` or \`prefix${RAW_ID}\``,
      options,
    );
    const children = firstParagraph(tree).children;
    expect(children.map((child) => child.type)).toEqual([
      "text",
      "bbThreadMention",
      "text",
      "inlineCode",
      "text",
      "inlineCode",
    ]);
    expect(children[1]).toMatchObject({
      threadId: RAW_ID,
      rawThreadId: true,
      inlineCode: true,
    });
  });

  it("does not touch ids inside paths, words, authored links, or fenced code", () => {
    const tree = parseMarkdownUncached(
      [
        `/tmp/${RAW_ID} and x${RAW_ID} and [${RAW_ID}](https://example.com)`,
        "",
        "```",
        RAW_ID,
        "```",
      ].join("\n"),
      options,
    );
    const paragraph = firstParagraph(tree);
    expect(
      paragraph.children.some((child) => child.type === "bbThreadMention"),
    ).toBe(false);
    expect(tree.children[1]?.type).toBe("code");
  });

  it("rejoins @thread:<id> when remark-directive split it into a text directive", () => {
    const tree = parseMarkdownUncached("ping @thread:abc123 now", {
      ...options,
      directives: true,
    });
    const children = firstParagraph(tree).children;
    expect(children.map((child) => child.type)).toEqual([
      "text",
      "bbThreadMention",
      "text",
    ]);
    expect(children[0]).toMatchObject({ value: "ping " });
    expect(children[1]).toMatchObject({ threadId: "abc123" });
  });
});

describe("prompt mentions", () => {
  const options: ParseMarkdownOptions = { ...ALL_OFF, promptMentions: true };
  const text = "Look at @src/app.ts and @thread:t1 then /deploy";
  const mentions: PromptTextMention[] = [
    {
      start: 8,
      end: 19,
      resource: {
        kind: "path",
        source: "workspace",
        entryKind: "file",
        path: "src/app.ts",
        label: "app.ts",
      },
    },
    {
      start: 24,
      end: 34,
      resource: { kind: "thread", threadId: "t1", label: "Thread one" },
    },
    {
      start: 40,
      end: 47,
      resource: {
        kind: "command",
        trigger: "/",
        name: "deploy",
        source: "command",
        origin: "project",
        label: "deploy",
        argumentHint: null,
      },
    },
    // Out of range: dropped.
    {
      start: 100,
      end: 104,
      resource: { kind: "thread", threadId: "zzz", label: "nope" },
    },
  ];

  it("substitutes spans with sentinels and renders them back as indexed nodes", () => {
    const substitution = substitutePromptMentions(text, mentions);
    expect(
      substitution.mentions.map((mention) => mention.serializedText),
    ).toEqual(["@src/app.ts", "@thread:t1", "/deploy"]);
    const tree = parseMarkdownUncached(substitution.content, options);
    const children = firstParagraph(tree).children;
    expect(children.map((child) => child.type)).toEqual([
      "text",
      "bbPromptMention",
      "text",
      "bbPromptMention",
      "text",
      "bbPromptMention",
    ]);
    expect(children[1]).toMatchObject({ index: 0 });
    expect(children[3]).toMatchObject({ index: 1 });
    expect(children[5]).toMatchObject({ index: 2 });
    expect(children[4]).toMatchObject({ value: " then " });
  });

  it("drops overlapping mentions so every sentinel maps to one entry", () => {
    const overlapping: PromptTextMention[] = [
      mentions[0]!,
      { ...mentions[0]!, start: 10, end: 15 },
    ];
    const substitution = substitutePromptMentions(text, overlapping);
    expect(substitution.mentions).toHaveLength(1);
  });

  it("survives markdown syntax around the sentinel (emphasis, list, code span stays literal)", () => {
    const body = "- **bold @thread:t1** item";
    const substitution = substitutePromptMentions(body, [
      {
        start: 9,
        end: 19,
        resource: { kind: "thread", threadId: "t1", label: "T" },
      },
    ]);
    const tree = parseMarkdownUncached(substitution.content, options);
    const list = tree.children[0];
    if (list?.type !== "list") throw new Error("no list");
    const paragraph = list.children[0]?.children[0];
    if (paragraph?.type !== "paragraph") throw new Error("no paragraph");
    const strong = paragraph.children[0];
    if (strong?.type !== "strong") throw new Error("no strong");
    expect(strong.children.map((child) => child.type)).toEqual([
      "text",
      "bbPromptMention",
    ]);
  });
});

describe("directives", () => {
  const options: ParseMarkdownOptions = { ...ALL_OFF, directives: true };

  it("surfaces leaf and container directives with attributes and source", () => {
    const content = [
      "Before",
      "",
      '::task{key="ABC-12" title="Do it"}',
      "",
      ":::workflow-preview{id=w1}",
      "Inner **text**",
      ":::",
    ].join("\n");
    const tree = parseMarkdownUncached(content, options);
    expect(tree.children.map((node) => node.type)).toEqual([
      "paragraph",
      "bbDirective",
      "bbDirective",
    ]);
    const leaf = tree.children[1] as BbDirectiveNode;
    expect(leaf).toMatchObject({
      kind: "leaf",
      name: "task",
      attributes: { key: "ABC-12", title: "Do it" },
      source: '::task{key="ABC-12" title="Do it"}',
      children: [],
    });
    const container = tree.children[2] as BbDirectiveNode;
    expect(container).toMatchObject({
      kind: "container",
      name: "workflow-preview",
      attributes: { id: "w1" },
    });
    expect(container.source.startsWith(":::workflow-preview")).toBe(true);
    expect(container.children.map((child) => child.type)).toEqual([
      "paragraph",
    ]);
  });

  it("rewrites incidental text directives back to literal prose", () => {
    const tree = parseMarkdownUncached(
      "meet at 13:30, key:value, smile :D and :name[x]{a=1}",
      options,
    );
    const children = firstParagraph(tree).children;
    expect(children.map((child) => child.type)).toEqual(["text"]);
    expect(mdastToString(tree)).toBe(
      "meet at 13:30, key:value, smile :D and :name[x]{a=1}",
    );
  });

  it("keeps directives beyond the limit as literal paragraphs", () => {
    const content = Array.from(
      { length: MARKDOWN_DIRECTIVE_LIMIT + 2 },
      (_, index) => `::d${index}`,
    ).join("\n\n");
    const tree = parseMarkdownUncached(content, options);
    const kinds = tree.children.map((node) => node.type);
    expect(kinds.filter((kind) => kind === "bbDirective")).toHaveLength(
      MARKDOWN_DIRECTIVE_LIMIT,
    );
    expect(kinds.slice(-2)).toEqual(["paragraph", "paragraph"]);
    expect(mdastToString(tree.children[tree.children.length - 1])).toBe(
      `::d${MARKDOWN_DIRECTIVE_LIMIT + 1}`,
    );
  });
});

describe("splitParagraphSegments", () => {
  it("lifts images out of inline runs and drops whitespace-only runs", () => {
    const tree = parseMarkdownUncached(
      "![a](http://x/a.png) ![b](http://x/b.png)\n\nsee ![c](http://x/c.png) here",
    );
    const first = firstParagraph(tree);
    expect(
      splitParagraphSegments(first).map((segment) => segment.kind),
    ).toEqual(["image", "image"]);
    const second = tree.children[1];
    if (second?.type !== "paragraph") throw new Error("no paragraph");
    expect(
      splitParagraphSegments(second).map((segment) => segment.kind),
    ).toEqual(["inline", "image", "inline"]);
  });
});

describe("buildTableModel", () => {
  it("pads short rows and defaults alignment to null", () => {
    const tree = parseMarkdownUncached(
      [
        "| h1 | h2 | h3 |",
        "| :-- | :-: | --- |",
        "| a |",
        "| b | c | d |",
      ].join("\n"),
    );
    const table = tree.children[0];
    if (table?.type !== "table") throw new Error("no table");
    const model = buildTableModel(table);
    expect(model.align).toEqual(["left", "center", null]);
    expect(model.columnCount).toBe(3);
    expect(model.rows.map((row) => row.length)).toEqual([3, 3]);
    expect(mdastToString(model.rows[0]![2]!)).toBe("");
  });
});
