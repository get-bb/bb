import { InputRule, Mark, Node } from "@tiptap/core";
import type { MarkdownMarkSpec, MarkdownNodeSpec } from "tiptap-markdown";

const RENDERED_TAG =
  /^<(\/?)(a|b|br|code|del|em|i|s|strike|strong)((?:\s[^>]*?)?)\s*\/?>$/i;
const LINK_ATTRIBUTES = /^(?:\s+(?:href|title)="[^"]*")+$/i;

interface InlineToken {
  type: string;
  content: string;
}

function renderedTags(tokens: InlineToken[]): Set<number> {
  const rendered = new Set<number>();
  const open = new Map<string, number[]>();
  tokens.forEach((token, index) => {
    if (token.type !== "html_inline") return;
    const match = RENDERED_TAG.exec(token.content);
    if (!match) return;
    const [, closing, name, attributes] = match;
    const tag = name!.toLowerCase();
    if (closing) {
      const opening = open.get(tag)?.pop();
      if (opening === undefined) return;
      rendered.add(opening);
      rendered.add(index);
    } else if (
      tag === "br"
        ? !attributes
        : tag === "a"
          ? LINK_ATTRIBUTES.test(attributes!) && /href=/i.test(attributes!)
          : !attributes
    ) {
      if (tag === "br") rendered.add(index);
      else open.set(tag, [...(open.get(tag) ?? []), index]);
    }
  });
  return rendered;
}

const renderedByTokens = new WeakMap<InlineToken[], Set<number>>();
const TYPED_TAG = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>$/i;

export const HtmlSource = Mark.create({
  name: "htmlSource",
  priority: 1,
  inclusive: false,
  parseHTML() {
    return [{ tag: "span[data-html-source]" }];
  },
  renderHTML() {
    return ["span", { "data-html-source": "" }, 0];
  },
  addInputRules() {
    return [
      new InputRule({
        find: TYPED_TAG,
        handler: ({ state, range, match }) => {
          state.tr
            .insertText(match[0], range.from, range.to)
            .addMark(
              range.from,
              range.from + match[0].length,
              this.type.create(),
            );
        },
      }),
    ];
  },
  addStorage() {
    return {
      markdown: {
        serialize: { open: "", close: "", escape: false },
        parse: {
          setup(markdown) {
            markdown.renderer.rules.html_inline = (tokens, index) => {
              const source = tokens[index]!.content;
              let rendered = renderedByTokens.get(tokens);
              if (!rendered) {
                rendered = renderedTags(tokens);
                renderedByTokens.set(tokens, rendered);
              }
              if (
                rendered.has(index) ||
                (index === 0 &&
                  source.startsWith('<input class="task-list-item-checkbox"'))
              )
                return source;
              return `<span data-html-source>${markdown.utils.escapeHtml(source)}</span>`;
            };
          },
        },
      } satisfies MarkdownMarkSpec,
    };
  },
});

export const HtmlBlock = Node.create({
  name: "htmlBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  parseHTML() {
    return [
      { tag: "pre[data-html-block]", preserveWhitespace: "full", priority: 60 },
    ];
  },
  renderHTML() {
    return ["pre", { "data-html-block": "" }, 0];
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
            markdown.renderer.rules.html_block = (tokens, index) => {
              const source = tokens[index]!.content;
              if (
                /^<div data-simple-html-embed="true" data-src="[^"]*" data-height="\d+"><\/div>\s*$/.test(
                  source,
                )
              )
                return source;
              const escaped = markdown.utils.escapeHtml(
                source.replace(/\n$/, ""),
              );
              return tokens[index - 1]?.type === "list_item_open"
                ? `<span data-html-source>${escaped}</span>`
                : `<pre data-html-block>${escaped}</pre>`;
            };
          },
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});
