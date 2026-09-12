import {
  Fragment,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, {
  type Components,
  type Options as ReactMarkdownOptions,
  type UrlTransform,
} from "react-markdown";
import type { Nodes, Root } from "mdast";
import { EXIT, visit } from "unist-util-visit";
import {
  EMPTY_MOUNTED_MESSAGE_DIRECTIVES,
  MESSAGE_DIRECTIVE_MOUNT_LIMIT,
  remarkMessageDirectives,
  type MessageDirectiveRegistry,
  type MountedMessageDirective,
} from "./markdown-message-directives.js";
import {
  BARE_FENCE_PATTERN,
  TRAILING_CLOSE_PATTERN,
} from "./markdown-math-fences.js";
import {
  closesAnyIndentMarkdownFence,
  isMarkdownFenceClose,
  isMarkdownListLikeLine,
  MARKDOWN_LIST_MARKER_PATTERN,
  parseAnyIndentMarkdownFenceStart,
  parseMarkdownFenceStart,
  trimMarkdownLineCarriageReturn,
  type MarkdownFence,
} from "./markdown-prompt-blockquote-boundaries.js";

type MarkdownPluginList = NonNullable<ReactMarkdownOptions["remarkPlugins"]>;

export interface MarkdownPieceRenderConfig {
  components: Components;
  messageDirectiveRegistry: MessageDirectiveRegistry | null;
  rehypePlugins: MarkdownPluginList;
  remarkPlugins: MarkdownPluginList;
  urlTransform: UrlTransform | undefined;
}

interface MarkdownPieceSummary {
  endsOpen: boolean;
  endsWithIndentedCode: boolean;
  hasGlobalConstructs: boolean;
  lastTopLevelType: string | null;
}

interface ResolvedMarkdownPieces {
  children: readonly ReactNode[];
  mounts: readonly MountedMessageDirective[];
}

interface MarkdownElementProps {
  children?: ReactNode;
  node?: object;
}

interface MarkdownPieceEntry {
  children: readonly ReactNode[];
  mounts: readonly MountedMessageDirective[];
  source: string;
  summary: MarkdownPieceSummary;
  tagCounts: ReadonlyMap<string, number>;
}

export interface MarkdownPieceCache {
  config: MarkdownPieceRenderConfig | null;
  entries: readonly MarkdownPieceEntry[];
  latchedWholeDocumentPrefix: string | null;
  resolved: { body: string; result: ResolvedMarkdownPieces } | null;
}

interface MarkdownPieceSummaryTarget {
  source: string;
  summary: MarkdownPieceSummary;
}

interface ParseMarkdownPieceArgs {
  config: MarkdownPieceRenderConfig;
  indexBase: number;
  offsets: ReadonlyMap<string, number>;
  source: string;
}

const MARKDOWN_BLANK_LINE_PATTERN = /^[ \t]*$/u;
const MARKDOWN_PIECE_START_PATTERN = /^\S/u;
const MARKDOWN_PIECE_LIST_MARKER_PATTERN = /(?:[-*+]|\d{1,9}[.)])(?:\s|$)/uy;
const MARKDOWN_MATH_FLOW_OPEN_PATTERN = /^ {0,3}\$\$[^$]*$/u;
const MARKDOWN_MATH_FLOW_SEQUENCE_PATTERN = /^ {0,3}(\${2,})/u;
const MARKDOWN_MATH_FLOW_CLOSE_PATTERN = /^ {0,3}(\${2,})[ \t]*$/u;
const MARKDOWN_LEADING_WHITESPACE_PATTERN = /^[ \t]/u;
const MARKDOWN_HTML_RAW_OPEN_PATTERN =
  /^<(?:pre|script|style|textarea)(?:[\s>]|$)/iu;
