import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { visit } from "unist-util-visit";
import type { UrlTransform } from "react-markdown";

const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath, { singleDollarTextMath: false });

export function collectMarkdownImages(
  content: string,
  transform: UrlTransform,
) {
  const tree = parser.parse(content);
  const definitions = new Map<string, string>();
  visit(tree, "definition", (node) => {
    const key = node.identifier.toUpperCase();
    if (!definitions.has(key)) definitions.set(key, node.url);
  });
  const images: { src: string; alt: string }[] = [];
  visit(tree, (node) => {
    const url =
      node.type === "image"
        ? node.url
        : node.type === "imageReference"
          ? definitions.get(node.identifier.toUpperCase())
          : undefined;
    if (url === undefined) return;
    const src = transform(url, "src", {
      type: "element",
      tagName: "img",
      properties: { src: url },
      children: [],
    });
    if (!src) return;
    images.push({
      src,
      alt: "alt" in node ? (node.alt ?? "Image") : "Image",
    });
  });
  return images;
}
