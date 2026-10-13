import { Node, type Editor } from "@tiptap/core";
import { DOMParser } from "@tiptap/pm/model";
import type { MarkdownNodeSpec } from "tiptap-markdown";

type InlineToken = { type: string; content: string; nesting: number };
type MarkdownIt = Parameters<
  NonNullable<NonNullable<MarkdownNodeSpec["parse"]>["setup"]>
>[0];

const MARKER = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)))
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");

const STRUCTURAL_TAGS = new Set([
  "BODY",
  "COLGROUP",
  "OL",
  "TABLE",
  "TBODY",
  "TFOOT",
  "THEAD",
  "TR",
  "UL",
]);
const TEXT_BLOCK_TAGS = new Set([
  "BLOCKQUOTE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "P",
  "TD",
  "TH",
]);
const COLUMN_WIDTH = /^(?:min-)?width: (\d+)px;?$/;
const ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  lt: "<",
  gt: ">",
  nbsp: "\u00a0",
};

function decodeHtml(value: string): string {
  return value.replace(
    /&(amp|quot|lt|gt|nbsp);/g,
    (_match, name: string) => ENTITIES[name]!,
  );
}

export function restoreRawHtml(markdown: string): string {
  const decode = (_match: string, source: string) => decodeHtml(source);
  return markdown.replaceAll(
    new RegExp(
      `<pre data-docs-raw-html="${MARKER}"><code>([^<]*)</code></pre>`,
      "g",
    ),
    decode,
  );
}

function parseHtml(html: string): HTMLElement {
  return new window.DOMParser().parseFromString(html, "text/html").body;
}

function normalizeHtml(root: HTMLElement): HTMLElement {
  for (const section of root.querySelectorAll("thead, tbody"))
    section.replaceWith(...section.childNodes);
  for (const table of root.querySelectorAll("table")) {
    const cols = [...table.querySelectorAll(":scope > colgroup > col")];
    const columns = cols.length || (table.rows[0]?.cells.length ?? 0);
    const width = cols.length
      ? cols.reduce(
          (sum, col) =>
            sum + Number(COLUMN_WIDTH.exec(col.getAttribute("style") ?? "")?.[1]),
          0,
        )
      : columns * 25;
    if (/^min-width: (\d+)px;?$/.exec(table.getAttribute("style") ?? "")?.[1] === String(width))
      table.removeAttribute("style");
  }
  for (const col of root.querySelectorAll("col"))
    if (/^min-width: 25px;?$/.test(col.getAttribute("style") ?? ""))
      col.removeAttribute("style");
  for (const group of root.querySelectorAll("colgroup"))
    if ([...group.children].every((col) => col.attributes.length === 0))
      group.remove();
  for (const cell of root.querySelectorAll("td, th"))
    for (const name of ["colspan", "rowspan"])
      if (cell.getAttribute(name) === "1") cell.removeAttribute(name);
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode())
    if (walker.currentNode instanceof window.Text) texts.push(walker.currentNode);
  for (const text of texts) {
    const parent = text.parentElement!;
    if (parent.closest("pre")) continue;
    text.data = text.data.replace(/[ \t\r\n\f]+/g, " ");
    if (STRUCTURAL_TAGS.has(parent.tagName) && text.data === " ") text.remove();
    else if (TEXT_BLOCK_TAGS.has(parent.tagName)) {
      if (!text.previousSibling) text.data = text.data.trimStart();
      if (!text.nextSibling) text.data = text.data.trimEnd();
      if (!text.data) text.remove();
    }
  }
  for (const cell of root.querySelectorAll("td, th, li")) {
    const only = cell.firstChild;
    if (
      only === cell.lastChild &&
      only instanceof window.HTMLParagraphElement &&
      only.attributes.length === 0
    )
      only.replaceWith(...only.childNodes);
  }
  return root;
}

function isLossless(
  source: string,
  editor: Editor,
  markdown: MarkdownIt,
): boolean {
  const original = parseHtml(source);
  if (!original.textContent?.trim()) return false;
  const loaded = parseHtml(
    source.replace(/\n<\/code><\/pre>/g, "</code></pre>"),
  );
  editor.storage.markdown.parser.normalizeDOM(loaded, {
    inline: false,
    content: source,
  });
  const saved: string = editor.storage.markdown.serializer.serialize(
    DOMParser.fromSchema(editor.schema).parse(loaded),
  );
  const verbatim = (tokens: InlineToken[], index: number) =>
    tokens[index]!.content;
  const renderer: MarkdownIt["renderer"] = Object.create(markdown.renderer);
  renderer.rules = {
    ...markdown.renderer.rules,
    html_block: verbatim,
    html_inline: verbatim,
  };
  const reloaded = parseHtml(
    renderer.render(markdown.parse(saved, {}), markdown.options, {}),
  );
  return normalizeHtml(reloaded).isEqualNode(normalizeHtml(original));
}

const losslessByEditor = new WeakMap<Editor, Map<string, boolean>>();

export const RawHtmlBlock = Node.create({
  name: "rawHtmlBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  parseHTML() {
    return [
      {
        tag: `pre[data-docs-raw-html="${MARKER}"]`,
        preserveWhitespace: "full",
        priority: 60,
      },
    ];
  },
  renderHTML() {
    return ["pre", { "data-docs-raw-html": MARKER }, ["code", 0]];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.text(node.textContent, false);
          state.closeBlock(node);
        },
        parse: {
          setup(markdown) {
            const { editor } = this;
            const previous = losslessByEditor.get(editor);
            const lossless = new Map<string, boolean>();
            losslessByEditor.set(editor, lossless);
            const isRich = (source: string) => {
              const rich =
                lossless.get(source) ??
                previous?.get(source) ??
                isLossless(source, editor, markdown);
              lossless.set(source, rich);
              return rich;
            };
            markdown.renderer.rules.html_block = (tokens, index) => {
              const source = tokens[index]!.content;
              if (
                /^<div data-simple-html-embed="true" data-src="[^"]*" data-height="\d+"><\/div>\s*$/.test(
                  source,
                ) ||
                isRich(source)
              ) {
                return source;
              }
              if (tokens[index - 1]?.type === "list_item_open")
                return `<span data-docs-raw-html="true" data-source="${markdown.utils.escapeHtml(source.replace(/\n$/, ""))}"></span>`;
              return `<pre data-docs-raw-html="${MARKER}"><code>${markdown.utils.escapeHtml(source.replace(/\n$/, ""))}</code></pre>`;
            };
          },
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});

export const RawInlineHtml = Node.create({
  name: "rawInlineHtml",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-source") ?? "",
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-docs-raw-html]" }];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-docs-raw-html": "true",
        "data-source": String(node.attrs.source),
      },
      String(node.attrs.source),
    ];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.contentEditable = "false";
      dom.title = "HTML · preserved · edit in source";
      dom.textContent = String(node.attrs.source);
      return { dom };
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.text(String(node.attrs.source), false);
        },
        parse: {
          setup(markdown) {
            markdown.renderer.rules.html_inline = (tokens, index) => {
              const source = tokens[index]!.content;
              if (
                index === 0 &&
                source.startsWith('<input class="task-list-item-checkbox"')
              )
                return source;
              return `<span data-docs-raw-html="true" data-source="${markdown.utils.escapeHtml(source)}"></span>`;
            };
          },
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});
