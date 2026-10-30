import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins/rehype-code";
import { pageSchema } from "fumadocs-core/source/schema";
import { applyMdxPreset } from "fumadocs-mdx/config";
import { defineDocs } from "fumadocs-mdx/macro";

import { docsFrontmatterFields } from "./page-types";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    async: true,
    schema: pageSchema.extend(docsFrontmatterFields),
    postprocess: { includeProcessedMarkdown: true },
    mdxOptions: applyMdxPreset({
      rehypeCodeOptions: {
        ...rehypeCodeDefaultOptions,
        addLanguageClass: true,
      },
      remarkCodeTabOptions: { Tabs: "Tabs" },
    }),
  },
});
