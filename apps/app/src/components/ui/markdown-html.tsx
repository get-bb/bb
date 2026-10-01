import { useMemo } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import {
  EDITOR_FILE_URL_SCHEMES,
  resolveEditorFileUrl,
} from "@bb/desktop-contract";

type MarkdownRehypePlugins = NonNullable<Options["rehypePlugins"]>;

interface MarkdownHtmlNode {
  children?: MarkdownHtmlNode[];
  properties?: Record<string, unknown>;
  tagName?: string;
}

function canonicalizeEditorFileLinks(node: MarkdownHtmlNode): void {
  const href = node.properties?.href;
  if (node.tagName === "a" && node.properties && typeof href === "string") {
    node.properties.href = resolveEditorFileUrl(href) ?? href;
  }
  node.children?.forEach(canonicalizeEditorFileLinks);
}

function rehypeCanonicalEditorFileLinks() {
  return canonicalizeEditorFileLinks;
}

const MARKDOWN_HTML_REHYPE_PLUGINS: MarkdownRehypePlugins = [
  rehypeRaw,
  rehypeCanonicalEditorFileLinks,
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
      protocols: {
        ...defaultSchema.protocols,
        href: [
          ...(defaultSchema.protocols?.href ?? []),
          ...EDITOR_FILE_URL_SCHEMES,
        ],
        poster: ["http", "https"],
      },
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
