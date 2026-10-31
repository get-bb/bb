import type { Editor } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import { defaultMarkdownSerializer } from "@tiptap/pm/markdown";
import type { Mark, Node } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import type { MarkdownMarkSpec, MarkdownNodeSpec } from "tiptap-markdown";

function bareLink(editor: Editor, mark: Mark, parent: Node, index: number) {
  const node = parent.child(index);
  if (
    !node.isText ||
    node.text !== mark.attrs.href ||
    mark.attrs.title ||
    node.marks.length !== 1 ||
    (parent.maybeChild(index - 1)?.marks.length ?? 0) > 0 ||
    (parent.maybeChild(index + 1)?.marks.length ?? 0) > 0
  )
    return false;
  const before = parent.maybeChild(index - 1)?.textContent ?? "";
  const after = parent.maybeChild(index + 1)?.textContent ?? "";
  const matches: { index: number; lastIndex: number; url: string }[] | null =
    editor.storage.markdown.parser.md.linkify.match(before + node.text + after);
  const tokens: {
    children: {
      type: string;
      content: string;
      attrs: [string, string][] | null;
    }[];
  }[] = editor.storage.markdown.parser.md.parseInline(node.text, {});
  const inline = tokens[0]?.children ?? [];
  return (
    inline.length === 3 &&
    inline[0]!.type === "link_open" &&
    inline[0]!.attrs?.some(
      ([name, value]) => name === "href" && value === node.text,
    ) &&
    inline[1]!.type === "text" &&
    inline[1]!.content === node.text &&
    inline[2]!.type === "link_close" &&
    (matches?.some(
      (match) =>
        match.index === before.length &&
        match.lastIndex === before.length + node.text!.length &&
        match.url === mark.attrs.href,
    ) ??
      false)
  );
}

const textMarkdown: MarkdownNodeSpec = {
  serialize(state, node, parent, index) {
    const link = node.marks.find((mark) => mark.type.name === "link");
    if (link && bareLink(this.editor, link, parent, index)) {
      state.text(node.text!, false);
      return;
    }
    const hasStrike = (candidate: Node | null) =>
      candidate?.marks.some((mark) => mark.type.name === "strike");
    const strikeBefore =
      hasStrike(node) || hasStrike(parent.maybeChild(index - 1));
    const strikeAfter =
      hasStrike(node) || hasStrike(parent.maybeChild(index + 1));
    const escape = state.esc;
    state.esc = (text, startOfLine) =>
      escape
        .call(state, text, startOfLine)
        .replace(/(?:\\~)+/g, (run, offset: number, escaped: string) =>
          run.length === 2 &&
          !(offset === 0 && strikeBefore) &&
          !(offset + run.length === escaped.length && strikeAfter)
            ? "~"
            : run,
        );
    try {
      const autolink = "inAutolink" in state && state.inAutolink;
      const text = autolink
        ? node.text!
        : node.text!.replace(
            /&(?:#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi,
            (entity) =>
              this.editor.storage.markdown.parser.md.utils.unescapeAll(
                entity,
              ) === entity
                ? entity
                : "&amp;" + entity.slice(1),
          );
      state.text(text.replace(/</g, "&lt;").replace(/>/g, "&gt;"), !autolink);
    } finally {
      state.esc = escape;
    }
  },
};

const hardBreakMarkdown: MarkdownNodeSpec = {
  serialize(state) {
    state.write("<br>");
  },
};

export const MarkdownStarterKit = StarterKit.configure({}).extend({
  addExtensions() {
    return this.parent!().map((extension) => {
      const markdown =
        extension.name === "text"
          ? textMarkdown
          : extension.name === "hardBreak"
            ? hardBreakMarkdown
            : null;
      return markdown
        ? extension.extend({ addStorage: () => ({ markdown }) })
        : extension;
    });
  },
});

export const MarkdownLink = Link.extend({
  addStorage() {
    const link = defaultMarkdownSerializer.marks.link!;
    return {
      markdown: {
        serialize: {
          ...link,
          open(state, mark, parent, index) {
            return bareLink(this.editor, mark, parent, index)
              ? ""
              : typeof link.open === "string"
                ? link.open
                : link.open(state, mark, parent, index);
          },
          close(state, mark, parent, index) {
            return bareLink(this.editor, mark, parent, index - 1)
              ? ""
              : typeof link.close === "string"
                ? link.close
                : link.close(state, mark, parent, index);
          },
        },
      } satisfies MarkdownMarkSpec,
    };
  },
});
