import type { ComponentProps } from "react";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

import { DocsH2, DocsH3, headingText } from "./docs-headings";
import { headingId } from "./heading-id";
import type { DocsTocEntry } from "./page-view";

export function TableWrap(props: ComponentProps<"table">) {
  return (
    <div className="docs-table">
      <table {...props} />
    </div>
  );
}

type HastNode = NonNullable<ExtraProps["node"]>["children"][number];

function meaningful(nodes: readonly HastNode[]): HastNode[] {
  return nodes.filter(
    (node) => !(node.type === "text" && node.value.trim() === ""),
  );
}

function isCodeOnlyList(node: ExtraProps["node"]): boolean {
  const items = meaningful(node?.children ?? []);
  return (
    items.length > 0 &&
    items.every((item) => {
      if (item.type !== "element" || item.tagName !== "li") return false;
      const [only, ...rest] = meaningful(item.children);
      return (
        rest.length === 0 && only?.type === "element" && only.tagName === "code"
      );
    })
  );
}

export function ReferenceBody({
  markdown,
  toc,
}: {
  markdown: string;
  toc: DocsTocEntry[];
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: ({ node: _node, children, ...props }) => {
          const text = headingText(children);
          return (
            <DocsH2
              {...props}
              id={
                toc.find((entry) => entry.title === text)?.id ?? headingId(text)
              }
            >
              {children}
            </DocsH2>
          );
        },
        h3: ({ node: _node, children, ...props }) => (
          <DocsH3 {...props} id={headingId(headingText(children))}>
            {children}
          </DocsH3>
        ),
        table: ({ node: _node, ...props }) => <TableWrap {...props} />,
        ul: ({ node, ...props }) => (
          <ul
            {...props}
            className={isCodeOnlyList(node) ? "docs-code-list" : undefined}
          />
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
