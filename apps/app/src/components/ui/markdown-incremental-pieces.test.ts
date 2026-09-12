import {
  Fragment,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import type { Root } from "mdast";
import rehypeKatex from "rehype-katex";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { describe, expect, it } from "vitest";
import { FIXTURE_NAMES, getFixture } from "bb-plugin-bench-stream-provider/fixtures";
import {
  repairStreamingMarkdownTail,
  splitStreamingMarkdown,
} from "@/components/thread/timeline/streaming-markdown-split";
import {
  createMarkdownPieceCache,
  findMarkdownPieceCandidates,
  resolveMarkdownPieces,
  type MarkdownPieceCache,
  type MarkdownPieceRenderConfig,
} from "./markdown-incremental-pieces";
import { normalizeMathFences } from "./markdown-math-fences";
import {
  buildMessageDirectiveRegistry,
  MESSAGE_DIRECTIVE_MOUNT_LIMIT,
  remarkMessageDirectives,
  type MountedMessageDirective,
} from "./markdown-message-directives";
import { remarkThreadMentions } from "./markdown-thread-mentions";

const MARKDOWN_FIXTURES = FIXTURE_NAMES.map((name) => ({
  name,
  text: getFixture(name),
}));

interface RenderedMarkdownDocument {
  html: string;
  keys: readonly string[];
  mounts: readonly string[];
}

const registry = buildMessageDirectiveRegistry([
  { id: "inline-vis", pluginId: "demo", generation: 1, component: () => null },
]);

const config: MarkdownPieceRenderConfig = {
  components: {},
  messageDirectiveRegistry: registry,
  rehypePlugins: [rehypeKatex],
  remarkPlugins: [
    remarkGfm,
    [remarkMath, { singleDollarTextMath: false }],
    remarkThreadMentions,
    remarkDirective,
  ],
  urlTransform: undefined,
};

function describeMarkdownChildren(
  children: readonly ReactNode[],
  mounts: readonly MountedMessageDirective[],
): RenderedMarkdownDocument {
  return {
    html: renderToStaticMarkup(createElement(Fragment, null, ...children)),
    keys: children.map((child) =>
      isValidElement(child) ? `key:${String(child.key)}` : "text",
    ),
    mounts: mounts.map(
      (mount) => `${mount.index}:${mount.slot.id}:${mount.source}`,
    ),
  };
}

function renderWholeDocument(
  body: string,
  renderConfig: MarkdownPieceRenderConfig = config,
): RenderedMarkdownDocument {
  const mounts: MountedMessageDirective[] = [];
  const element = ReactMarkdown({
    children: body,
    components: renderConfig.components,
    rehypePlugins: renderConfig.rehypePlugins,
    remarkPlugins: [
      ...renderConfig.remarkPlugins,
      [
        remarkMessageDirectives,
        {
          indexBase: 0,
          limit: MESSAGE_DIRECTIVE_MOUNT_LIMIT,
          mounts,
          registry,
        },
      ],
    ],
    urlTransform: renderConfig.urlTransform,
  });
  const children = (element.props as { children?: ReactNode }).children;
  return describeMarkdownChildren(
    children === undefined
      ? []
      : Array.isArray(children)
        ? children
        : [children],
    mounts,
  );
}

function renderPieces(
  cache: MarkdownPieceCache,
  body: string,
  renderConfig: MarkdownPieceRenderConfig = config,
): RenderedMarkdownDocument {
  const result = resolveMarkdownPieces(cache, renderConfig, body);
  return describeMarkdownChildren(result.children, result.mounts);
}

function remarkRecordParsedSource(recorded: string[]) {
  return (_tree: Root, file: { value: unknown }): void => {
    recorded.push(String(file.value));
  };
}

function createRecordingConfig(recorded: string[]): MarkdownPieceRenderConfig {
  return {
    ...config,
    remarkPlugins: [
      ...config.remarkPlugins,
      [remarkRecordParsedSource, recorded],
    ],
  };
}

function parsedLength(recorded: readonly string[]): number {
  return recorded.reduce((total, source) => total + source.length, 0);
}

function findMarkdownElement(
  node: ReactNode,
  type: unknown,
): ReactElement<{ children?: ReactNode; node?: object }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findMarkdownElement(child, type);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode; node?: object }>(node)) {
    return null;
  }
  return node.type === type
    ? node
    : findMarkdownElement(node.props.children, type);
}

