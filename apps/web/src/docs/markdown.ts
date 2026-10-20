import GithubSlugger from "github-slugger";
import type { Root, RootContent } from "mdast";
import { visit } from "unist-util-visit";
import type { DocMeta } from "./types";

function headingText(node: RootContent): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "image" || node.type === "imageReference")
    return node.alt ?? "";
  if ("children" in node) return node.children.map(headingText).join("");
  return "";
}

export function docHeadings(tree: Root): DocMeta["headings"] {
  const slugger = new GithubSlugger();
  const headings: DocMeta["headings"] = [];
  visit(tree, "heading", (node) => {
    if (node.depth !== 2 && node.depth !== 3) return;
    const text = headingText(node);
    const id = slugger.slug(text);
    node.data = {
      ...node.data,
      hProperties: { ...node.data?.hProperties, id },
    };
    headings.push({ id, text, depth: node.depth });
  });
  return headings;
}

export function remarkDocContent() {
  return (tree: Root) => {
    docHeadings(tree);
    visit(tree, (node) => {
      if (node.type !== "containerDirective" || node.name !== "note") return;
      node.data = {
        ...node.data,
        hName: "aside",
        hProperties: { className: ["docs-note"] },
      };
    });
  };
}
