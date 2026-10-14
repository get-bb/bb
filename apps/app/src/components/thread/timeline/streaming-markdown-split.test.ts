import { describe, expect, it } from "vitest";
import {
  resolveStreamingMarkdown,
  splitStreamingMarkdown,
} from "./streaming-markdown-split";

function expectSplit(text: string, settled: string) {
  const split = splitStreamingMarkdown(text);
  expect(split).not.toBeNull();
  expect(split?.settled).toBe(settled);
  expect(split?.tail).toBe(text.slice(settled.length));
  expect(`${split?.settled}${split?.tail}`).toBe(text);
}

describe("splitStreamingMarkdown", () => {
  it("returns null when there is no blank line followed by a complete line", () => {
    expect(splitStreamingMarkdown("")).toBeNull();
    expect(splitStreamingMarkdown("Only one paragraph so far")).toBeNull();
    expect(splitStreamingMarkdown("Para one.\n\nPara two still")).toBeNull();
    expect(splitStreamingMarkdown("\n\nleading blanks\n")).toBeNull();
  });

  it("splits at the last blank line whose next line is complete", () => {
    expectSplit("Para one.\n\nPara two.\n\nPara three", "Para one.\n\n");
    expectSplit(
      "Para one.\n\nPara two.\n\nPara three.\nmore",
      "Para one.\n\nPara two.\n\n",
    );
  });

  it("only moves the boundary forward as text streams in", () => {
    const chunks = [
      "# Title\n",
      "\n",
      "Intro paragraph.\n",
      "\n",
      "```ts\n",
      "const a = 1;\n",
      "\n",
      "const b = 2;\n",
      "```\n",
      "\n",
      "1. first\n",
      "\n",
      "2. second\n",
      "\n",
      "Closing",
      " words.\n",
      "\n",
      "Done.\n",
    ];
    let text = "";
    let previousSettledLength = 0;
    for (const chunk of chunks) {
      text += chunk;
      const split = splitStreamingMarkdown(text);
      const settledLength = split?.settled.length ?? 0;
      expect(settledLength).toBeGreaterThanOrEqual(previousSettledLength);
      if (split !== null) {
        expect(text.startsWith(split.settled)).toBe(true);
      }
      previousSettledLength = settledLength;
    }
  });

  it("does not split inside an open fenced code block", () => {
    const text = "Intro.\n\n```js\nline one\n\nline two\n\nline three\n";
    expectSplit(text, "Intro.\n\n");
    const closed = `${text}\`\`\`\n\nAfter the fence.\n`;
    expectSplit(
      closed,
      "Intro.\n\n```js\nline one\n\nline two\n\nline three\n```\n\n",
    );
  });

  it("requires the closing fence to match the opening marker", () => {
    const text = "Intro.\n\n````md\n```\ninner\n```\n\ntext\n";
    expectSplit(text, "Intro.\n\n");
    const tilde = "Intro.\n\n~~~\n```\n\nx\n";
    expectSplit(tilde, "Intro.\n\n");
  });

  it("does not split inside an open $$ math block", () => {
    const text = "Formula:\n\n$$\na = b\n\nc = d\n";
    expectSplit(text, "Formula:\n\n");
    const closed = `${text}$$\n\nDone.\n`;
    expectSplit(closed, "Formula:\n\n$$\na = b\n\nc = d\n$$\n\n");
  });

  it("treats inline $$x$$ spans as closed math", () => {
    expectSplit(
      "Price is $$x$$ here.\n\nNext para.\n\nTail\n",
      "Price is $$x$$ here.\n\nNext para.\n\n",
    );
  });

  it("does not split between items of a loose list or before indented continuation", () => {
    expectSplit(
      "Intro.\n\n- one\n\n- two\n\n- three\n\nAfter list.\n",
      "Intro.\n\n- one\n\n- two\n\n- three\n\n",
    );
    expectSplit(
      "Intro.\n\n1. one\n\n   continued\n\n2. two\n\nAfter.\n",
      "Intro.\n\n1. one\n\n   continued\n\n2. two\n\n",
    );
  });

  it("splits before a heading that follows a blank line", () => {
    const split = splitStreamingMarkdown("Intro text.\n\n## Section\n\nBody");
    expect(split?.settled).toBe("Intro text.\n\n");
    expect(split?.tail).toBe("## Section\n\nBody");
    expectSplit(
      "Intro text.\n\n## Section\n\nBody paragraph.\n\nMore",
      "Intro text.\n\n## Section\n\n",
    );
  });
});

