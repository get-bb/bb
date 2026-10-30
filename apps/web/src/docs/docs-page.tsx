import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Menu01Icon from "@hugeicons/core-free-icons/Menu01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Suspense,
  useEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useInitAnalytics } from "../landing/analytics";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import { CopyToast, PROMPT_COPIED, useCopy } from "../guides/guide-blocks";
import { docs } from "./content";
import { DocsSearch } from "./docs-search";
import type { DocsNavSection, DocsPageView, DocsTocEntry } from "./page-view";

const SITE = "https://getbb.app";

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
      <div className="docs-nav-group docs-nav-footer">
        {view.footerLinks.map((link) => (
          <a key={link.href} href={link.href}>
            {link.title}
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
        {view.section}
      </summary>
      <div className="docs-mobile-nav-panel">
        <DocsNav view={view} />
      </div>
    </details>
  );
}

function CopyPageMenu({ view }: { view: DocsPageView }) {
  const ref = useDismissableDetails();
  const pageUrl = `${SITE}${view.markdownUrl}`;
  const prompt = `Read ${pageUrl} and help me with it.`;
  const aiPrompt = encodeURIComponent(
    `Read ${pageUrl} and answer questions about it.`,
  );
  const markdown = useCopy(view.pageMarkdown, "Page copied as Markdown");
  const openInBb = useCopy(prompt, PROMPT_COPIED);
  const close = () => ref.current?.removeAttribute("open");
  return (
    <div className="docs-copy">
      <button
        type="button"
        className="docs-copy-main"
        onClick={() => void markdown.copy()}
      >
        <HugeiconsIcon icon={Copy01Icon} className="docs-ic" aria-hidden />
        {markdown.copied ? "Copied" : "Copy page"}
      </button>
      <details ref={ref} className="docs-copy-more">
        <summary aria-label="More ways to use this page">
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="docs-ic"
            aria-hidden
          />
        </summary>
        <div className="docs-copy-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              void openInBb.copy();
            }}
          >
            <span>Open in bb</span>
            <small>Copy a prompt for a bb thread</small>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              void markdown.copy();
            }}
          >
            <span>Copy as Markdown</span>
            <small>For pasting into any agent</small>
          </button>
          <a role="menuitem" href={view.markdownUrl}>
            <span>View as Markdown</span>
            <small>Open this page as plain text</small>
          </a>
          <a
            role="menuitem"
            href={`https://claude.ai/new?q=${aiPrompt}`}
            target="_blank"
            rel="noreferrer"
          >
            <span>Open in Claude</span>
            <small>Ask Claude about this page</small>
          </a>
          <a
            role="menuitem"
            href={`https://chatgpt.com/?q=${aiPrompt}`}
            target="_blank"
            rel="noreferrer"
          >
            <span>Open in ChatGPT</span>
            <small>Ask ChatGPT about this page</small>
          </a>
        </div>
      </details>
    </div>
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

function TableWrap(props: ComponentProps<"table">) {
  return (
    <div className="docs-table">
      <table {...props} />
    </div>
  );
}

function MdxBody({ contentPath }: { contentPath: string }) {
  const entry = docs.getPage(contentPath);
  if (!entry) {
    throw new Error(`Docs page ${contentPath} is not compiled`);
  }
  const Body = entry.body;
  return <Body components={{ pre: CodeBlock, table: TableWrap }} />;
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
        table: ({ node: _node, ...props }) => <TableWrap {...props} />,
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
              <CopyPageMenu view={view} />
            </div>
            <p className="docs-lede">{view.description}</p>
            <article className="docs-body">
              {view.kind === "mdx" ? (
                <Suspense fallback={null}>
                  <MdxBody contentPath={view.contentPath} />
                </Suspense>
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
