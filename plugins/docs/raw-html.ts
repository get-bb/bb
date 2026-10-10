import { Node, mergeAttributes } from "@tiptap/core";
import type { MarkdownNodeSpec } from "tiptap-markdown";

export const RawHtml = Node.create({
  name: "rawHtml",
  group: "block",
  atom: true,
  isolating: true,
  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-source") ?? "",
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-docs-raw-html]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-docs-raw-html": "true",
        "data-source": String(node.attrs.source),
      }),
      ["pre", {}, String(node.attrs.source)],
    ];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("section");
      dom.className = "simple-html-embed";
      dom.contentEditable = "false";
      const header = document.createElement("div");
      header.className = "simple-html-embed-header";
      header.textContent = "HTML block · preserved · edit in source";
      const source = document.createElement("pre");
      source.textContent = String(node.attrs.source);
      dom.append(header, source);
      return { dom };
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.write(String(node.attrs.source));
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
              ) {
                return source;
              }
              return `<div data-docs-raw-html="true" data-source="${markdown.utils.escapeHtml(source)}"><pre>${markdown.utils.escapeHtml(source)}</pre></div>`;
            };
          },
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});

export const RawInlineHtml = RawHtml.extend({
  name: "rawInlineHtml",
  group: "inline",
  inline: true,
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
          state.write(String(node.attrs.source));
        },
        parse: {
          setup(markdown) {
            markdown.renderer.rules.html_inline = (tokens, index) =>
              `<span data-docs-raw-html="true" data-source="${markdown.utils.escapeHtml(tokens[index]!.content)}"></span>`;
          },
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});
