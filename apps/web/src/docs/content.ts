import { pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";

import { docsFrontmatterFields } from "./page-types";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema.extend(docsFrontmatterFields),
    postprocess: { includeProcessedMarkdown: true },
  },
});
