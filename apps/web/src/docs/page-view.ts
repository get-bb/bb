import { DOCS_NAV, DOCS_NAV_COMMUNITY, navSectionOf } from "./nav";
import { DOCS_BASE, source, type DocsPage } from "./source";

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
  depth: number;
}

interface DocsBreadcrumb {
  name: string;
  url: string;
}

export interface DocsPageView {
  url: string;
  title: string;
  description: string;
  section: string;
  unreleased: boolean;
  editUrl: string;
  nav: DocsNavSection[];
  community: { label: string; links: { title: string; href: string }[] };
  toc: DocsTocEntry[];
  breadcrumbs: DocsBreadcrumb[];
  contentPath: string;
}

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

export const TOC_MAX_DEPTH = 3;

async function pageStructuredData(page: DocsPage) {
  return await page.data.structuredData();
}

async function headingDepths(page: DocsPage): Promise<Map<string, number>> {
  const { toc } = await page.data.load();
  return new Map(toc.map((item) => [item.url.replace(/^#/u, ""), item.depth]));
}

export async function docsToc(page: DocsPage): Promise<DocsTocEntry[]> {
  const depths = await headingDepths(page);
  return (await pageStructuredData(page)).headings
    .map((heading) => ({
      id: heading.id,
      title: heading.content,
      depth: depths.get(heading.id) ?? 2,
    }))
    .filter((entry) => entry.depth <= TOC_MAX_DEPTH);
}

function breadcrumbsOf(
  page: DocsPage,
  section: string,
  nav: DocsNavSection[],
): DocsBreadcrumb[] {
  const root = { name: "Docs", url: DOCS_BASE };
  if (page.url === DOCS_BASE) return [root];
  const sectionStart = nav.find((group) => group.label === section)?.links[0];
  return [
    root,
    ...(sectionStart && sectionStart.url !== page.url
      ? [{ name: section, url: sectionStart.url }]
      : []),
    { name: page.data.title, url: page.url },
  ];
}

async function viewOf(page: DocsPage): Promise<DocsPageView> {
  const slug = page.slugs.join("/");
  const section = navSectionOf(slug);
  if (section === null) {
    throw new Error(`Docs page ${page.url} is not in the docs sidebar`);
  }
  const nav = docsNav(slug);
  return {
    url: page.url,
    title: page.data.title,
    description: page.data.description,
    section,
    unreleased: page.data.since === "unreleased",
    editUrl: `${REPO_BLOB}/apps/web/content/docs/${page.path}`,
    nav,
    community: {
      label: DOCS_NAV_COMMUNITY.label,
      links: [...DOCS_NAV_COMMUNITY.links],
    },
    toc: await docsToc(page),
    breadcrumbs: breadcrumbsOf(page, section, nav),
    contentPath: page.path,
  };
}

export async function docsPageView(
  splat: string,
): Promise<DocsPageView | null> {
  const page = source.getPage(splat.split("/").filter(Boolean));
  return page ? viewOf(page) : null;
}
