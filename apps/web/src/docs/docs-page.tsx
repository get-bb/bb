import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Book02Icon from "@hugeicons/core-free-icons/Book02Icon";
import BotIcon from "@hugeicons/core-free-icons/BotIcon";
import BubbleChatAddIcon from "@hugeicons/core-free-icons/BubbleChatAddIcon";
import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon";
import BulbIcon from "@hugeicons/core-free-icons/BulbIcon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import FolderGit2Icon from "@hugeicons/core-free-icons/FolderGit2Icon";
import HelpCircleIcon from "@hugeicons/core-free-icons/HelpCircleIcon";
import LaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
import Menu01Icon from "@hugeicons/core-free-icons/Menu01Icon";
import Plug02Icon from "@hugeicons/core-free-icons/Plug02Icon";
import RepeatIcon from "@hugeicons/core-free-icons/RepeatIcon";
import Rocket01Icon from "@hugeicons/core-free-icons/Rocket01Icon";
import SlidersHorizontalIcon from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import UserMultiple02Icon from "@hugeicons/core-free-icons/UserMultiple02Icon";
import ZapIcon from "@hugeicons/core-free-icons/ZapIcon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Suspense, useEffect, useRef } from "react";
import { AnchorProvider, TOCItem, type TOCItemType } from "fumadocs-core/toc";

import { useInitAnalytics } from "../landing/analytics";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import { CopyToast, PROMPT_COPIED, useCopy } from "../guides/guide-blocks";
import { docs } from "./content";
import {
  Callout,
  CalloutDescription,
  CalloutTitle,
  CodeBlock,
  Tab,
  Tabs,
} from "./docs-blocks";
import { DocsH2, DocsH3, DocsPageUrl } from "./docs-headings";
import { DocsSearch } from "./docs-search";
import { ReferenceBody, TableWrap } from "./reference-body";
import type { DocsNavIcon } from "./nav";
import type { DocsNavSection, DocsPageView, DocsTocEntry } from "./page-view";
import { Screenshot, Shot } from "./shot";

const SITE = "https://getbb.app";

const NAV_ICONS: Record<DocsNavIcon, IconSvgElement> = {
  "get-started": Rocket01Icon,
  concepts: BulbIcon,
  threads: BubbleChatAddIcon,
  "child-threads": UserMultiple02Icon,
  automations: RepeatIcon,
  agents: BotIcon,
  skills: ZapIcon,
  projects: FolderGit2Icon,
  machines: LaptopIcon,
  mobile: SmartPhone01Icon,
  plugins: Plug02Icon,
  customization: SlidersHorizontalIcon,
  reference: Book02Icon,
  troubleshooting: HelpCircleIcon,
  community: BubbleChatIcon,
};

function NavLabel({ icon, label }: { icon: DocsNavIcon; label: string }) {
  return (
    <div className="docs-nav-label">
      <HugeiconsIcon icon={NAV_ICONS[icon]} className="docs-ic" aria-hidden />
      {label}
    </div>
  );
}

function DocsNav({ view }: { view: DocsPageView }) {
  return (
    <nav aria-label="Docs" className="docs-nav">
      {view.nav.map((section: DocsNavSection) => (
        <div className="docs-nav-group" key={section.label}>
          <NavLabel icon={section.icon} label={section.label} />
          {section.links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              title={link.navLabel === link.title ? undefined : link.title}
              className={link.active ? "active" : undefined}
              aria-current={link.active ? "page" : undefined}
            >
              {link.navLabel}
            </a>
          ))}
        </div>
      ))}
      <div className="docs-nav-group">
        <NavLabel icon={view.community.icon} label={view.community.label} />
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
        pre: CodeBlock,
        table: TableWrap,
        h2: DocsH2,
        h3: DocsH3,
        Shot,
        Screenshot,
        Tabs,
        Tab,
        Callout,
        CalloutTitle,
        CalloutDescription,
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
          <div className="docs-wrap">
            <div className="wrap docs-chrome">
              <SiteNav />
            </div>
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
                <article
                  className="docs-body"
                  data-layout={
                    view.kind === "reference" ? view.layout : undefined
                  }
                >
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
            <div className="wrap docs-chrome">
              <SiteFooter />
            </div>
          </div>
        </AnchorProvider>
      </DocsPageUrl.Provider>
    </CopyToast>
  );
}
