import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
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
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