const MARKDOWN_HTML_RAW_CLOSE_PATTERN = /<\/(?:pre|script|style|textarea)>/iu;
const MARKDOWN_HTML_DECLARATION_OPEN_PATTERN = /^<![A-Za-z]/u;
const MARKDOWN_HTML_INDENT_PATTERN = /^ {0,3}/u;
const MARKDOWN_ROOT_KEY_PATTERN = /^(.+)-(\d+)$/u;
const MARKDOWN_LIST_CONTINUATION_TYPES = new Set([
  "footnoteDefinition",
  "list",
]);
const MARKDOWN_GLOBAL_CONSTRUCT_TYPES = new Set([
  "definition",
  "footnoteDefinition",
  "footnoteReference",
]);
const UNKEYED_MARKDOWN_ROOT_NAME = "#unkeyed";
const EMPTY_MARKDOWN_TAG_COUNTS: ReadonlyMap<string, number> = new Map();
const EMPTY_MARKDOWN_PIECE_SUMMARY: MarkdownPieceSummary = {
  endsOpen: false,
  endsWithIndentedCode: false,
  hasGlobalConstructs: false,
  lastTopLevelType: null,
};

export function findMarkdownPieceCandidates(body: string): readonly number[] {
  const candidates: number[] = [];
  let fence: MarkdownFence | null = null;
  let mathOpen = false;
  let previousLineBlank = false;
  let lastNonBlankLine: string | null = null;
  let lineStart = 0;
  while (lineStart < body.length) {
    const newline = body.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? body.length : newline;
    const line = trimMarkdownLineCarriageReturn(body.slice(lineStart, lineEnd));
    const blank = MARKDOWN_BLANK_LINE_PATTERN.test(line);
    if (fence !== null) {
      if (closesAnyIndentMarkdownFence(line, fence)) {
        fence = null;
      }
    } else if (mathOpen) {
      if (BARE_FENCE_PATTERN.test(line) || TRAILING_CLOSE_PATTERN.test(line)) {
        mathOpen = false;
      }
    } else if (!blank) {
      if (
        previousLineBlank &&
        lastNonBlankLine !== null &&
        MARKDOWN_PIECE_START_PATTERN.test(line) &&
        !(
          isMarkdownListLikeLine(lastNonBlankLine) &&
          MARKDOWN_LIST_MARKER_PATTERN.test(line)
        )
      ) {
        candidates.push(lineStart);
      }
      fence = parseAnyIndentMarkdownFenceStart(line);
      if (fence === null && MARKDOWN_MATH_FLOW_OPEN_PATTERN.test(line)) {
        mathOpen = true;
      }
    }
    if (!blank) {
      lastNonBlankLine = line;
    }
    previousLineBlank = blank;
    lineStart = newline === -1 ? body.length : newline + 1;
  }
  return candidates;
}

function markdownNodeSource(node: Nodes, source: string): string | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined || end < start) {
    return null;
  }
  return source.slice(start, end);
}

function isIndentedMarkdownCode(slice: string): boolean {
  return (
    parseMarkdownFenceStart(slice) === null &&
    MARKDOWN_LEADING_WHITESPACE_PATTERN.test(slice)
  );
}

function isMarkdownCodeOpen(slice: string): boolean {
  const lines = slice.split("\n");
  const fence = parseMarkdownFenceStart(lines[0] ?? "");
  if (fence === null) {
    return !isIndentedMarkdownCode(slice);
  }
  return lines.length < 2 || !isMarkdownFenceClose(lines.at(-1) ?? "", fence);
}

function isMarkdownMathOpen(slice: string): boolean {
  const lines = slice.split("\n");
  const open = MARKDOWN_MATH_FLOW_SEQUENCE_PATTERN.exec(lines[0] ?? "");
  if (open === null || lines.length < 2) {
    return true;
  }
  const close = MARKDOWN_MATH_FLOW_CLOSE_PATTERN.exec(
    trimMarkdownLineCarriageReturn(lines.at(-1) ?? ""),
  );
  return close === null || close[1]!.length < open[1]!.length;
}

