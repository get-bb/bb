import { remarkDirectiveAdmonition } from "fumadocs-core/mdx-plugins/remark-directive-admonition";
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins/rehype-code";
import { applyMdxPreset } from "fumadocs-mdx/config";
import remarkDirective from "remark-directive";

import {
  CALLOUT_TONES,
  remarkDocsMarkdown,
  remarkRestoreTextDirectives,
} from "./remark-docs";

const calloutTypes = Object.fromEntries(
  Object.keys(CALLOUT_TONES).map((tone) => [tone, tone]),
);

export const docsMdxOptions = applyMdxPreset({
  rehypeCodeOptions: {
    ...rehypeCodeDefaultOptions,
    addLanguageClass: true,
  },
  remarkCodeTabOptions: { Tabs: "Tabs" },
  remarkPlugins: [
    remarkDirective,
    remarkDocsMarkdown,
    [
      remarkDirectiveAdmonition,
      {
        tags: {
          CalloutContainer: "Callout",
          CalloutTitle: "CalloutTitle",
          CalloutDescription: "CalloutDescription",
        },
        types: calloutTypes,
      },
    ],
    remarkRestoreTextDirectives,
  ],
});
