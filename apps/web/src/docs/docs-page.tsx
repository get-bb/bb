import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useInitAnalytics } from "../landing/analytics";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import { CopyToast } from "../guides/guide-blocks";
import { docs } from "./content";
import { DocsSearch } from "./docs-search";
import type { DocsPageView, DocsTocEntry } from "./page-view";

const SITE = "https://getbb.app";

function DocsSidebar({ view }: { view: DocsPageView }) {
  return (
    <aside className="docs-sidebar">
      <DocsSearch />
      <nav aria-label="Docs">
        {view.nav.map((section) => (
          <div className="docs-nav-group" key={section.label}>
            <div className="docs-nav-label">{section.label}</div>
            {section.links.map((link) => (
              <a
                key={link.url}
                href={link.url}
                className={link.url === view.url ? "active" : undefined}
                aria-current={link.url === view.url ? "page" : undefined}
              >
                {link.title}
              </a>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function CopyPageMenu({ view }: { view: DocsPageView }) {
  const prompt = encodeURIComponent(
    `Read ${SITE}${view.markdownUrl} and answer questions about it.`,
  );
  return (
    <details className="docs-copy">
      <summary>Copy page</summary>
      <div className="docs-copy-menu">
        <a href={view.markdownUrl}>View as Markdown</a>
        <a href={`https://claude.ai/new?q=${prompt}`}>Open in Claude</a>
        <a href={`https://chatgpt.com/?q=${prompt}`}>Open in ChatGPT</a>
      </div>
    </details>
  );
}

function DocsToc({
  entries,
  editUrl,
}: {
  entries: DocsTocEntry[];
  editUrl: string;
}) {
  return (
    <nav className="docs-toc" aria-label="On this page">
      <div className="docs-toc-label">On this page</div>
      {entries.map((entry) => (
        <a key={entry.id} href={`#${entry.id}`}>
          {entry.title}
        </a>
      ))}
      <a className="docs-edit" href={editUrl}>
        Edit on GitHub
      </a>
    </nav>
  );
}

function headingText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(headingText).join("");
  return "";
}

function MdxBody({ contentPath }: { contentPath: string }) {
  const entry = docs.getPage(contentPath);
  if (!entry) {
    throw new Error(`Docs page ${contentPath} is not compiled`);
  }
  const Body = entry.body;
  return <Body components={{ pre: CodeBlock }} />;
}

function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
  return (
    <div className="gd-code">
      <div className="gd-code-bar">
        <span className="gd-code-label">Terminal</span>
      </div>
      <pre {...props}>{children}</pre>
    </div>
  );
}

function ReferenceBody({
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
        h2: ({ children }) => (
          <h2
            id={toc.find((entry) => entry.title === headingText(children))?.id}
          >
            {children}
          </h2>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}

export function DocsPage({ view }: { view: DocsPageView }) {
  useInitAnalytics();
  return (
    <CopyToast>
      <div className="wrap docs-wrap">
        <SiteNav />
        <div className="docs-shell">
          <DocsSidebar view={view} />
          <main className="docs-main">
            <div className="docs-eyebrow">{view.section}</div>
            <div className="docs-title-row">
              <h1>{view.title}</h1>
              <CopyPageMenu view={view} />
            </div>
            <p className="docs-lede">{view.description}</p>
            <article className="docs-body">
              {view.kind === "mdx" ? (
                <MdxBody contentPath={view.contentPath} />
              ) : (
                <ReferenceBody markdown={view.markdown} toc={view.toc} />
              )}
            </article>
          </main>
          <DocsToc entries={view.toc} editUrl={view.editUrl} />
        </div>
        <SiteFooter />
      </div>
    </CopyToast>
  );
}