function isMarkdownHtmlOpen(value: string): boolean {
  const html = value.replace(MARKDOWN_HTML_INDENT_PATTERN, "");
  if (MARKDOWN_HTML_RAW_OPEN_PATTERN.test(html)) {
    return !MARKDOWN_HTML_RAW_CLOSE_PATTERN.test(html);
  }
  if (html.startsWith("<!--")) {
    return !html.includes("-->", 4);
  }
  if (html.startsWith("<![CDATA[")) {
    return !html.includes("]]>", 9);
  }
  if (html.startsWith("<?")) {
    return !html.includes("?>", 2);
  }
  if (MARKDOWN_HTML_DECLARATION_OPEN_PATTERN.test(html)) {
    return !html.includes(">", 2);
  }
  return false;
}

function isMarkdownNodeOpen(node: Nodes, source: string): boolean {
  const type: string = node.type;
  if (type === "containerDirective") {
    return true;
  }
  if (node.type === "html") {
    return isMarkdownHtmlOpen(node.value);
  }
  if (type !== "code" && type !== "math") {
    return false;
  }
  const slice = markdownNodeSource(node, source);
  if (slice === null) {
    return true;
  }
  return type === "code"
    ? isMarkdownCodeOpen(slice)
    : isMarkdownMathOpen(slice);
}

function markdownLastDescendantChainIsOpen(
  tree: Root,
  source: string,
): boolean {
  let node: Nodes | undefined = tree.children[tree.children.length - 1];
  while (node !== undefined) {
    if (isMarkdownNodeOpen(node, source)) {
      return true;
    }
    node =
      "children" in node ? node.children[node.children.length - 1] : undefined;
  }
  return false;
}

function markdownTreeHasGlobalConstructs(tree: Root): boolean {
  let found = false;
  visit(tree, (node) => {
    if (MARKDOWN_GLOBAL_CONSTRUCT_TYPES.has(node.type)) {
      found = true;
      return EXIT;
    }
    return undefined;
  });
  return found;
}

function endsWithIndentedMarkdownCode(tree: Root, source: string): boolean {
  const last = tree.children[tree.children.length - 1];
  if (last?.type !== "code") {
    return false;
  }
  const slice = markdownNodeSource(last, source);
  return slice === null || isIndentedMarkdownCode(slice);
}

function remarkMarkdownPieceSummary(target: MarkdownPieceSummaryTarget) {
  return (tree: Root): void => {
    const { source } = target;
    target.summary = {
      endsOpen: markdownLastDescendantChainIsOpen(tree, source),
      endsWithIndentedCode: endsWithIndentedMarkdownCode(tree, source),
      hasGlobalConstructs:
        (source.includes("]:") || source.includes("[^")) &&
        markdownTreeHasGlobalConstructs(tree),
      lastTopLevelType: tree.children[tree.children.length - 1]?.type ?? null,
    };
  };
}

function markdownRootChildren(element: ReactElement): readonly ReactNode[] {
  if (element.type !== Fragment) {
    return [element];
  }
  const { children } = element.props as { children?: ReactNode };
  if (children === undefined || children === null) {
    return [];
  }
  return Array.isArray(children) ? children : [children];
}

function parseMarkdownRootKey(
  key: string | null,
): { count: number; name: string } | null {
  if (key === null) {
    return null;
  }
  const match = MARKDOWN_ROOT_KEY_PATTERN.exec(key);
  if (match === null) {
    return null;
  }
  return { count: Number(match[2]), name: match[1]! };
}

function rekeyMarkdownRootChildren(
  children: readonly ReactNode[],
  offsets: ReadonlyMap<string, number>,
): { children: readonly ReactNode[]; tagCounts: ReadonlyMap<string, number> } {
  const tagCounts = new Map<string, number>();
  const rekeyed = children.map((child) => {
    if (!isValidElement(child)) {
      return child;
    }
    const parsedKey = parseMarkdownRootKey(child.key);
    if (child.key !== null && parsedKey === null) {
      return child;
    }
    const name = parsedKey?.name ?? UNKEYED_MARKDOWN_ROOT_NAME;
    const count = tagCounts.get(name) ?? 0;
    tagCounts.set(name, count + 1);
    const documentCount = count + (offsets.get(name) ?? 0);
    if (parsedKey !== null && documentCount === parsedKey.count) {
      return child;
    }
    return cloneElement(child, { key: `${name}-${documentCount}` });
  });
  return { children: rekeyed, tagCounts };
}

