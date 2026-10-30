import { DOCS_NAV, DOCS_NAV_FOOTER_LINKS, navSectionOf } from "./nav";
import {
  DOCS_BASE,
  docsLlms,
  markdownPath,
  source,
  type DocsPage,
} from "./source";

const REPO_BLOB = "https://github.com/get-bb/bb/blob/main";

interface DocsNavLink {
  title: string;
  url: string;
  active: boolean;
}

export interface DocsNavSection {
  label: string;
  links: DocsNavLink[];
}

export interface DocsTocEntry {
  id: string;
  title: string;
}

interface DocsPageViewBase {
  url: string;
  title: string;
  description: string;
  section: string;
  unreleased: boolean;
  markdownUrl: string;
  pageMarkdown: string;
  editUrl: string;
  nav: DocsNavSection[];
  footerLinks: { title: string; href: string }[];
  toc: DocsTocEntry[];
}

export type DocsPageView = DocsPageViewBase & { contentPath: string };

function pageUrl(slug: string): string {
  return slug === "" ? DOCS_BASE : `${DOCS_BASE}/${slug}`;
}

function isActive(slug: string, currentSlug: string): boolean {
  return currentSlug === slug || currentSlug.startsWith(`${slug}/`);
}

function docsNav(currentSlug: string | null): DocsNavSection[] {
  const existing = new Set(source.getPages().map((page) => page.url));
  return DOCS_NAV.flatMap((section) => {
    const links = section.pages
      .filter((page) => existing.has(pageUrl(page.slug)))
      .map((page) => ({
        title: page.title,
        url: pageUrl(page.slug),
        active:
          currentSlug !== null &&
          (page.slug === ""
            ? currentSlug === ""
            : isActive(page.slug, currentSlug)),
      }));
    return links.length === 0 ? [] : [{ label: section.label, links }];
  });
}

async function viewOf(page: DocsPage): Promise<DocsPageView> {
  const slug = page.slugs.join("/");
  const section = navSectionOf(slug);
  if (section === null) {
    throw new Error(`Docs page ${page.url} is not in the docs sidebar`);
  }
  return {
    url: page.url,
    title: page.data.title,
    description: page.data.description,
    section,
    unreleased: page.data.since === "unreleased",
    markdownUrl: markdownPath(page),
    pageMarkdown: await docsLlms.page(page),
    editUrl: `${REPO_BLOB}/apps/web/content/docs/${page.path}`,
    nav: docsNav(slug),
    footerLinks: [...DOCS_NAV_FOOTER_LINKS],
    toc: (await page.data.structuredData()).headings.map((heading) => ({
      id: heading.id,
      title: heading.content,
    })),
    contentPath: page.path,
  };
}

export async function docsPageView(
  splat: string,
): Promise<DocsPageView | null> {
  const page = source.getPage(splat.split("/").filter(Boolean));
  return page ? viewOf(page) : null;
}
