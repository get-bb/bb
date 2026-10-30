import { markdownPath, source, type DocsPage } from "./source";

const REPO_BLOB = "https://github.com/get-bb/bb/blob/main";

export interface DocsNavLink {
  title: string;
  url: string;
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
  markdownUrl: string;
  editUrl: string;
  nav: DocsNavSection[];
  toc: DocsTocEntry[];
}

export type DocsPageView =
  | (DocsPageViewBase & { kind: "mdx"; contentPath: string })
  | (DocsPageViewBase & { kind: "reference"; markdown: string });

function docsNav(): DocsNavSection[] {
  const sections: DocsNavSection[] = [];
  for (const page of source.getPages()) {
    const label = page.data.section;
    const link = { title: page.data.title, url: page.url };
    const existing = sections.find((section) => section.label === label);
    if (existing) {
      existing.links.push(link);
    } else {
      sections.push({ label, links: [link] });
    }
  }
  return sections;
}

function slugsFromSplat(splat: string): string[] {
  return splat.split("/").filter(Boolean);
}

function viewOf(page: DocsPage): DocsPageView {
  const base = {
    url: page.url,
    title: page.data.title,
    description: page.data.description,
    section: page.data.section,
    markdownUrl: markdownPath(page),
    nav: docsNav(),
    toc: page.data.structuredData.headings.map((heading) => ({
      id: heading.id,
      title: heading.content,
    })),
  };
  if (page.type === "reference") {
    return {
      ...base,
      kind: "reference",
      editUrl: `${REPO_BLOB}/plugins/plugin-api-docs/src/surfaces.ts`,
      markdown: page.data.markdown,
    };
  }
  return {
    ...base,
    kind: "mdx",
    contentPath: page.path,
    editUrl: `${REPO_BLOB}/apps/web/content/docs/${page.path}`,
  };
}

export function docsPageView(splat: string): DocsPageView | null {
  const page = source.getPage(slugsFromSplat(splat));
  return page ? viewOf(page) : null;
}
