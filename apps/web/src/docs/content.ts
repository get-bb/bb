import { pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";
import { z } from "zod";

import { docsMdxOptions } from "./mdx-options";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    async: true,
    schema: pageSchema.extend({
      description: z.string().min(1),
      since: z.string().min(1),
    }),
    postprocess: { includeProcessedMarkdown: true },
    mdxOptions: docsMdxOptions,
  },
});
