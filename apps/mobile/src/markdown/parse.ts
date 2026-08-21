import type { Root } from "mdast";
import remarkBreaks from "remark-breaks";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified, type Processor } from "unified";
import { remarkBbDirectives } from "./directives";
import { remarkPromptMentions } from "./prompt-mentions";
import { remarkThreadMentions } from "./thread-mentions";

/**
 * Parse options. Each flag switches one pipeline stage on, mirroring the web
 * `MarkdownPreview` (`apps/app/src/components/ui/markdown-preview.tsx`):
 * authored prompts and generated bodies keep single newlines as breaks, only
 * bodies that may carry mentions run the mention transforms, and only
 * assistant bodies parse `remark-directive` syntax (user prose keeps `::x`
 * literal).
 */
export interface ParseMarkdownOptions {
  /** `remark-breaks`: a single `\n` becomes a hard line break. */
  preserveSoftBreaks: boolean;
  /** Rewrite `@thread:<id>` tokens and raw thread ids into mention nodes. */
  threadMentions: boolean;
  /** Rewrite prompt-mention sentinels (see `substitutePromptMentions`). */
  promptMentions: boolean;
  /** Parse `::name{…}` / `:::name` directives into `bbDirective` nodes. */
  directives: boolean;
}

const DEFAULT_PARSE_MARKDOWN_OPTIONS: ParseMarkdownOptions = {
  preserveSoftBreaks: false,
  threadMentions: false,
  promptMentions: false,
  directives: false,
};

type MarkdownProcessor = Processor<
  Root,
  undefined,
  undefined,
  undefined,
  undefined
>;

const processors = new Map<string, MarkdownProcessor>();

function optionsKey(options: ParseMarkdownOptions): string {
  return `${options.preserveSoftBreaks ? "b" : "-"}${
    options.threadMentions ? "t" : "-"
  }${options.promptMentions ? "p" : "-"}${options.directives ? "d" : "-"}`;
}

function buildProcessor(options: ParseMarkdownOptions): MarkdownProcessor {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    // Single-dollar math OFF: micromark would pair any two unescaped `$` on
    // a line ("$5 to $10"), and literal dollars dominate chat. Inline math
    // needs `$$x$$`; `$$` on its own lines is still a block. Math renders as
    // source on mobile (v1); the node types exist so the renderer can style
    // them.
    .use(remarkMath, { singleDollarTextMath: false });
  if (options.preserveSoftBreaks) {
    processor.use(remarkBreaks);
  }
  if (options.directives) {
    processor.use(remarkDirective);
  }
  // Thread mentions run before directive normalization: when remark-directive
  // is active it splits `@thread:<id>` into `@thread` + `:<id>` text
  // directive, and the mention pass rejoins that pair.
  if (options.threadMentions) {
    processor.use(remarkThreadMentions);
  }
  if (options.promptMentions) {
    processor.use(remarkPromptMentions);
  }
  if (options.directives) {
    processor.use(remarkBbDirectives);
  }
  processor.freeze();
  return processor;
}

function getProcessor(options: ParseMarkdownOptions): MarkdownProcessor {
  const key = optionsKey(options);
  let processor = processors.get(key);
  if (processor === undefined) {
    processor = buildProcessor(options);
    processors.set(key, processor);
  }
  return processor;
}

/** Parse without memoization. Prefer {@link parseMarkdown}. */
export function parseMarkdownUncached(
  content: string,
  options: ParseMarkdownOptions = DEFAULT_PARSE_MARKDOWN_OPTIONS,
): Root {
  const processor = getProcessor(options);
  const tree = processor.parse(content);
  // Every transformer in the pipeline mutates the tree in place and returns
  // nothing, so the parsed root is the finished tree.
  processor.runSync(tree, content);
  return tree;
}

/**
 * Small LRU over parsed trees. Streaming assistant text re-parses on every
 * delta (the content changes), but unchanged bodies in a long timeline hit
 * the cache when their row remounts after virtualization.
 */
const PARSE_CACHE_LIMIT = 256;
const parseCache = new Map<string, Root>();

/**
 * Parse `content` into mdast with the bb transforms applied, memoized by
 * `(options, content)`. The returned tree is shared: treat it as read-only.
 */
export function parseMarkdown(
  content: string,
  options: ParseMarkdownOptions = DEFAULT_PARSE_MARKDOWN_OPTIONS,
): Root {
  const key = `${optionsKey(options)} ${content}`;
  const cached = parseCache.get(key);
  if (cached !== undefined) {
    // Refresh recency.
    parseCache.delete(key);
    parseCache.set(key, cached);
    return cached;
  }
  const tree = parseMarkdownUncached(content, options);
  parseCache.set(key, tree);
  if (parseCache.size > PARSE_CACHE_LIMIT) {
    const oldest = parseCache.keys().next().value;
    if (oldest !== undefined) {
      parseCache.delete(oldest);
    }
  }
  return tree;
}

/** Test hook. */
export function clearParseMarkdownCache(): void {
  parseCache.clear();
}

const FRONTMATTER_PATTERN =
  /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;

export interface SplitMarkdownFrontmatterResult {
  frontmatter: string | null;
  body: string;
}

/**
 * Splits a leading YAML frontmatter block (`---` … `---` at the very start of
 * the document) from the markdown body. Without this the fences parse as two
 * thematic breaks with the raw YAML as a paragraph between them.
 */
export function splitMarkdownFrontmatter(
  markdown: string,
): SplitMarkdownFrontmatterResult {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (match === null) {
    return { frontmatter: null, body: markdown };
  }
  return {
    frontmatter: match[1] ?? "",
    body: markdown.slice(match[0].length),
  };
}
