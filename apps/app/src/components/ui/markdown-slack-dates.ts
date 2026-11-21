import type { Root } from "mdast";
import { SKIP, visit } from "unist-util-visit";

export function remarkSlackDates() {
  return (tree: Root) => {
    visit(tree, "html", (node, index, parent) => {
      const fallback = /^<!date\^-?\d+\^[^|<>\r\n]+\|([^<>\r\n]+)>$/.exec(
        node.value,
      )?.[1];
      if (
        fallback === undefined ||
        index === undefined ||
        parent === undefined
      ) {
        return;
      }
      parent.children[index] = { type: "text", value: fallback };
      return SKIP;
    });
  };
}