function streamingDocuments(text: string, streaming: boolean): string[] {
  const { split, liveMarkdown } = resolveStreamingMarkdown(text, streaming);
  return split === null ? [liveMarkdown] : [split.settled, liveMarkdown];
}

describe("resolveStreamingMarkdown", () => {
  it.each([
    ["**Streaming bold", "**Streaming bold**"],
    ["`streaming code", "`streaming code`"],
    ["Read [the docs](https://example", "Read the docs"],
    ["Image ![preview](/workspace/preview", "Image "],
  ])(
    "repairs an unsplit live tail and restores raw source on completion: %s",
    (source, repaired) => {
      expect(streamingDocuments(source, true)).toEqual([repaired]);
      expect(streamingDocuments(source, false)).toEqual([source]);
    },
  );

  it("repairs only the live split tail", () => {
    expect(
      streamingDocuments(
        "Settled **source.\n\nSecond paragraph.\n\n`live code",
        true,
      ),
    ).toEqual(["Settled **source.\n\n", "Second paragraph.\n\n`live code`"]);
  });

  it("repairs unfinished formatting after ordinary double-colon text", () => {
    const source = "Call Namespace::Method, then **live bold";
    expect(streamingDocuments(source, true)).toEqual([
      "Call Namespace::Method, then **live bold**",
    ]);
    expect(
      streamingDocuments(`Settled.\n\nSecond paragraph.\n\n${source}`, true),
    ).toEqual(["Settled.\n\n", `Second paragraph.\n\n${source}**`]);
  });

  it.each([
    "::inline-vis[label",
    "  ::inline-vis[label",
    "> ::inline-vis[label",
    "- ::inline-vis[label",
    '::inline-vis{file="[draft.html"}',
    '::inline-vis{file="a__b.html"}',
    '::unknown{title="**source"}',
  ])("preserves directive source in a live tail: %s", (source) => {
    expect(streamingDocuments(source, true)).toEqual([source]);
  });

  it("resumes repair after a directive moves into the settled prefix", () => {
    const source = '::inline-vis{file="[draft.html"}';
    expect(streamingDocuments(`${source}\n\n**live`, true)).toEqual([
      `${source}\n\n**live`,
    ]);
    expect(
      streamingDocuments(`${source}\n\nSecond paragraph.\n\n**live`, true),
    ).toEqual([`${source}\n\n`, "Second paragraph.\n\n**live**"]);
  });

  it.each([
    '~~~ts\nconst x = "**text";\n',
    '> ~~~ts\n> const x = "**text";\n',
    '- ```ts\n  const x = "**text";\n',
  ])("preserves fenced code verbatim in the live tail: %s", (source) => {
    expect(streamingDocuments(source, true)).toEqual([source]);
  });

  it("keeps an open fenced block inside the live tail", () => {
    expect(
      streamingDocuments(
        "Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n",
        true,
      ),
    ).toEqual(["Intro.\n\n", "```ts\nconst a = 1;\n\nconst b = 2;\n"]);
  });

  it("returns a single document when no boundary is available or when not streaming", () => {
    expect(streamingDocuments("Only one paragraph", true)).toEqual([
      "Only one paragraph",
    ]);
    expect(
      streamingDocuments("Para one.\n\nPara two.\n\nPara three", false),
    ).toEqual(["Para one.\n\nPara two.\n\nPara three"]);
  });
});
