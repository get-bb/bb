import ReactMarkdown from "react-markdown";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";

import { remarkDocContent } from "./markdown";

export function DocBody({ body }: { body: string }) {
  return (
    <div className="docs-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkDocContent]}
        components={{
          h2: ({ id, children }) => (
            <h2 id={id}>
              {children}
              <a
                className="docs-heading-link"
                href={`#${id}`}
                aria-label="Link to this section"
              >
                #
              </a>
            </h2>
          ),
          h3: ({ id, children }) => (
            <h3 id={id}>
              {children}
              <a
                className="docs-heading-link"
                href={`#${id}`}
                aria-label="Link to this section"
              >
                #
              </a>
            </h3>
          ),
          blockquote: ({ children }) => (
            <blockquote className="docs-agent-prompt">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div
              className="docs-table-scroll"
              role="region"
              aria-label="Table"
              tabIndex={0}
            >
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
