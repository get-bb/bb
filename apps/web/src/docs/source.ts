import { loader } from "fumadocs-core/source";

import { docs } from "./content";

export const DOCS_BASE = "/docs";

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: DOCS_BASE,
});

export type DocsPage = (typeof source)["$inferPage"];

export function docsPaths(): string[] {
  return source.getPages().map((page) => page.url);
}
