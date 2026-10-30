import { parseApplicationUrl } from "@bb/domain/application-url";
import { visit } from "unist-util-visit";
import { useMemo } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { EDITOR_FILE_URL_SCHEMES } from "./markdown-local-file-link.js";

type MarkdownRehypePlugins = NonNullable<Options["rehypePlugins"]>;

const MARKDOWN_HTML_SCHEMA = {
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
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      "dataCodeFenceOffset",
      "dataCodeFenceClosed",
    ],
    "bb-thread-mention": [
      "dataThreadId",
      "dataRawThreadId",
      "dataRawThreadInlineCode",
    ],
    "bb-prompt-mention": ["dataMentionIndex"],
    "bb-message-directive": ["dataDirectiveIndex"],
  },
};

function sanitizeMarkdownHtml() {
  return (tree: Parameters<ReturnType<typeof rehypeSanitize>>[0]) => {
    const schemes = new Set(MARKDOWN_HTML_SCHEMA.protocols.href);
    visit(tree, "element", (node) => {
      if (node.tagName !== "a") return;
      const target = parseApplicationUrl(node.properties.href);
      if (target !== null) schemes.add(target.scheme);
    });
    return rehypeSanitize({
      ...MARKDOWN_HTML_SCHEMA,
      protocols: { ...MARKDOWN_HTML_SCHEMA.protocols, href: [...schemes] },
    })(tree);
  };
}

const MARKDOWN_HTML_REHYPE_PLUGINS: MarkdownRehypePlugins = [
  rehypeRaw,
  sanitizeMarkdownHtml,
];

export function MarkdownHtml({ rehypePlugins, ...props }: Options) {
  const plugins = useMemo(
    () => [...MARKDOWN_HTML_REHYPE_PLUGINS, ...(rehypePlugins ?? [])],
    [rehypePlugins],
  );
  return <ReactMarkdown {...props} rehypePlugins={plugins} />;
}