function parseMarkdownPiece({
  config,
  indexBase,
  offsets,
  source,
}: ParseMarkdownPieceArgs): MarkdownPieceEntry {
  const summaryTarget: MarkdownPieceSummaryTarget = {
    source,
    summary: EMPTY_MARKDOWN_PIECE_SUMMARY,
  };
  const mounts: MountedMessageDirective[] = [];
  const remarkPlugins: MarkdownPluginList = [
    [remarkMarkdownPieceSummary, summaryTarget],
    ...config.remarkPlugins,
  ];
  if (config.messageDirectiveRegistry !== null) {
    remarkPlugins.push([
      remarkMessageDirectives,
      {
        indexBase,
        limit: Math.max(0, MESSAGE_DIRECTIVE_MOUNT_LIMIT - indexBase),
        mounts,
        registry: config.messageDirectiveRegistry,
      },
    ]);
  }
  const element = ReactMarkdown({
    children: source,
    components: config.components,
    rehypePlugins: config.rehypePlugins,
    remarkPlugins,
    urlTransform: config.urlTransform,
  });
  const { children, tagCounts } = rekeyMarkdownRootChildren(
    markdownRootChildren(element),
    offsets,
  );
  return {
    children,
    mounts: mounts.length === 0 ? EMPTY_MOUNTED_MESSAGE_DIRECTIVES : mounts,
    source,
    summary: summaryTarget.summary,
    tagCounts,
  };
}

function markdownPieceNeedsMerge(
  summary: MarkdownPieceSummary,
  body: string,
  end: number,
): boolean {
  if (summary.endsOpen || summary.endsWithIndentedCode) {
    return true;
  }
  if (
    summary.lastTopLevelType === null ||
    !MARKDOWN_LIST_CONTINUATION_TYPES.has(summary.lastTopLevelType)
  ) {
    return false;
  }
  MARKDOWN_PIECE_LIST_MARKER_PATTERN.lastIndex = end;
  return MARKDOWN_PIECE_LIST_MARKER_PATTERN.test(body);
}

function resolveIncrementalMarkdownPieceEntries(
  config: MarkdownPieceRenderConfig,
  body: string,
  previousEntries: readonly MarkdownPieceEntry[],
): readonly MarkdownPieceEntry[] | null {
  const candidates = findMarkdownPieceCandidates(body);
  const entries: MarkdownPieceEntry[] = [];
  const offsets = new Map<string, number>();
  let mountCount = 0;
  let reusingPreviousEntries = true;
  let start = 0;
  let endIndex = 0;
  while (start < body.length) {
    while (endIndex < candidates.length && candidates[endIndex]! <= start) {
      endIndex += 1;
    }
    const previous = reusingPreviousEntries
      ? previousEntries[entries.length]
      : undefined;
    const previousMatches =
      previous !== undefined && body.startsWith(previous.source, start);
    if (previousMatches) {
      const previousEnd = start + previous.source.length;
      let previousEndIndex = endIndex;
      while (
        previousEndIndex < candidates.length &&
        candidates[previousEndIndex]! < previousEnd
      ) {
        previousEndIndex += 1;
      }
      if ((candidates[previousEndIndex] ?? body.length) === previousEnd) {
        endIndex = previousEndIndex;
      } else if (previous.summary.endsOpen) {
        endIndex = candidates.length;
      }
    }
    let end = candidates[endIndex] ?? body.length;
    let entry =
      previousMatches && start + previous.source.length === end
        ? previous
        : parseMarkdownPiece({
            config,
            indexBase: mountCount,
            offsets,
            source: body.slice(start, end),
          });
    let merges = 0;
    while (
      !entry.summary.hasGlobalConstructs &&
      end < body.length &&
      markdownPieceNeedsMerge(entry.summary, body, end)
    ) {
      merges += 1;
      endIndex = merges === 1 ? endIndex + 1 : candidates.length;
      end = candidates[endIndex] ?? body.length;
      entry = parseMarkdownPiece({
        config,
        indexBase: mountCount,
        offsets,
        source: body.slice(start, end),
      });
    }
    if (entry.summary.hasGlobalConstructs) {
      return null;
    }
    if (entry !== previous) {
      reusingPreviousEntries = false;
    }
    entries.push(entry);
    for (const [name, count] of entry.tagCounts) {
      offsets.set(name, (offsets.get(name) ?? 0) + count);
    }
    mountCount += entry.mounts.length;
    start = end;
  }
  return entries;
}