function MarkdownLinkComponent({ children }: { children?: ReactNode }) {
  return createElement("a", { "data-link": "" }, children);
}

function ConfiguredParagraph({ children }: { children?: ReactNode }) {
  return createElement("p", { "data-configured": "" }, children);
}

const OPEN_CONSTRUCT_PARAGRAPHS = Array.from(
  { length: 40 },
  (_, index) => `Paragraph ${index} ${"lorem ipsum dolor sit amet ".repeat(4)}`,
).join("\n\n");

function expectPiecesMatchWholeDocument(
  cache: MarkdownPieceCache,
  content: string,
  label: string,
): void {
  const body = normalizeMathFences(content);
  expect(
    renderPieces(cache, body),
    `${label}: ${JSON.stringify(body)}`,
  ).toEqual(renderWholeDocument(body));
}

function streamEveryCharacter(document: string, label: string): void {
  const cache = createMarkdownPieceCache();
  for (let end = 1; end <= document.length; end += 1) {
    expectPiecesMatchWholeDocument(cache, document.slice(0, end), label);
  }
}

function chunkEnds(text: string, seed: number): number[] {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const ends: number[] = [];
  let end = 0;
  while (end < text.length) {
    end = Math.min(text.length, end + 1 + Math.floor(next() * 96));
    ends.push(end);
  }
  return ends;
}

const CURATED_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ["lazy list continuation", "- a\nlazy\n\n- b\n\nAfter the list."],
  ["double blank inside a list", "- a\n\n\n- b\n\n  continued\n\nAfter."],
  [
    "fence inside a list item",
    "1. Step one\n\n   ```bash\n   run\n\n   more\n   ```\n\n2. Step two\n\nDone.",
  ],
  [
    "unclosed fence",
    "Intro.\n\n```ts\nconst a = 1;\n\n    ```\n\nconst b = 2;\n\nstill code",
  ],
  ["pre html flow", "Before.\n\n<pre>\nline\n\nmore\n</pre>\n\nAfter."],
  ["comment html flow", "Before.\n\n<!-- note\n\nstill note -->\n\nAfter."],
  [
    "container directive",
    ':::note\nhello **world**\n\n::inline-vis{file="demo.html"}\n:::\n\nAfter.',
  ],
  [
    "glued math closer (#1778)",
    "Before the formula.\n\n$$T_{a}\n\\approx73$$\n\n## After\n\n- item\n- [link](https://example.com)",
  ],
  [
    "indented code continuation",
    "Para.\n\n    code one\n\n    code two\n\n> - quoted item\n\n2. ordered\n\n-\n\nAfter.",
  ],
  [
    "reference definition after use",
    "Use [the docs] here.\n\nMore text.\n\n[the docs]: https://example.com\n\nTail.",
  ],
  ["footnotes", "A claim[^1].\n\nMore.\n\n[^1]: The note.\n\nAfter."],
  ["frontmatter-like rules", "---\ntitle: x\n---\n\nBody.\n\n---\n\nMore."],
  [
    "directives",
    'Intro.\n\n::inline-vis{file="a.html"}\n\nMiddle :inline-vis[text] and 12:30.\n\n::inline-vis{file="b.html"}\n\n::unknown{x=1}',
  ],
  [
    "math",
    "Inline $$x^2$$ math.\n\n$$\n\\frac{1}{2}\n$$\n\n$$\nx\n\ny\n$$\n\n$$$\nlong\n\nfence\n$$$\n\nAfter.",
  ],
  ["mermaid", "```mermaid\ngraph TD\nA-->B\n```\n\nAfter the diagram."],
  [
    "tables",
    "| a | b |\n| - | - |\n| 1 | 2 |\n\n| c |\n| :-: |\n| 3 |\n\nAfter.",
  ],
  ["loose list", "- one\n\n- two\n\n- three\n\nAfter the list."],
  [
    "stray math delimiter",
    "Run `echo $$` to print the PID.\n\nNext paragraph.\n\n$$\n\nText after the stray line.\n\nMore.",
  ],
  [
    "blockquotes and thread ids",
    "> quoted\n> more\n\nSee thr_abcdefghij and @thread:thr_mentioned.\n\n> - item\n\nDone.",
  ],
  [
    "crlf and whitespace lines",
    "One.\r\n\r\nTwo.\n \nThree.\n\t\nFour\n\u00a0\nFive.",
  ],
];

