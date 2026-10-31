import { z } from "zod";

export const DOCS_SEARCH_INDEX_FILE = "search-index.v1.json";

const docsSearchIndexSectionSchema = z.object({
  heading: z.string().nullable(),
  anchor: z.string().nullable(),
  text: z.string(),
});

const docsSearchIndexPageSchema = z.object({
  title: z.string().min(1),
  url: z.string().startsWith("/"),
  description: z.string(),
  sections: z.array(docsSearchIndexSectionSchema),
});

export const docsSearchIndexSchema = z.object({
  version: z.literal(1),
  pages: z.array(docsSearchIndexPageSchema),
});

export type DocsSearchIndex = z.infer<typeof docsSearchIndexSchema>;
export type DocsSearchIndexSection = z.infer<
  typeof docsSearchIndexSectionSchema
>;
