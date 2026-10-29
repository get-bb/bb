// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { SelectableMessageProse } from "./SelectableMessageProse";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

it("copies selected rendered lists, links and fenced code as markdown without controls", () => {
  const { container } = render(
    <SelectableMessageProse>
      <MarkdownPreview
        content={
          "- **First** [link](https://example.com)\n- Second\n\n```ts\nconst x = 1;\n```"
        }
      />
    </SelectableMessageProse>,
  );
  const range = document.createRange();
  range.selectNodeContents(container.firstElementChild!);
  window.getSelection()!.addRange(range);
  const data = new Map<string, string>();
  fireEvent.copy(document, {
    clipboardData: {
      setData: (type: string, value: string) => data.set(type, value),
    },
  });
  expect(data.get("text/plain")).toBe(
    "- **First** [link](https://example.com)\n- Second\n\n```ts\nconst x = 1;\n```",
  );
  expect(data.get("text/html")).toContain('<a href="https://example.com"');
  expect(data.get("text/html")).not.toContain("button");
});

function copyRange(range: Range) {
  window.getSelection()!.addRange(range);
  const data = new Map<string, string>();
  const accepted = fireEvent.copy(document, {
    clipboardData: {
      setData: (type: string, value: string) => data.set(type, value),
    },
  });
  return { data, accepted };
}

it.each(
  (
    [
      ["code", "`pnpm --version`"],
      ["strong", "**pnpm --version**"],
      ["em", "*pnpm --version*"],
      ["del", "~~pnpm --version~~"],
      ["a", "[pnpm --version](https://example.com)"],
    ] as const
  ).flatMap(([tag, span]) =>
    (["text", "element", "paragraph", "partial", "message"] as const).map(
      (mode) => [tag, span, mode] as const,
    ),
  ),
)(
  "copies a %s span's %s %s selection as visible text unless mixed with prose",
  (tag, span, mode) => {
    const content = `Check:\n\n${span}`;
    const { container } = render(
      <SelectableMessageProse>
        <MarkdownPreview content={content} />
      </SelectableMessageProse>,
    );
    const element = container.querySelector(tag)!;
    const text = element.firstChild!;
    const range = document.createRange();
    let expected = "pnpm --version";
    if (mode === "message") {
      range.selectNodeContents(container.firstElementChild!);
      expected = content;
    } else if (mode === "paragraph") {
      range.selectNodeContents(element.closest("p")!);
    } else if (mode === "element") {
      range.selectNode(element);
    } else {
      range.setStart(text, mode === "partial" ? 5 : 0);
      range.setEnd(text, text.textContent!.length);
      if (mode === "partial") expected = "--version";
    }
    const { data, accepted } = copyRange(range);
    expect(accepted).toBe(false);
    expect(data.get("text/plain")).toBe(expected);
    expect(data.get("text/html")).toContain(`<${tag}`);
  },
);

it.each([
  ["src/export_notes.ts", "file:///workspace/src/export_notes.ts"],
  [
    "src/отчёт_данные.ts",
    "file:///workspace/src/%D0%BE%D1%82%D1%87%D1%91%D1%82_%D0%B4%D0%B0%D0%BD%D0%BD%D1%8B%D0%B5.ts",
  ],
  ["/workspace/src/export_notes.ts", "file:///workspace/src/export_notes.ts"],
  [
    "C:\\workspace\\src\\export_notes.ts",
    "file:///C:/workspace/src/export_notes.ts",
  ],
])(
  "copies auto-linked inline code %s as code while preserving authored links",
  (reference, href) => {
    const content = `**Changed**: \`${reference}\` and [Review](file:///workspace/review.md).`;
    const { container } = render(
      <SelectableMessageProse>
        <MarkdownPreview
          content={content}
          linkRouting={{
            localFile: {
              absoluteLinks: { kind: "trusted-host" },
              relativeLinks: { baseDir: "/workspace", rootPath: "/workspace" },
              onOpenLink: () => true,
            },
          }}
        />
      </SelectableMessageProse>,
    );
    const range = document.createRange();
    range.selectNodeContents(container.firstElementChild!);
    const { data } = copyRange(range);
    expect(data.get("text/html")).toContain(`<a href="${href}"`);
    expect(data.get("text/plain")).toBe(content);

    window.getSelection()!.removeAllRanges();
    range.selectNodeContents(container.querySelector("a")!);
    expect(copyRange(range).data.get("text/plain")).toBe(reference);
  },
);

