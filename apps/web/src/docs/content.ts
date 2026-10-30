import { pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";

import { docsFrontmatterFields } from "./page-types";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    async: true,
    schema: pageSchema.extend(docsFrontmatterFields),
    postprocess: { includeProcessedMarkdown: true },
  },
});
