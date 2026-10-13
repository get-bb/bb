import { Extension, Mark, Node, type Editor } from "@tiptap/core";
import { DOMParser } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { AddMarkStep } from "@tiptap/pm/transform";
import type { MarkdownMarkSpec, MarkdownNodeSpec } from "tiptap-markdown";

type InlineToken = { type: string; content: string; nesting: number };
type MarkdownIt = Parameters<
  NonNullable<NonNullable<MarkdownNodeSpec["parse"]>["setup"]>
>[0];

const MARKER = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)))
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");

const PHRASING_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "cite",
  "code",
  "del",
  "em",
  "i",
  "ins",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
  "var",
]);

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
  return markdown
    .replaceAll(
      new RegExp(
        `<pre data-docs-raw-html="${MARKER}"><code>([^<]*)</code></pre>`,
        "g",
      ),
      decode,
    )
    .replaceAll(
      new RegExp(`<code data-docs-html-source="${MARKER}">([^<]*)</code>`, "g"),
      decode,
    )
    .replaceAll(
      new RegExp(`<br data-docs-html-break="${MARKER}" data-source="([^"]*)">`, "g"),
      decode,
    )
    .replaceAll(
      new RegExp(
        `<[a-z]+ data-docs-html-open="([^"]*)" data-docs-html-close="[^"]*" data-docs-html-mark="${MARKER}">`,
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

function losslessHtml(
  source: string,
  editor: Editor,
  markdown: MarkdownIt,
): string | false {
  const original = parseHtml(source);
  if (!original.textContent?.trim()) return false;
  const probe = parseHtml(`${source}<p data-docs-end></p>`);
  if (!probe.lastElementChild?.matches("p[data-docs-end]:empty")) return false;
  const html = original.innerHTML;
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
  return normalizeHtml(reloaded).isEqualNode(normalizeHtml(original)) && html;
}

function phrasingTag(source: string): string | undefined {
  const tag = /^<([a-z]+)(?:\s[^>]*)?>$/i.exec(source)?.[1]?.toLowerCase();
  return tag && !source.endsWith("/>") && PHRASING_TAGS.has(tag)
    ? tag
    : undefined;
}

function pairTags(tokens: InlineToken[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: {
    tag: string;
    source: string;
    index: number;
    level: number;
    text: number;
    nested: number;
  }[] = [];
  const counts = new Map<string, number>();
  const sources = new Map<string, number>();
  const closed = new Map<number, string>();
  const key = (tag: string, level: number) => `${level}:${tag}`;
  const pop = () => {
    const entry = stack.pop()!;
    const entryKey = key(entry.tag, entry.level);
    counts.set(entryKey, counts.get(entryKey)! - 1);
    sources.set(entry.source, sources.get(entry.source)! - 1);
    return entry;
  };
  let level = 0;
  let text = 0;
  let nested = 0;
  tokens.forEach((token, index) => {
    if (token.type !== "html_inline") {
      level += token.nesting;
      while (stack.length > 0 && stack.at(-1)!.level > level) pop();
      if (token.type === "text" && /\S/.test(token.content)) text++;
      if (
        token.type === "code_inline" ||
        token.type === "image" ||
        token.type.startsWith("link_")
      )
        nested++;
      return;
    }
    const tag = phrasingTag(token.content);
    if (tag) {
      stack.push({ tag, source: token.content, index, level, text, nested });
      counts.set(key(tag, level), (counts.get(key(tag, level)) ?? 0) + 1);
      sources.set(token.content, (sources.get(token.content) ?? 0) + 1);
      return;
    }
    const closing = /^<\/([a-z]+)>$/.exec(token.content)?.[1];
    if (!closing || !counts.get(key(closing, level))) return;
    let entry = pop();
    while (entry.tag !== closing) entry = pop();
    if (
      entry.text < text &&
      entry.nested === nested &&
      tokens[entry.index - 1]?.nesting !== 1 &&
      !sources.get(entry.source) &&
      closed.get(entry.index - 1) !== entry.source
    ) {
      pairs.set(entry.index, index);
      pairs.set(index, -1);
      closed.set(index, entry.source);
    }
  });
  return pairs;
}

const pairsByTokens = new WeakMap<InlineToken[], Map<number, number>>();
const losslessByEditor = new WeakMap<Editor, Map<string, string | false>>();

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
            const lossless = new Map<string, string | false>();
            losslessByEditor.set(editor, lossless);
            const richHtml = (source: string) => {
              const rich =
                lossless.get(source) ??
                previous?.get(source) ??
                losslessHtml(source, editor, markdown);
              lossless.set(source, rich);
              return rich;
            };
            markdown.renderer.rules.html_block = (tokens, index) => {
              const source = tokens[index]!.content;
              if (
                /^<div data-simple-html-embed="true" data-src="[^"]*" data-height="\d+"><\/div>\s*$/.test(
                  source,
                )
              )
                return source;
              const rich = richHtml(source);
              if (rich !== false) return rich;
              if (tokens[index - 1]?.type === "list_item_open")
                return `<code data-docs-html-source="${MARKER}">${markdown.utils.escapeHtml(source.replace(/\n$/, ""))}</code>`;
              return `<pre data-docs-raw-html="${MARKER}"><code>${markdown.utils.escapeHtml(source.replace(/\n$/, ""))}</code></pre>`;
            };
          },
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});

