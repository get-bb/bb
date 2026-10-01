import { useMemo } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

type MarkdownRehypePlugins = NonNullable<Options["rehypePlugins"]>;

const MARKDOWN_HTML_REHYPE_PLUGINS: MarkdownRehypePlugins = [
  rehypeRaw,
  [
    rehypeSanitize,
    {
      ...defaultSchema,
      tagNames: [
        ...(defaultSchema.tagNames ?? []),
        "video",
        "bb-thread-mention",
        "bb-prompt-mention",
        "bb-message-directive",
      ],
      protocols: { ...defaultSchema.protocols, poster: ["http", "https"] },
      attributes: {
        ...defaultSchema.attributes,
        source: [
          ...(defaultSchema.attributes?.source ?? []),
          "src",
          "type",
          "media",
        ],
        video: [
          "src",
          "controls",
          "playsInline",
          "preload",
          "poster",
          "width",
          "height",
          "title",
          "ariaLabel",
        ],
        "bb-thread-mention": [
          "dataThreadId",
          "dataRawThreadId",
          "dataRawThreadInlineCode",
        ],
        "bb-prompt-mention": ["dataMentionIndex"],
        "bb-message-directive": ["dataDirectiveIndex"],
      },
    },
  ],
];

export function MarkdownHtml({ rehypePlugins, ...props }: Options) {
  const plugins = useMemo(
    () => [...MARKDOWN_HTML_REHYPE_PLUGINS, ...(rehypePlugins ?? [])],
    [rehypePlugins],
  );
  return <ReactMarkdown {...props} rehypePlugins={plugins} />;
}