const PAIR_FIRST_BLOCKS: readonly string[] = [
  "para",
  "Setext\n===",
  "```\nc\n```",
  "    indented",
  "\tindented tab",
  "- a",
  "- a\n\n  b",
  "1. a",
  "> q",
  "| a |\n| - |\n| b |",
  "$$\nx\n$$",
  "<div>\nx",
  "<!-- c -->",
  ":::n\nx\n:::",
  '::inline-vis{file="a"}',
  "text\n    lazy indented",
];

const PAIR_SEPARATORS: readonly string[] = [
  "\n\n",
  "\n\n\n",
  "\n \n",
  "\r\n\r\n",
];

const PAIR_SECOND_BLOCKS: readonly string[] = [
  "-",
  "1.",
  "2. foo",
  "- foo",
  "> -",
  "> 2. foo",
  "> > 2. x",
  "* * *",
  '<a href="x">',
  "===",
  "| a |\n| - |",
  ":::x\ny\n:::",
  "```\ny",
  "foo",
  "3)",
];

const FUZZ_BLOCKS: readonly string[] = [
  "Plain paragraph text.",
  "# Heading",
  "```ts\nconst a = 1;\n\nconst b = 2;\n```",
  "```\nunclosed fence\n\nstill code",
  "    indented code\n\n    more indented",
  "- a\n\n- b",
  "- item\nlazy continuation",
  "1. step\n\n   ```bash\n   run\n   ```",
  "> ```\n> code",
  "> 2. quoted ordered",
  "| a | b |\n| - | - |\n| 1 | 2 |",
  "$$\nx = 1\n\ny = 2\n$$",
  "$$ glued\nx\ny $$",
  "Run `echo $$` now.",
  "<pre>\npre\n\nblock</pre>",
  "<!-- comment\n\nstill comment -->",
  ":::note\nunclosed container",
  '::inline-vis{file="a.html"}',
  "[ref]: https://example.com",
  "Use [ref] here.",
  "[^1]: The note.",
  "-",
  "crlf line\r\nnext line",
];

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("findMarkdownPieceCandidates", () => {
  it("starts pieces at unindented lines that follow a blank line", () => {
    expect(findMarkdownPieceCandidates("A.\n\nB.\n\n\nC\n  D\n\n E")).toEqual([
      4, 9,
    ]);
  });

  it("does not start pieces inside fences or math blocks", () => {
    expect(
      findMarkdownPieceCandidates("```\na\n\nb\n```\n\nc\n\n~~~\nd\n\ne"),
    ).toEqual([14, 17]);
    expect(findMarkdownPieceCandidates("$$\nx\n\ny\n$$\n\nz")).toEqual([12]);
  });

  it("keeps loose list items together and treats only spaces and tabs as blank", () => {
    expect(findMarkdownPieceCandidates("- a\n\n- b\n\nc")).toEqual([10]);
    expect(findMarkdownPieceCandidates("a\n\u00a0\nb\r\n\r\nc")).toEqual([9]);
  });
});