export const RawHtmlBreak = Node.create({
  name: "rawHtmlBreak",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      source: {
        default: "<br>",
        parseHTML: (element) => element.getAttribute("data-source") ?? "<br>",
      },
    };
  },
  parseHTML() {
    return [{ tag: `br[data-docs-html-break="${MARKER}"]`, priority: 60 }];
  },
  renderHTML({ node }) {
    return [
      "br",
      {
        "data-docs-html-break": MARKER,
        "data-source": String(node.attrs.source),
      },
    ];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.text(String(node.attrs.source), false);
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});

export const RawHtmlInline = Mark.create({
  name: "rawHtmlInline",
  priority: 1,
  inclusive: false,
  code: true,
  parseHTML() {
    return [{ tag: `code[data-docs-html-source="${MARKER}"]`, priority: 60 }];
  },
  renderHTML() {
    return ["code", { "data-docs-html-source": MARKER }, 0];
  },
  addStorage() {
    return {
      markdown: {
        serialize: { open: "", close: "", escape: false },
        parse: {
          setup(markdown) {
            const escape = markdown.utils.escapeHtml;
            markdown.renderer.rules.html_inline = (tokens, index) => {
              let pairs = pairsByTokens.get(tokens);
              if (!pairs) {
                pairs = pairTags(tokens);
                pairsByTokens.set(tokens, pairs);
              }
              const source = tokens[index]!.content;
              if (
                index === 0 &&
                source.startsWith('<input class="task-list-item-checkbox"')
              )
                return source;
              const close = pairs.get(index);
              if (close === -1) return "</span>";
              if (close !== undefined)
                return `<span data-docs-html-open="${escape(source)}" data-docs-html-close="${escape(tokens[close]!.content)}" data-docs-html-mark="${MARKER}">`;
              if (/^<br\s*\/?>$/i.test(source))
                return `<br data-docs-html-break="${MARKER}" data-source="${escape(source)}">`;
              return `<code data-docs-html-source="${MARKER}">${escape(source)}</code>`;
            };
          },
        },
      } satisfies MarkdownMarkSpec,
    };
  },
});

export const RawHtmlFormatting = Mark.create({
  name: "rawHtmlFormatting",
  priority: 1000,
  excludes: "",
  addAttributes() {
    return {
      open: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-docs-html-open"),
        renderHTML: (attributes) => ({
          "data-docs-html-open": String(attributes.open),
        }),
      },
      close: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-docs-html-close"),
        renderHTML: (attributes) => ({
          "data-docs-html-close": String(attributes.close),
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: `[data-docs-html-mark="${MARKER}"]`, priority: 60 }];
  },
  renderHTML({ mark, HTMLAttributes }) {
    return [
      phrasingTag(String(mark.attrs.open)) ?? "span",
      { ...HTMLAttributes, "data-docs-html-mark": MARKER },
      0,
    ];
  },
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state, mark) => String(mark.attrs.open),
          close: (_state, mark) => String(mark.attrs.close),
          mixable: true,
        },
      } satisfies MarkdownMarkSpec,
    };
  },
});

const SOURCE_MARKS = new Set(["rawHtmlInline", "rawHtmlFormatting"]);

function stripPastedSources(html: string): string {
  const body = parseHtml(html);
  for (const element of body.querySelectorAll(
    "[data-docs-html-mark], br[data-docs-html-break], [data-pm-slice*='rawHtml']",
  )) {
    for (const name of [
      "data-docs-html-open",
      "data-docs-html-close",
      "data-docs-html-mark",
      "data-docs-html-break",
      "data-source",
      "data-pm-slice",
    ])
      element.removeAttribute(name);
  }
  return body.innerHTML;
}

function guardSource() {
  return new Plugin({
    props: {
      transformPastedHTML: stripPastedSources,
      handlePaste(view, event) {
        const { state } = view;
        const { from, to, $from } = state.selection;
        const source = state.schema.marks.rawHtmlInline!;
        const inside =
          from === to
            ? source.isInSet($from.marks())
            : state.doc.rangeHasMark(from, to, source);
        if (!inside) return false;
        view.dispatch(
          state.tr.insertText(
            event.clipboardData?.getData("text/plain") ?? "",
            from,
            to,
          ),
        );
        return true;
      },
    },
    appendTransaction(transactions, _oldState, state) {
      const source = state.schema.marks.rawHtmlInline!;
      const tr = state.tr;
      transactions.forEach((transaction, position) =>
        transaction.steps.forEach((step, index) => {
          if (
            !(step instanceof AddMarkStep) ||
            SOURCE_MARKS.has(step.mark.type.name)
          )
            return;
          let { from, to } = step;
          for (const mapping of [
            transaction.mapping.slice(index + 1),
            ...transactions.slice(position + 1).map((later) => later.mapping),
          ]) {
            from = mapping.map(from, 1);
            to = mapping.map(to, -1);
          }
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.isText && source.isInSet(node.marks))
              tr.removeMark(
                Math.max(from, pos),
                Math.min(to, pos + node.nodeSize),
                step.mark,
              );
          });
        }),
      );
      return tr.docChanged ? tr : null;
    },
  });
}

export const RawHtml = Extension.create({
  name: "rawHtml",
  priority: 1001,
  addExtensions() {
    return [RawHtmlBlock, RawHtmlBreak, RawHtmlInline, RawHtmlFormatting];
  },
  addProseMirrorPlugins() {
    return [guardSource()];
  },
});
