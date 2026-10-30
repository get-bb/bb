import { serveDocsOg, type DocsOgCard } from "./docs-og";
import { navSectionOf } from "./nav";
import { slugsFromOgPath } from "./docs-og-paths";
import { source } from "./source";

export function docsOgCardFor(splat: string): DocsOgCard | null {
  const slugs = slugsFromOgPath(splat);
  if (slugs === null) return null;
  const page = source.getPage(slugs);
  if (!page) return null;
  const section = navSectionOf(page.slugs.join("/"));
  return section === null ? null : { section, title: page.data.title };
}

export function docsOgResponse(splat: string): Promise<Response> {
  return serveDocsOg(docsOgCardFor(splat));
}
