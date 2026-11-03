import type {
  DocsSearchIndex,
  DocsSearchIndexSection,
} from "@bb/domain/docs-search-index";
import type { StructuredData } from "fumadocs-core/mdx-plugins/remark-structure";

import { pageStructuredData } from "./page-view";
import { source } from "./source";

function pageSections(data: StructuredData): DocsSearchIndexSection[] {
  const sections = new Map<string | null, DocsSearchIndexSection>([
    [null, { heading: null, anchor: null, text: "" }],
  ]);
  for (const heading of data.headings) {
    sections.set(heading.id, {
      heading: heading.content,
      anchor: heading.id,
      text: "",
    });
  }
  for (const content of data.contents) {
    const section = sections.get(content.heading ?? null) ?? sections.get(null);
    if (section === undefined) continue;
    section.text =
      section.text.length === 0
        ? content.content
        : `${section.text}\n${content.content}`;
  }
  return [...sections.values()].filter(
    (section) => section.heading !== null || section.text.length > 0,
  );
}

export async function docsSearchIndexFromSource(): Promise<DocsSearchIndex> {
  const pages = await Promise.all(
    source.getPages().map(async (page) => ({
      title: page.data.title,
      url: page.url,
      description: page.data.description,
      sections: pageSections(await pageStructuredData(page)),
    })),
  );
  return { version: 1, pages };
}
