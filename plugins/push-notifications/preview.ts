import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

function textContent(node: Nodes): string {
  switch (node.type) {
    case "definition":
    case "footnoteDefinition":
      return "";
    case "break":
      return "\n";
    case "image":
    case "imageReference":
      return node.alt ?? "";
    case "tableRow":
      return node.children.map(textContent).join(" · ");
    case "listItem": {
      const prefix =
        node.checked === true ? "☑ " : node.checked === false ? "☐ " : "";
      return prefix + node.children.map(textContent).join("\n");
    }
  }
  if ("value" in node) return node.value;
  if ("children" in node) {
    const separator =
      node.type === "root" ||
      node.type === "blockquote" ||
      node.type === "list" ||
      node.type === "table"
        ? "\n"
        : "";
    return node.children.map(textContent).join(separator);
  }
  return "";
}

export function markdownPreview(markdown: string): string {
  const text = textContent(
    fromMarkdown(markdown, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }),
  );
  return (
    text
      .split(/\r?\n/u)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ""
  );
}
