import type {
  AlignType,
  Image,
  Node,
  Paragraph,
  PhrasingContent,
  Root,
  Table,
  TableCell,
} from "mdast";
import { visit } from "unist-util-visit";

/**
 * Pure helpers the block renderers use: source slicing for per-block
 * memoization, table projection, and paragraph/image splitting.
 */

/** Exact source text of a node, or null when the parser recorded no offsets. */
export function getNodeSource(node: Node, content: string): string | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    start < 0 ||
    end < start ||
    end > content.length
  ) {
    return null;
  }
  return content.slice(start, end);
}

export interface TableModel {
  /** Per column; `null` when the column has no explicit alignment. */
  align: AlignType[];
  header: TableCell[];
  rows: TableCell[][];
  columnCount: number;
}

/**
 * Projects a GFM table: the first row is the header, remaining rows are
 * padded with empty cells so every row has `columnCount` cells (GFM lets a
 * row be short).
 */
export function buildTableModel(table: Table): TableModel {
  const [headerRow, ...bodyRows] = table.children;
  const header = headerRow?.children ?? [];
  const columnCount = Math.max(
    header.length,
    ...bodyRows.map((row) => row.children.length),
    0,
  );
  const pad = (cells: TableCell[]): TableCell[] => {
    if (cells.length >= columnCount) {
      return cells;
    }
    const padded = [...cells];
    while (padded.length < columnCount) {
      padded.push({ type: "tableCell", children: [] });
    }
    return padded;
  };
  const align: AlignType[] = [];
  for (let column = 0; column < columnCount; column += 1) {
    align.push(table.align?.[column] ?? null);
  }
  return {
    align,
    header: pad(header),
    rows: bodyRows.map((row) => pad(row.children)),
    columnCount,
  };
}

export type ParagraphSegment =
  | { kind: "inline"; children: PhrasingContent[] }
  | { kind: "image"; image: Image };

/**
 * RN cannot lay an `Image` out inside `Text` reliably, so a paragraph is
 * split into inline runs and standalone images. Whitespace-only runs between
 * images are dropped; `![a](x) ![b](y)` becomes two image blocks.
 */
export function splitParagraphSegments(
  paragraph: Paragraph,
): ParagraphSegment[] {
  const segments: ParagraphSegment[] = [];
  let run: PhrasingContent[] = [];
  const flush = () => {
    if (run.length === 0) {
      return;
    }
    const onlyWhitespace = run.every(
      (child) =>
        (child.type === "text" && child.value.trim().length === 0) ||
        child.type === "break",
    );
    if (!onlyWhitespace) {
      segments.push({ kind: "inline", children: run });
    }
    run = [];
  };
  for (const child of paragraph.children) {
    if (child.type === "image") {
      flush();
      segments.push({ kind: "image", image: child });
      continue;
    }
    run.push(child);
  }
  flush();
  return segments;
}

export interface MarkdownDefinition {
  url: string;
  title: string | null;
}

/**
 * Collects `[id]: url "title"` definitions so reference links/images
 * (`[text][id]`, `![alt][id]`) can resolve. Keys are lower-cased identifiers
 * (CommonMark matches labels case-insensitively).
 */
export function collectDefinitions(
  tree: Root,
): ReadonlyMap<string, MarkdownDefinition> {
  const definitions = new Map<string, MarkdownDefinition>();
  visit(tree, "definition", (node) => {
    const key = node.identifier.toLowerCase();
    if (!definitions.has(key)) {
      definitions.set(key, { url: node.url, title: node.title ?? null });
    }
  });
  return definitions;
}
