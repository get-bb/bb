import { Fragment, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { expect } from "vitest";
import {
  repairStreamingMarkdownTail,
  splitStreamingMarkdown,
} from "@/components/thread/timeline/streaming-markdown-split";
import {
  createMarkdownPieceCache,
  resolveMarkdownPieces,
  type MarkdownPieceCache,
  type MarkdownPieceRenderConfig,
} from "./markdown-incremental-pieces";
import { remarkInlineDollarMath } from "./markdown-inline-dollar-math";
import { normalizeMathFences } from "./markdown-math-fences";
import {
  buildMessageDirectiveRegistry,
  MESSAGE_DIRECTIVE_MOUNT_LIMIT,
  remarkMessageDirectives,
  type MountedMessageDirective,
} from "./markdown-message-directives";
import { remarkThreadMentions } from "./markdown-thread-mentions";

interface RenderedMarkdownDocument {
  html: string;
  keys: readonly string[];
  mounts: readonly string[];
}

const registry = buildMessageDirectiveRegistry([
  { id: "inline-vis", pluginId: "demo", generation: 1, component: () => null },
]);

export const config: MarkdownPieceRenderConfig = {
  codeFenceRendererRegistry: null,
  components: {},
  messageDirectiveRegistry: registry,
  rehypePlugins: [rehypeKatex],
  remarkPlugins: [
    remarkGfm,
    [remarkMath, { singleDollarTextMath: false }],
    remarkInlineDollarMath,
    remarkThreadMentions,
    remarkDirective,
  ],
  urlTransform: undefined,
};

export function describeMarkdownChildren(
  children: readonly ReactNode[],
  mounts: readonly MountedMessageDirective[],
): RenderedMarkdownDocument {
  return {
    html: renderToStaticMarkup(createElement(Fragment, null, ...children)),
    keys: children.map((child) =>
      isValidElement(child) ? `key:${String(child.key)}` : "text",
    ),
    mounts: mounts.map(
      (mount) => `${mount.index}:${mount.slot.id}:${mount.source}`,
    ),
  };
}

export function renderWholeDocument(
  body: string,
  renderConfig: MarkdownPieceRenderConfig = config,
): RenderedMarkdownDocument {
  const mounts: MountedMessageDirective[] = [];
  const element = ReactMarkdown({
    children: body,
    components: renderConfig.components,
    rehypePlugins: renderConfig.rehypePlugins,
    remarkPlugins: [
      ...renderConfig.remarkPlugins,
      [
        remarkMessageDirectives,
        {
          indexBase: 0,
          limit: MESSAGE_DIRECTIVE_MOUNT_LIMIT,
          mounts,
          registry,
        },
      ],
    ],
    urlTransform: renderConfig.urlTransform,
  });
  const children = (element.props as { children?: ReactNode }).children;
  return describeMarkdownChildren(
    children === undefined
      ? []
      : Array.isArray(children)
        ? children
        : [children],
    mounts,
  );
}

export function renderPieces(
  cache: MarkdownPieceCache,
  body: string,
  renderConfig: MarkdownPieceRenderConfig = config,
): RenderedMarkdownDocument {
  const result = resolveMarkdownPieces(cache, renderConfig, body);
  return describeMarkdownChildren(result.children, result.mounts);
}

export function expectPiecesMatchWholeDocument(
  cache: MarkdownPieceCache,
  content: string,
  label: string,
  expectedDocuments?: Map<string, RenderedMarkdownDocument>,
): void {
  const body = normalizeMathFences(content);
  let expected = expectedDocuments?.get(body);
  if (expected === undefined) {
    expected = renderWholeDocument(body);
    expectedDocuments?.set(body, expected);
  }
  expect(
    renderPieces(cache, body),
    `${label}: ${JSON.stringify(body)}`,
  ).toEqual(expected);
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function chunkEnds(text: string, seed: number): number[] {
  const next = seededRandom(seed);
  const ends: number[] = [];
  let end = 0;
  while (end < text.length) {
    end = Math.min(text.length, end + 1 + Math.floor(next() * 96));
    ends.push(end);
  }
  return ends;
}

export function expectStreamedFixtureMatchesWholeDocument({
  name,
  text,
}: {
  name: string;
  text: string;
}): void {
  const expectedDocuments = new Map<string, RenderedMarkdownDocument>();
  const settledCache = createMarkdownPieceCache();
  const tailCache = createMarkdownPieceCache();
  const completedCache = createMarkdownPieceCache();
  for (const end of chunkEnds(text, name.length)) {
    const streamed = text.slice(0, end);
    const split = splitStreamingMarkdown(streamed);
    const live = repairStreamingMarkdownTail(split?.tail ?? streamed);
    if (split === null) {
      expectPiecesMatchWholeDocument(
        settledCache,
        live,
        name,
        expectedDocuments,
      );
    } else {
      expectPiecesMatchWholeDocument(
        settledCache,
        split.settled,
        name,
        expectedDocuments,
      );
      expectPiecesMatchWholeDocument(tailCache, live, name, expectedDocuments);
    }
  }
  expectPiecesMatchWholeDocument(settledCache, text, name, expectedDocuments);
  expectPiecesMatchWholeDocument(completedCache, text, name, expectedDocuments);
}
