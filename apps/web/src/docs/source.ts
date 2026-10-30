import { llms, loader } from "fumadocs-core/source";

import { docs } from "./content";
import { referenceSource } from "./reference";

export const DOCS_BASE = "/docs";

export const source = loader({
  source: { mdx: docs.toFumadocsSource(), reference: referenceSource },
  baseUrl: DOCS_BASE,
});

export type DocsPage = (typeof source)["$inferPage"];

async function pageMarkdownBody(page: DocsPage): Promise<string> {
  if (page.type === "reference") {
    return page.data.markdown;
  }
  return page.data.getText("processed");
}

export const docsLlms = llms(source, {
  renderPage: async (page) =>
    `# ${page.data.title} (${page.url})\n\n${page.data.description}\n\n${await pageMarkdownBody(page)}`,
});

export function markdownPath(page: Pick<DocsPage, "slugs">): string {
  const slugs = page.slugs.length === 0 ? ["index"] : page.slugs;
  return `${DOCS_BASE}/${slugs.join("/")}.md`;
}

export function slugsFromMarkdownPath(splat: string): string[] {
  const slugs = splat.replace(/\.md$/u, "").split("/").filter(Boolean);
  return slugs.length === 1 && slugs[0] === "index" ? [] : slugs;
}

export function docsPaths(): string[] {
  return source.getPages().map((page) => page.url);
}
