import Menu01Icon from "@hugeicons/core-free-icons/Menu01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { Suspense, useEffect, useRef } from "react";
import { AnchorProvider, TOCItem, type TOCItemType } from "fumadocs-core/toc";

import { useInitAnalytics } from "../landing/analytics";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import { CopyToast } from "../guides/guide-blocks";
import { docs } from "./content";
import { DocsH2, DocsH3, DocsPageUrl } from "./docs-headings";
import { DocsSearch } from "./docs-search";
import type { DocsNavSection, DocsPageView, DocsTocEntry } from "./page-view";

function DocsNav({ view }: { view: DocsPageView }) {
  return (
    <nav aria-label="Docs" className="docs-nav">
      {view.nav.map((section: DocsNavSection) => (
        <div className="docs-nav-group" key={section.label}>
          <div className="docs-nav-label">{section.label}</div>
          {section.links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              className={link.active ? "active" : undefined}
              aria-current={link.active ? "page" : undefined}
            >
              {link.title}
            </a>
          ))}
        </div>
      ))}
      <div className="docs-nav-group">
        <div className="docs-nav-label">{view.community.label}</div>
        {view.community.links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.title}
            <span className="docs-nav-external" aria-hidden>
              ↗
            </span>
          </a>
        ))}
      </div>
    </nav>
  );
}

function useDismissableDetails() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !ref.current?.contains(event.target)
      ) {
        ref.current?.removeAttribute("open");
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.removeAttribute("open");
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  return ref;
}

function MobileNav({ view }: { view: DocsPageView }) {
  const ref = useDismissableDetails();
  return (
    <details className="docs-mobile-nav" ref={ref}>
      <summary>
        <HugeiconsIcon icon={Menu01Icon} className="docs-ic" aria-hidden />
        <span className="docs-mobile-nav-section">{view.section}</span>
      </summary>
      <div className="docs-mobile-nav-panel">
        <DocsNav view={view} />
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
        <TOCItem key={entry.id} href={`#${entry.id}`} data-depth={entry.depth}>
          {entry.title}
        </TOCItem>
      ))}
      <a className="docs-edit" href={editUrl}>
        Edit on GitHub
      </a>
    </nav>
  );
}

function MdxBody({ contentPath }: { contentPath: string }) {
  const entry = docs.getPage(contentPath);
  if (!entry) {
    throw new Error(`Docs page ${contentPath} is not compiled`);
  }
  const Body = entry.body;
  return (
    <Body
      components={{
        h2: DocsH2,
        h3: DocsH3,
      }}
    />
  );
}

function tocItems(entries: DocsTocEntry[]): TOCItemType[] {
  return entries.map((entry) => ({
    title: entry.title,
    url: `#${entry.id}`,
    depth: entry.depth,
  }));
}

export function DocsPage({ view }: { view: DocsPageView }) {
  useInitAnalytics();
  return (
    <CopyToast>
      <DocsPageUrl.Provider value={view.url}>
        <AnchorProvider toc={tocItems(view.toc)} single>
          <div className="wrap docs-wrap">
            <SiteNav />
            <div className="docs-bar">
              <a className="docs-bar-title" href="/docs">
                Docs
              </a>
              <MobileNav view={view} />
              <DocsSearch />
            </div>
            <div className="docs-shell">
              <aside className="docs-sidebar">
                <DocsNav view={view} />
              </aside>
              <main className="docs-main">
                <div className="docs-eyebrow">
                  {view.section}
                  {view.unreleased ? (
                    <span className="docs-badge">Unreleased</span>
                  ) : null}
                </div>
                <div className="docs-title-row">
                  <h1>{view.title}</h1>
                </div>
                <p className="docs-lede">{view.description}</p>
                <article className="docs-body">
                  <Suspense fallback={null}>
                    <MdxBody contentPath={view.contentPath} />
                  </Suspense>
                </article>
              </main>
              <DocsToc entries={view.toc} editUrl={view.editUrl} />
            </div>
            <SiteFooter />
          </div>
        </AnchorProvider>
      </DocsPageUrl.Provider>
    </CopyToast>
  );
}