it("copies only the selected portion of a highlighted code block as bare code, preserving blank lines", () => {
  const { container } = render(
    <SelectableMessageProse>
      <MarkdownPreview content={"```ts\nconst x = 1;\n\nconst y = 2;\n```"} />
    </SelectableMessageProse>,
  );
  const code = container.querySelector("code")!;
  const range = document.createRange();
  range.selectNodeContents(code);
  expect(copyRange(range).data.get("text/plain")).toBe(
    "const x = 1;\n\nconst y = 2;",
  );
});

it("preserves inline ancestors around selections that extend past them without copying unselected text", () => {
  const { container } = render(
    <SelectableMessageProse>
      <p>
        Before{" "}
        <a href="https://example.com">
          <strong>selected words</strong>
        </a>{" "}
        after
      </p>
    </SelectableMessageProse>,
  );
  const text = container.querySelector("strong")!.firstChild!;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 8);
  expect(copyRange(range).data.get("text/plain")).toBe("selected");
  window.getSelection()!.removeAllRanges();
  range.setStart(container.querySelector("p")!.firstChild!, 3);
  expect(copyRange(range).data.get("text/plain")).toBe(
    "ore [**selected**](https://example.com)",
  );
});

it.each([
  ["Rename my_old_var in config_loader.py", true],
  ["Open C:\\Users\\me\\notes.txt", true],
  ["Check x < y and y > z, then read arr[0]", true],
  ["Rename über_straße", true],
  ["_leading_ and snake_case_", false],
  ["2*3*4 and `tick`", false],
  ["<div> and <https://example.com>", false],
  ["> not a quote", false],
  ["[label]: https://example.com", false],
  ["[text](not a link) and [x][y]", false],
  ["a\\*b and a trailing backslash\\", false],
])(
  "copies prose %j as Markdown that renders back to the same text",
  (prose, unchanged) => {
    const { container } = render(
      <SelectableMessageProse>
        <p>{prose}</p>
      </SelectableMessageProse>,
    );
    const range = document.createRange();
    range.selectNodeContents(container.querySelector("p")!);
    const copied = copyRange(range).data.get("text/plain")!;
    if (unchanged) expect(copied).toBe(prose);
    cleanup();
    const rendered = render(<MarkdownPreview content={copied} />);
    expect(rendered.container.textContent).toBe(prose);
  },
);

it("preserves nested lists, blockquotes, task lists and fences containing backticks", () => {
  const { container } = render(
    <SelectableMessageProse>
      <MarkdownPreview
        content={
          "3. Three\n   - [x] Nested\n4. Four\n\n> Quoted *words*\n\n- [x] Done\n\n````md\n```ts\n\nhello\n```\n````"
        }
      />
    </SelectableMessageProse>,
  );
  const range = document.createRange();
  range.selectNodeContents(container.firstElementChild!);
  const text = copyRange(range).data.get("text/plain")!;
  expect(text).toContain("3. Three\n   - [x] Nested\n4. Four");
  expect(text).toContain("> Quoted *words*");
  expect(text).toContain("- [x] Done");
  expect(text).toContain("````md\n```ts\n\nhello\n```\n````");
});

it.each(["strong", "code"] as const)(
  "copies %s across messages but leaves unrelated and editable selections to the browser",
  (tag) => {
    const { container } = render(
      <>
        <SelectableMessageProse>
          <p>
            {tag === "code" ? (
              <code>pnpm --version</code>
            ) : (
              <strong>One</strong>
            )}
          </p>
        </SelectableMessageProse>
        <div>Message timestamp</div>
        <SelectableMessageProse>
          <p>
            <em>Two</em>
          </p>
        </SelectableMessageProse>
        <div contentEditable suppressContentEditableWarning>
          Draft
        </div>
      </>,
    );
    const range = document.createRange();
    range.setStartBefore(container.querySelector(tag)!);
    range.setEndAfter(container.querySelector("em")!);
    expect(copyRange(range).data.get("text/plain")).toBe(
      `${tag === "code" ? "`pnpm --version`" : "**One**"}\n\n*Two*`,
    );
    window.getSelection()!.removeAllRanges();
    range.selectNodeContents(container.querySelector("[contenteditable]")!);
    expect(copyRange(range).data.size).toBe(0);
  },
);