describe("resolveMarkdownPieces", () => {
  it("keeps react-markdown's default export hook-free", () => {
    const element = ReactMarkdown({ children: "# Title\n\nBody" });
    expect(element.type).toBe(Fragment);
    expect(renderToStaticMarkup(element)).toBe("<h1>Title</h1>\n<p>Body</p>");
  });

  it.each(CURATED_DOCUMENTS)(
    "matches a single document at every character prefix: %s",
    (label, document) => {
      streamEveryCharacter(document, label);
    },
  );

  it("mounts the first 32 of 34 directives in document order", () => {
    const document = Array.from(
      { length: MESSAGE_DIRECTIVE_MOUNT_LIMIT + 2 },
      (_, index) =>
        `Paragraph ${index}.\n\n::inline-vis{file="f${index}.html"}`,
    ).join("\n\n");
    const cache = createMarkdownPieceCache();
    const rendered = renderPieces(cache, document);
    expect(rendered).toEqual(renderWholeDocument(document));
    expect(rendered.mounts).toHaveLength(MESSAGE_DIRECTIVE_MOUNT_LIMIT);
    expect(rendered.mounts[31]).toBe(
      '31:inline-vis:::inline-vis{file="f31.html"}',
    );
    expect(rendered.html).toContain(
      "<p>::inline-vis{file=&quot;f33.html&quot;}</p>",
    );
  });

  it("parses each settled code, table, list, and math piece once while a prefix grows", () => {
    const blocks = [
      "Intro paragraph.\n\n",
      "```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n",
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n",
      "- one\n- two\n\n",
      "After the list.\n\n",
      "$$\n\\frac{1}{2}\n$$\n\n",
      "~~~\ntilde fence\n~~~\n\n",
      "Closing paragraph.\n\n",
    ];
    const recorded: string[] = [];
    const recordingConfig = createRecordingConfig(recorded);
    const cache = createMarkdownPieceCache();
    let body = "";
    for (const block of blocks) {
      body += block;
      expect(renderPieces(cache, body, recordingConfig)).toEqual(
        renderWholeDocument(body),
      );
    }
    expect(recorded).toEqual(blocks);
  });

  it("parses a completed document once on a cold cache", () => {
    const documents = [
      ...MARKDOWN_FIXTURES.map(({ text }) => text),
      `${MARKDOWN_FIXTURES[0]?.text ?? ""}\n\nSee [the docs] and a note[^1].\n\n[the docs]: https://example.com\n\n[^1]: The note.`,
      `Intro.\n\n:::note\n${OPEN_CONSTRUCT_PARAGRAPHS}\n:::\n\nAfter.`,
      `Intro.\n\n<!--\n${OPEN_CONSTRUCT_PARAGRAPHS}\n-->\n\nAfter.`,
    ];
    for (const document of documents) {
      const body = normalizeMathFences(document);
      const recorded: string[] = [];
      resolveMarkdownPieces(
        createMarkdownPieceCache(),
        createRecordingConfig(recorded),
        body,
      );
      expect(recorded).toHaveLength(1);
      expect(parsedLength(recorded)).toBe(body.length);
    }
  });

  it("merges an unclosed construct through the end of the body in linear volume", () => {
    for (const opener of [":::note\n", "<!--\n", "$$$\n"]) {
      const recorded: string[] = [];
      const recordingConfig = createRecordingConfig(recorded);
      const cache = createMarkdownPieceCache();
      resolveMarkdownPieces(cache, recordingConfig, "Intro.\n\n");
      recorded.length = 0;
      const body = `Intro.\n\n${opener}${OPEN_CONSTRUCT_PARAGRAPHS}\n\nAfter.`;
      expect(renderPieces(cache, body, recordingConfig)).toEqual(
        renderWholeDocument(body),
      );
      expect(parsedLength(recorded)).toBeLessThanOrEqual(
        (body.length - "Intro.\n\n".length) * 2,
      );
    }
  });

  it("re-parses a growing unclosed construct from its start once per update", () => {
    const recorded: string[] = [];
    const recordingConfig = createRecordingConfig(recorded);
    const cache = createMarkdownPieceCache();
    resolveMarkdownPieces(cache, recordingConfig, "Intro.\n\n");
    resolveMarkdownPieces(cache, recordingConfig, "Intro.\n\n:::note\nA\n\nB");
    recorded.length = 0;
    const grown = "Intro.\n\n:::note\nA\n\nB\n\nC";
    expect(renderPieces(cache, grown, recordingConfig)).toEqual(
      renderWholeDocument(grown),
    );
    expect(recorded).toEqual([":::note\nA\n\nB\n\nC"]);
  });

  it("splits a previous piece that ended mid-block at its internal boundaries", () => {
    const recorded: string[] = [];
    const recordingConfig = createRecordingConfig(recorded);
    const cache = createMarkdownPieceCache();
    resolveMarkdownPieces(cache, recordingConfig, "Intro.\n\nPara th");
    resolveMarkdownPieces(cache, recordingConfig, "Intro.\n\nPara three.");
    recorded.length = 0;
    const grown = "Intro.\n\nPara three. More";
    expect(renderPieces(cache, grown, recordingConfig)).toEqual(
      renderWholeDocument(grown),
    );
    expect(recorded).toEqual(["Para three. More"]);
  });

  it("keeps the settled parse volume near the message length while fixtures stream in chunks", () => {
    for (const { name, text } of MARKDOWN_FIXTURES) {
      const recorded: string[] = [];
      const recordingConfig = createRecordingConfig(recorded);
      const cache = createMarkdownPieceCache();
      for (let end = 7; end < text.length; end += 7) {
        const streamed = text.slice(0, end);
        const split = splitStreamingMarkdown(streamed);
        resolveMarkdownPieces(
          cache,
          recordingConfig,
          normalizeMathFences(
            split?.settled ?? repairStreamingMarkdownTail(streamed),
          ),
        );
      }
      resolveMarkdownPieces(cache, recordingConfig, normalizeMathFences(text));
      expect(parsedLength(recorded), name).toBeLessThanOrEqual(text.length * 3);
    }
  }, 60_000);

  it("returns fresh elements, hast node props, and directive attributes for reused pieces on every new body", () => {
    const linkConfig: MarkdownPieceRenderConfig = {
      ...config,
      components: { a: MarkdownLinkComponent },
    };
    const settled =
      'Use [docs](https://example.com).\n\n::inline-vis{file="a.html"}\n\n';
    const cache = createMarkdownPieceCache();
    const first = resolveMarkdownPieces(cache, linkConfig, settled);
    expect(resolveMarkdownPieces(cache, linkConfig, settled)).toBe(first);

    const second = resolveMarkdownPieces(cache, linkConfig, `${settled}More.`);
    const firstLink = findMarkdownElement(
      first.children,
      MarkdownLinkComponent,
    );
    const secondLink = findMarkdownElement(
      second.children,
      MarkdownLinkComponent,
    );
    if (firstLink === null || secondLink === null) {
      throw new Error("Expected a rendered link component");
    }
    expect(second.children[0]).not.toBe(first.children[0]);
    expect(secondLink).not.toBe(firstLink);
    expect(secondLink.props.node).not.toBe(firstLink.props.node);
    expect(secondLink.props.node).toEqual(firstLink.props.node);
    expect(second.mounts[0]).not.toBe(first.mounts[0]);
    expect(second.mounts[0]?.attributes).not.toBe(first.mounts[0]?.attributes);
    expect(second.mounts[0]).toEqual(first.mounts[0]);
    expect(describeMarkdownChildren(second.children, second.mounts)).toEqual(
      renderWholeDocument(`${settled}More.`, linkConfig),
    );
  });

  it("re-renders every piece when the render configuration changes", () => {
    const body = "Intro.\n\nMiddle paragraph.\n\n";
    const configured: MarkdownPieceRenderConfig = {
      ...config,
      components: { p: ConfiguredParagraph },
    };
    const cache = createMarkdownPieceCache();
    resolveMarkdownPieces(cache, config, "Intro.\n\n");
    resolveMarkdownPieces(cache, config, body);

    expect(renderPieces(cache, body, configured)).toEqual(
      renderWholeDocument(body, configured),
    );
    expect(renderPieces(cache, `${body}Tail.`, configured)).toEqual(
      renderWholeDocument(`${body}Tail.`, configured),
    );
    expect(renderPieces(cache, `${body}Tail.`, config)).toEqual(
      renderWholeDocument(`${body}Tail.`),
    );
  });

  it("falls back to one document for late definitions and leaves the mode when the prefix changes", () => {
    const cache = createMarkdownPieceCache();
    const settled = "Use [docs].\n\nMore.\n\n";
    const before = resolveMarkdownPieces(cache, config, settled);
    const withDefinition = `${settled}[docs]: https://example.com\n\n`;
    expect(renderPieces(cache, withDefinition)).toEqual(
      renderWholeDocument(withDefinition),
    );
    expect(renderPieces(cache, `${withDefinition}Tail.`).html).toContain(
      '<a href="https://example.com">docs</a>',
    );
    expect(cache.latchedWholeDocumentPrefix).toBe(withDefinition);
    expect(renderPieces(cache, "Rewritten.\n\nBody.")).toEqual(
      renderWholeDocument("Rewritten.\n\nBody."),
    );
    expect(cache.latchedWholeDocumentPrefix).toBeNull();
    expect(before.children).toHaveLength(3);
  });

  it("matches a single document for every pair of adjacent blocks", () => {
    for (const first of PAIR_FIRST_BLOCKS) {
      for (const separator of PAIR_SEPARATORS) {
        for (const second of PAIR_SECOND_BLOCKS) {
          expectPiecesMatchWholeDocument(
            createMarkdownPieceCache(),
            `${first}${separator}${second}`,
            "block pair",
          );
        }
      }
    }
  });

  it("matches a single document for every prefix of seeded block sequences", () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      const next = seededRandom(seed);
      const blocks = Array.from(
        { length: 3 + Math.floor(next() * 5) },
        () => FUZZ_BLOCKS[Math.floor(next() * FUZZ_BLOCKS.length)] ?? "",
      );
      streamEveryCharacter(
        blocks
          .map(
            (block, index) =>
              `${index === 0 ? "" : (PAIR_SEPARATORS[Math.floor(next() * PAIR_SEPARATORS.length)] ?? "")}${block}`,
          )
          .join(""),
        `seed ${seed}`,
      );
    }
  }, 60_000);

  it.each(MARKDOWN_FIXTURES)(
    "matches single documents for every streamed chunk of the $name fixture",
    ({ name, text }) => {
      const settledCache = createMarkdownPieceCache();
      const tailCache = createMarkdownPieceCache();
      const completedCache = createMarkdownPieceCache();
      for (const end of chunkEnds(text, name.length)) {
        const streamed = text.slice(0, end);
        const split = splitStreamingMarkdown(streamed);
        const live = repairStreamingMarkdownTail(split?.tail ?? streamed);
        if (split === null) {
          expectPiecesMatchWholeDocument(settledCache, live, name);
        } else {
          expectPiecesMatchWholeDocument(settledCache, split.settled, name);
          expectPiecesMatchWholeDocument(tailCache, live, name);
        }
      }
      expectPiecesMatchWholeDocument(settledCache, text, name);
      expectPiecesMatchWholeDocument(completedCache, text, name);
    },
    60_000,
  );
});