function refreshMarkdownElementTree(child: ReactNode): ReactNode {
  if (Array.isArray(child)) {
    return child.map(refreshMarkdownElementTree);
  }
  if (!isValidElement<MarkdownElementProps>(child)) {
    return child;
  }
  const { children, node } = child.props;
  const props = node === undefined ? undefined : { node: { ...node } };
  if (children === undefined) {
    return cloneElement(child, props);
  }
  if (Array.isArray(children)) {
    return cloneElement(
      child,
      props,
      ...children.map(refreshMarkdownElementTree),
    );
  }
  return cloneElement(child, props, refreshMarkdownElementTree(children));
}

function buildResolvedMarkdownPieces(
  entries: readonly MarkdownPieceEntry[],
  previousEntries: readonly MarkdownPieceEntry[],
): ResolvedMarkdownPieces {
  const reusedEntries = new Set(previousEntries);
  const children: ReactNode[] = [];
  const mounts: MountedMessageDirective[] = [];
  for (const entry of entries) {
    const reused = reusedEntries.has(entry);
    if (entry.children.length > 0) {
      if (children.length > 0) {
        children.push("\n");
      }
      for (const child of entry.children) {
        children.push(reused ? refreshMarkdownElementTree(child) : child);
      }
    }
    for (const mount of entry.mounts) {
      mounts.push(
        reused ? { ...mount, attributes: { ...mount.attributes } } : mount,
      );
    }
  }
  return {
    children,
    mounts: mounts.length === 0 ? EMPTY_MOUNTED_MESSAGE_DIRECTIVES : mounts,
  };
}

export function createMarkdownPieceCache(): MarkdownPieceCache {
  return {
    config: null,
    entries: [],
    latchedWholeDocumentPrefix: null,
    resolved: null,
  };
}

export function resolveMarkdownPieces(
  cache: MarkdownPieceCache,
  config: MarkdownPieceRenderConfig,
  body: string,
): ResolvedMarkdownPieces {
  if (cache.config !== config) {
    cache.config = config;
    cache.entries = [];
    cache.latchedWholeDocumentPrefix = null;
    cache.resolved = null;
  }
  if (cache.resolved !== null && cache.resolved.body === body) {
    return cache.resolved.result;
  }
  const previousEntries = cache.entries;
  const latchedPrefix = cache.latchedWholeDocumentPrefix;
  const keepsLatchedPrefix =
    latchedPrefix !== null && body.startsWith(latchedPrefix);
  const attemptsPieces = previousEntries.length > 0 && !keepsLatchedPrefix;
  let entries = attemptsPieces
    ? resolveIncrementalMarkdownPieceEntries(config, body, previousEntries)
    : null;
  if (entries === null) {
    const entry = parseMarkdownPiece({
      config,
      indexBase: 0,
      offsets: EMPTY_MARKDOWN_TAG_COUNTS,
      source: body,
    });
    entries = [entry];
    cache.latchedWholeDocumentPrefix = keepsLatchedPrefix
      ? latchedPrefix
      : attemptsPieces || entry.summary.hasGlobalConstructs
        ? body
        : null;
  } else {
    cache.latchedWholeDocumentPrefix = null;
  }
  const result = buildResolvedMarkdownPieces(entries, previousEntries);
  cache.entries = entries;
  cache.resolved = { body, result };
  return result;
}