it("copies a whitespace boundary spill without changing the live selection", () => {
  const { container } = render(
    <>
      <SelectableMessageProse>
        <p>
          <strong>Message</strong>
        </p>
      </SelectableMessageProse>
      {"\n"}
    </>,
  );
  const range = document.createRange();
  range.setStart(container.querySelector("strong")!.firstChild!, 0);
  range.setEnd(container.lastChild!, 1);
  const before = range.toString();
  expect(copyRange(range).data.get("text/plain")).toBe("Message");
  expect(window.getSelection()!.toString()).toBe(before);
});

it("retains the numbers when copying later ordered list items", () => {
  const { container } = render(
    <SelectableMessageProse>
      <MarkdownPreview content={"3. Three\n4. Four\n5. Five"} />
    </SelectableMessageProse>,
  );
  const items = container.querySelectorAll("li");
  const range = document.createRange();
  range.setStart(items[1]!, 0);
  range.setEnd(items[2]!, 1);
  expect(copyRange(range).data.get("text/plain")).toBe("4. Four\n5. Five");
});

it("copies selected tables as Markdown with links, emphasis, code and escaped pipes", () => {
  const { container } = render(
    <SelectableMessageProse>
      <MarkdownPreview
        content={
          '| Name | Value |\n| --- | --- |\n| [Link](https://example.com) | a,b |\n| **Bold** | say "hi" |\n| a\\|b | `code` |'
        }
      />
    </SelectableMessageProse>,
  );
  const range = document.createRange();
  range.selectNodeContents(container.firstElementChild!);
  const { data } = copyRange(range);
  expect(data.get("text/plain")).toBe(
    '| Name | Value |\n| --- | --- |\n| [Link](https://example.com) | a,b |\n| **Bold** | say "hi" |\n| a\\|b | `code` |',
  );
  expect(data.get("text/html")).toContain("<table>");
  expect(data.get("text/html")).not.toContain("Copy as");
});

it("copies rendered math as TeX text and MathML without KaTeX's duplicate layout", async () => {
  const { container } = render(
    <SelectableMessageProse>
      <MarkdownPreview
        content={
          "Energy $$E = mc^2$$ is **big**.\n\n$$\n\\alpha_1 < \\beta\n$$"
        }
      />
    </SelectableMessageProse>,
  );
  await waitFor(() => {
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });
  const text = container.querySelector(".katex-html")!.firstChild!;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEndAfter(container.querySelector(".katex-display")!);
  const { data } = copyRange(range);
  expect(data.get("text/plain")).toBe(
    "$$E = mc^2$$ is **big**.\n\n$$\n\\alpha_1 < \\beta\n$$",
  );
  const html = document.createElement("div");
  html.innerHTML = data.get("text/html")!;
  expect(html.querySelectorAll("math")).toHaveLength(2);
  expect(html.querySelector('math[display="block"]')).not.toBeNull();
  expect(html.textContent).toBe("E=mc2 is big.\nα1<β");
});

it("copies math inside emphasis as TeX rather than KaTeX's duplicated layout text", async () => {
  const { container } = render(
    <SelectableMessageProse>
      <MarkdownPreview content={"**Energy $$E = mc^2$$ is big**"} />
    </SelectableMessageProse>,
  );
  await waitFor(() => {
    expect(container.querySelector(".katex")).not.toBeNull();
  });
  const range = document.createRange();
  range.selectNodeContents(container.querySelector("strong")!);
  expect(copyRange(range).data.get("text/plain")).toBe(
    "**Energy $$E = mc^2$$ is big**",
  );
});

function renderBlocks() {
  return render(
    <SelectableMessageProse>
      <MarkdownPreview
        content={
          "## Hello **bold** words\n\n3. Three\n4. Four\n   1. [x] Nested item\n   2. Other\n\n> Quoted *emphasis* phrase\n>\n> Second\n\n| Name | Value |\n| --- | --- |\n| some cell text | other |"
        }
      />
    </SelectableMessageProse>,
  ).container;
}

function textNode(container: Element, text: string): Text {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (node instanceof Text && node.data.includes(text)) return node;
  throw new Error(`No text node contains ${text}`);
}

function selectText(container: Element, from: string, to = from): Range {
  const start = textNode(container, from);
  const end = textNode(container, to);
  const range = document.createRange();
  range.setStart(start, start.data.indexOf(from));
  range.setEnd(end, end.data.indexOf(to) + to.length);
  return range;
}

