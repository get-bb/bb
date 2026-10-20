import type { ReactNode } from "react";

import { SiteFooter, SiteNav } from "../landing/site-chrome";
import { DOCS, DOC_SECTIONS } from "./docs";
import type { DocMeta } from "./types";

function SectionLinks({ currentPath }: { currentPath: string }) {
  return (
    <nav aria-label="Documentation">
      <a
        className="docs-index-link"
        href="/docs"
        aria-current={currentPath === "/docs" ? "page" : undefined}
      >
        Docs
      </a>
      {DOC_SECTIONS.map((section) => {
        const pages = DOCS.filter((doc) => doc.section === section.id);
        if (pages.length === 0) return null;
        return (
          <div className="docs-nav-group" key={section.id}>
            <p className="docs-nav-label">{section.title}</p>
            <ul>
              {pages.map((doc) => (
                <li key={doc.slug}>
                  <a
                    href={doc.path}
                    aria-current={currentPath === doc.path ? "page" : undefined}
                  >
                    {doc.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function PageContents({ headings }: { headings: DocMeta["headings"] }) {
  if (headings.length < 3) return null;
  return (
    <nav className="docs-page-contents" aria-label="On this page">
      <p className="docs-nav-label">On this page</p>
      <ul>
        {headings.map((heading) => (
          <li
            className={heading.depth === 3 ? "docs-subheading" : undefined}
            key={heading.id}
          >
            <a href={`#${heading.id}`}>{heading.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function DocsLayout({
  currentPath,
  headings = [],
  children,
}: {
  currentPath: string;
  headings?: DocMeta["headings"];
  children: ReactNode;
}) {
  return (
    <div className="wrap docs-page">
      <a className="docs-skip" href="#docs-content">
        Skip to content
      </a>
      <SiteNav current="docs" path={currentPath} />
      <div className="docs-layout">
        <aside className="docs-sidebar">
          <SectionLinks currentPath={currentPath} />
          <PageContents headings={headings} />
        </aside>
        <details className="docs-compact-contents">
          <summary>Contents</summary>
          <div className="docs-compact-links">
            <SectionLinks currentPath={currentPath} />
            <PageContents headings={headings} />
          </div>
        </details>
        <main className="docs-content" id="docs-content" tabIndex={-1}>
          {children}
        </main>
      </div>
      <SiteFooter current={currentPath} />
    </div>
  );
}
