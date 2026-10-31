import { createFromSource } from "fumadocs-core/search/server";

import { navSectionOf } from "./nav";
import { pageStructuredData } from "./page-view";
import { source } from "./source";

export const docsSearch = createFromSource(source, {
  language: "english",
  buildIndex: async (page) => {
    const section = navSectionOf(page.slugs.join("/"));
    return {
      id: page.url,
      url: page.url,
      title: page.data.title,
      description: page.data.description,
      breadcrumbs: section === null ? [] : [section],
      structuredData: await pageStructuredData(page),
    };
  },
});