it.each([
  [
    "inside heading emphasis",
    "bold",
    "bold",
    "bold",
    "<strong>bold</strong>",
  ],
  [
    "across heading emphasis",
    "llo ",
    " wo",
    "llo **bold** wo",
    "llo <strong>bold</strong> wo",
  ],
  [
    "of a whole heading",
    "Hello",
    " words",
    "Hello **bold** words",
    "Hello <strong>bold</strong> words",
  ],
  ["in a list item", "Thr", "Thr", "Thr", "Thr"],
  ["of a whole list item", "Four", "Four", "Four", "Four"],
  [
    "of a whole nested task item",
    "Nested item",
    "Nested item",
    "Nested item",
    "Nested item",
  ],
  ["in a quote", "emphasis", "emphasis", "emphasis", "<em>emphasis</em>"],
  [
    "of a whole quoted paragraph",
    "Quoted",
    "phrase",
    "Quoted *emphasis* phrase",
    "Quoted <em>emphasis</em> phrase",
  ],
  [
    "of a whole table cell",
    "some cell text",
    "some cell text",
    "some cell text",
    "some cell text",
  ],
])(
  "copies a selection %s without enclosing block markdown",
  (_, from, to, text, html) => {
    const { data } = copyRange(selectText(renderBlocks(), from, to));
    expect(data.get("text/plain")).toBe(text);
    expect(data.get("text/html")).toBe(html);
  },
);

it.each([
  ["a heading and a list", "bold", "Three", "## **bold** words\n\n3. Three"],
  ["list items", "Three", "Four", "3. Three\n4. Four"],
  ["nested task items", "item", "Oth", "1. [x] item\n2. Oth"],
  [
    "quoted paragraphs",
    "Quoted",
    "Second",
    "> Quoted *emphasis* phrase\n> \n> Second",
  ],
  ["table cells", "cell text", "other", "| cell text | other |\n| --- | --- |"],
])(
  "copies a selection spanning %s with its block structure",
  (_, from, to, text) => {
    expect(
      copyRange(selectText(renderBlocks(), from, to)).data.get("text/plain"),
    ).toBe(text);
  },
);

it.each([
  [
    "Hello",
    "Three",
    "Hello **bold** words",
    "Hello <strong>bold</strong> words",
  ],
  ["Four", "Nested item", "Four", "Four"],
  [
    "Quoted",
    "Second",
    "Quoted *emphasis* phrase",
    "Quoted <em>emphasis</em> phrase",
  ],
])(
  "ignores the empty next-block boundary a triple-click on %s leaves",
  (from, next, text, html) => {
    const container = renderBlocks();
    const range = selectText(container, from);
    range.setEnd(textNode(container, next), 0);
    const { data } = copyRange(range);
    expect(data.get("text/plain")).toBe(text);
    expect(data.get("text/html")).toBe(html);
  },
);

it.each([
  ["a bare URL", "https://example.com/a_b?x=1", "https://example.com/a_b?x=1"],
  ["part of a bare URL", "example.com/a_b", "example.com/a_b"],
  ["a www link", "www.example.net/x", "www.example.net/x"],
  ["an email link", "me@example.com", "me@example.com"],
  ["a named link", "docs", "docs"],
  ["a URL filling a list item", "https://github.com", "https://github.com"],
])("copies %s as pasteable text", (_, selected, text) => {
  const { container } = render(
    <SelectableMessageProse>
      <MarkdownPreview
        content={
          "- See https://example.com/a_b?x=1, www.example.net/x, me@example.com and [docs](https://docs.example.com).\n- https://github.com"
        }
      />
    </SelectableMessageProse>,
  );
  const { data } = copyRange(selectText(container, selected));
  expect(data.get("text/plain")).toBe(text);
  expect(data.get("text/html")).toContain("<a href=");
});

it.each([
  [
    "/Users/michael/.bb/thread-storage/thr_v5h7wv4b4f/sanity-check.sh",
    "file:///Users/michael/.bb/thread-storage/thr_v5h7wv4b4f/sanity-check.sh",
    "sanity-check.sh",
  ],
  [
    "/work space/my_script.sh",
    "file:///work%20space/my_script.sh",
    "my_script",
  ],
  [
    "C:\\work space\\my_script.sh",
    "file:///C:/work%20space/my_script.sh",
    "my_script.sh",
  ],
])("copies file path %s without Markdown syntax", (path, href, part) => {
  const { container } = render(
    <SelectableMessageProse>
      <p>
        <a href={href}>{path}</a>
      </p>
    </SelectableMessageProse>,
  );
  for (const selected of [path, part]) {
    window.getSelection()!.removeAllRanges();
    const { data } = copyRange(selectText(container, selected));
    expect(data.get("text/plain")).toBe(selected);
    expect(data.get("text/html")).toContain(`<a href="${href}">`);
  }
});
