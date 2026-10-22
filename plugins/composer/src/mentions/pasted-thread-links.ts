import type { Nodes } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import {
  findPastedThreadLinkCandidates,
  type PastedThreadLink,
  type ThreadLinkParser,
} from "./pasted-thread-link-candidates";

const markdownParser = unified().use(remarkParse).freeze();
const protectedNodeTypes = new Set<Nodes["type"]>([
  "blockquote",
  "code",
  "inlineCode",
  "link",
  "linkReference",
  "image",
  "imageReference",
  "definition",
  "html",
]);

export function findPastedThreadLinks({
  text,
  parseLink,
}: {
  text: string;
  parseLink: ThreadLinkParser;
}): PastedThreadLink[] {
  if (
    findPastedThreadLinkCandidates({
      text,
      parseLink,
      offset: 0,
      allowMarkdownSuffix: true,
    }).length === 0
  ) {
    return [];
  }

  const links: PastedThreadLink[] = [];
  const collect = (node: Nodes): void => {
    if (protectedNodeTypes.has(node.type)) return;
    if (node.type === "text") {
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (from !== undefined && to !== undefined) {
        links.push(
          ...findPastedThreadLinkCandidates({
            text: text.slice(from, to),
            parseLink,
            offset: from,
            allowMarkdownSuffix: false,
          }),
        );
      }
    } else if ("children" in node) {
      for (const child of node.children) collect(child);
    }
  };
  collect(markdownParser.parse(text));
  return links;
}
