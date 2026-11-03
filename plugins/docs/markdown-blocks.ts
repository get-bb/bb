import type { Editor } from "@tiptap/core";
import { DOMParser, type Node as ProseMirrorNode } from "@tiptap/pm/model";

interface Block {
  source: string;
  after: string;
  nodes: ProseMirrorNode[];
}

export interface MarkdownBlocks {
  leading: string;
  blocks: Block[];
  newline: boolean;
}

interface BlockToken {
  level: number;
  nesting: number;
  map: [number, number] | null;
}

function topLevelNodes(
  editor: Editor,
  owner: Document,
  children: ChildNode[],
): ProseMirrorNode[] {
  const container = owner.createElement("div");
  container.append(...children);
  const nodes: ProseMirrorNode[] = [];
  DOMParser.fromSchema(editor.schema)
    .parse(container, editor.options.parseOptions)
    .forEach((node) => nodes.push(node));
  return nodes.length === 1 && nodes[0]!.isTextblock && !nodes[0]!.content.size
    ? []
    : nodes;
}

function parseMarkdownBlocks(
  editor: Editor,
  markdown: string,
  display: (source: string) => string,
): MarkdownBlocks {
  const tokens: BlockToken[] = editor.storage.markdown.parser.md.parse(
    markdown,
    {},
  );
  const offsets = [0];
  for (const match of markdown.matchAll(/\r\n?|\n/g))
    offsets.push(match.index + match[0].length);
  const lineStart = (line: number) => offsets[line] ?? markdown.length;
  const blocks: Block[] = [];
  const starts: number[] = [];
  let leading = "";
  let cursor = 0;
  const addGap = (text: string) => {
    const content = text.trim();
    const start = content ? text.indexOf(content) : text.length;
    if (blocks.length) blocks.at(-1)!.after += text.slice(0, start);
    else leading += text.slice(0, start);
    if (content)
      blocks.push({
        source: content,
        after: text.slice(start + content.length),
        nodes: [],
      });
  };
  for (const token of tokens) {
    if (token.level !== 0 || token.nesting === -1 || !token.map) continue;
    const from = lineStart(token.map[0]);
    addGap(markdown.slice(cursor, from));
    const source = markdown
      .slice(from, lineStart(token.map[1]))
      .replace(/[\r\n]+$/, "");
    starts.push(blocks.length);
    blocks.push({ source, after: "", nodes: [] });
    cursor = from + source.length;
  }
  addGap(markdown.slice(cursor));
  const marker = `docs-block-${Math.random().toString(36).slice(2)}`;
  const marked = starts
    .map((index, position) => {
      const block = blocks[index]!;
      const next = starts[position + 1];
      const gap = blocks
        .slice(index + 1, next ?? blocks.length)
        .map((hidden) => hidden.source + hidden.after)
        .join("");
      return block.source + block.after + gap;
    })
    .join(`\n<!--${marker}-->\n\n`);
  const html: string = editor.storage.markdown.parser.parse(
    display(leading + marked),
  );
  const body = new window.DOMParser().parseFromString(
    `<body>${html}</body>`,
    "text/html",
  ).body;
  const groups: ChildNode[][] = [[]];
  for (const child of [...body.childNodes]) {
    if (child.textContent === `<!--${marker}-->`) groups.push([]);
    else groups.at(-1)!.push(child);
  }
  if (groups.length !== Math.max(starts.length, 1))
    return {
      leading: "",
      blocks: [
        {
          source: markdown,
          after: "",
          nodes: topLevelNodes(editor, body.ownerDocument, groups.flat()),
        },
      ],
      newline: false,
    };
  starts.forEach((index, position) => {
    blocks[index]!.nodes = topLevelNodes(
      editor,
      body.ownerDocument,
      groups[position]!,
    );
  });
  return { leading, blocks, newline: markdown.endsWith("\n") };
}

const MEDIA_NODES = new Set(["image", "simpleHtmlEmbed"]);

function hasMedia(node: ProseMirrorNode): boolean {
  let found = MEDIA_NODES.has(node.type.name);
  node.descendants((child) => {
    found ||= MEDIA_NODES.has(child.type.name);
    return !found;
  });
  return found;
}

function reusableNodes(
  editor: Editor,
  loaded: MarkdownBlocks,
  serialize: (nodes: ProseMirrorNode[]) => string,
  refreshMedia: boolean,
): Map<string, ProseMirrorNode[]> {
  const sources = new Map<ProseMirrorNode, string>();
  for (const block of loaded.blocks)
    if (block.nodes.length === 1) sources.set(block.nodes[0]!, block.source);
  const reusable = new Map<string, ProseMirrorNode[]>();
  editor.state.doc.forEach((node) => {
    if (refreshMedia && hasMedia(node)) return;
    const source = sources.get(node) ?? serialize([node]).replace(/\n+$/, "");
    reusable.set(source, [...(reusable.get(source) ?? []), node]);
  });
  return reusable;
}

