import MarkdownIt from "markdown-it";
import { parseMarkdownDocument } from "./markdown-document.js";
import { HTML_EMBED_BLOCK, renderedTags } from "./html-tags.js";
import type { VisibleDocument } from "./comments.js";

const parser = new MarkdownIt({ html: true, linkify: true });
type Block = { text: string; changes: [offset: number, line: number][] };

function lineChanges(text: string, line: number): Block["changes"] {
  const changes: Block["changes"] = [[0, line]];
  for (
    let index = text.indexOf("\n");
    index >= 0;
    index = text.indexOf("\n", index + 1)
  )
    changes.push([index + 1, ++line]);
  return changes;
}

export function visibleMarkdown(content: string): VisibleDocument {
  const { body, frontmatter } = parseMarkdownDocument(content);
  const offset = (frontmatter.match(/\n/g) ?? []).length;
  const blocks: Block[] = [];
  let sourceLine = 0;
  let listItems = 0;
  let itemStart = false;
  for (const token of parser.parse(body, {})) {
    if (token.map) sourceLine = token.map[0];
    const line = offset + sourceLine + 1;
    if (token.type === "list_item_open") {
      listItems++;
      itemStart = true;
      continue;
    }
    if (token.type === "list_item_close") listItems--;
    if (token.type === "inline") {
      const children = token.children ?? [];
      const rendered = renderedTags(children);
      const parts: string[] = [];
      let length = 0;
      let current = line;
      const changes: Block["changes"] = [[0, line]];
      const add = (value: string) => {
        for (
          let index = value.indexOf("\n");
          index >= 0;
          index = value.indexOf("\n", index + 1)
        )
          changes.push([length + index + 1, ++current]);
        parts.push(value);
        length += value.length;
      };
      children.forEach((child, position) => {
        if (["text", "code_inline"].includes(child.type)) add(child.content);
        else if (child.type === "image") add("\ufffc");
        else if (child.type === "softbreak") {
          add(" ");
          changes.push([length, ++current]);
        } else if (child.type === "hardbreak") add("\n");
        else if (child.type === "html_inline")
          add(
            rendered.has(position)
              ? /^<br/i.test(child.content)
                ? "\n"
                : ""
              : child.content,
          );
      });
      let text = parts.join("");
      if (listItems && itemStart && /^\[[ xX]\] /.test(text)) {
        text = text.slice(4);
        for (const change of changes) change[0] = Math.max(0, change[0] - 4);
      }
      itemStart = false;
      blocks.push(
        /^::html\{/.test(text)
          ? { text: "\ufffc", changes: [[0, line]] }
          : { text, changes },
      );
    } else if (token.type === "fence" || token.type === "code_block") {
      const text = token.content.replace(/\n$/, "");
      blocks.push({
        text,
        changes: lineChanges(text, line + (token.type === "fence" ? 1 : 0)),
      });
    } else if (token.type === "html_block") {
      const text = HTML_EMBED_BLOCK.test(token.content)
        ? "\ufffc"
        : token.content.replace(/\n$/, "");
      blocks.push({ text, changes: lineChanges(text, line) });
      itemStart = false;
    } else if (token.type === "hr")
      blocks.push({ text: "\ufffc", changes: [[0, line]] });
  }
  const text = blocks.map((block) => block.text).join("\n\n");
  const lines = new Int32Array(text.length);
  let position = 0;
  blocks.forEach((block, index) => {
    if (index) {
      lines.fill(block.changes[0]![1], position, position + 2);
      position += 2;
    }
    block.changes.forEach(([from, line], change) => {
      const to = block.changes[change + 1]?.[0] ?? block.text.length;
      if (to > from) lines.fill(line, position + from, position + to);
    });
    position += block.text.length;
  });
  return { text, lines };
}