export function loadMarkdownBlocks(
  editor: Editor,
  markdown: string,
  display: (source: string) => string,
  addToHistory: boolean,
  previous?: {
    loaded: MarkdownBlocks;
    serialize(nodes: ProseMirrorNode[]): string;
    refreshMedia: boolean;
  } | null,
): MarkdownBlocks {
  const parsed = parseMarkdownBlocks(editor, markdown, display);
  if (previous && !editor.isEmpty) {
    const reusable = reusableNodes(
      editor,
      previous.loaded,
      previous.serialize,
      previous.refreshMedia,
    );
    for (const block of parsed.blocks) {
      const live = block.nodes.length === 1 && reusable.get(block.source);
      if (live && live.length) block.nodes = [live.shift()!];
    }
  }
  const nodes = parsed.blocks.flatMap((block) => block.nodes);
  const doc = editor.schema.topNodeType.createAndFill(null, nodes)!;
  const current = editor.state.doc.content;
  const transaction = editor.state.tr;
  const start = editor.isEmpty ? 0 : current.findDiffStart(doc.content);
  if (editor.isEmpty) transaction.replaceWith(0, current.size, doc.content);
  else if (start !== null) {
    let { a, b } = current.findDiffEnd(doc.content)!;
    const overlap = start - Math.min(a, b);
    if (overlap > 0) {
      a += overlap;
      b += overlap;
    }
    transaction.replace(start, a, doc.slice(start, b));
  }
  editor.view.dispatch(
    transaction
      .setMeta("addToHistory", addToHistory)
      .setMeta("preventUpdate", true),
  );
  const live: ProseMirrorNode[] = [];
  editor.state.doc.forEach((node) => live.push(node));
  if (nodes.length && live.length !== nodes.length)
    return { leading: "", blocks: [], newline: parsed.newline };
  let index = 0;
  for (const block of parsed.blocks) {
    block.nodes = nodes.length
      ? live.slice(index, index + block.nodes.length)
      : [];
    index += block.nodes.length;
  }
  return parsed;
}

export function saveMarkdownBlocks(
  editor: Editor,
  loaded: MarkdownBlocks,
  serialize: (nodes: ProseMirrorNode[]) => string,
): string {
  const { blocks } = loaded;
  const owner = new Map<ProseMirrorNode, number>();
  blocks.forEach((block, index) => {
    if (block.nodes[0]) owner.set(block.nodes[0], index);
  });
  const children: ProseMirrorNode[] = [];
  editor.state.doc.forEach((node) => children.push(node));
  const parts: { text: string; block?: number }[] = [];
  let edited: ProseMirrorNode[] = [];
  const flush = () => {
    if (edited.length)
      parts.push({ text: serialize(edited).replace(/\n+$/, "") });
    edited = [];
  };
  for (let index = 0; index < children.length;) {
    const block = owner.get(children[index]!);
    const nodes = block === undefined ? [] : blocks[block]!.nodes;
    if (
      block !== undefined &&
      nodes.every((node, offset) => children[index + offset] === node)
    ) {
      flush();
      parts.push({ text: blocks[block]!.source, block });
      index += nodes.length;
    } else edited.push(children[index++]!);
  }
  flush();
  const nextShown = (from: number) => {
    let next = from + 1;
    while (blocks[next] && !blocks[next]!.nodes.length) next++;
    return next;
  };
  const between = (from: number, to: number) =>
    (from < 0 ? "" : blocks[from]!.after) +
    blocks
      .slice(from + 1, to)
      .map((block) => block.source + block.after)
      .join("");
  const hidden = (from: number, to: number) =>
    blocks
      .slice(from + 1, to)
      .filter((block) => !block.nodes.length)
      .map((block) => block.source);
  let out = loaded.leading;
  const append = (text: string) => {
    if (text) out += (out.trim() ? "\n\n" : "") + text;
  };
  let anchor = -1;
  let clean = true;
  for (const part of parts) {
    if (part.block === undefined) {
      append(part.text);
      clean = false;
    } else {
      if (clean && part.block === nextShown(anchor))
        out += between(anchor, part.block) + part.text;
      else {
        hidden(anchor, part.block).forEach(append);
        append(part.text);
      }
      anchor = part.block;
      clean = true;
    }
  }
  if (clean && nextShown(anchor) >= blocks.length)
    return out + between(anchor, blocks.length);
  hidden(anchor, blocks.length).forEach(append);
  return loaded.newline ? `${out}\n` : out;
}
