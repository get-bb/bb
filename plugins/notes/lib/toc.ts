/**
 * Table-of-contents generation, the one place
 * `markdown.extension.toc.orderedList` from the imported VS Code settings
 * has an effect. It comes from the Markdown All in One extension, where it
 * decides whether a generated TOC uses `1.` or `-`.
 */

import { fencedCodeLines } from "./fenced-code.js";

export interface Heading {
  level: number;
  text: string;
  /** 1-based line the heading sits on. */
  lineNumber: number;
}

const ATX_HEADING = /^[ ]{0,3}(#{1,6})(?:[ \t]+)(.*?)(?:[ \t]+#+)?[ \t]*$/;

/**
 * Collects ATX headings, skipping anything inside a fenced code block — a
 * shell snippet full of `# comments` would otherwise become TOC entries.
 */
export function collectHeadings(lines: readonly string[]): Heading[] {
  const fenced = fencedCodeLines(lines);
  const headings: Heading[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (fenced.has(index + 1)) continue;
    const match = ATX_HEADING.exec(lines[index] ?? "");
    if (match === null) continue;
    const text = (match[2] ?? "").trim();
    if (text === "") continue;
    headings.push({
      level: (match[1] ?? "").length,
      text,
      lineNumber: index + 1,
    });
  }

  return headings;
}

export function anchorFor(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/__([^_]*)__/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export interface TocOptions {
  orderedList: boolean;
  /** Headings shallower or deeper than this range are left out. */
  minLevel?: number;
  maxLevel?: number;
}

export function renderToc(
  headings: readonly Heading[],
  options: TocOptions,
): string {
  const minLevel = options.minLevel ?? 2;
  const maxLevel = options.maxLevel ?? 6;
  const included = headings.filter(
    (heading) => heading.level >= minLevel && heading.level <= maxLevel,
  );
  if (included.length === 0) return "";

  // Indent relative to the shallowest heading actually present, so a note
  // whose headings start at H2 is not indented by a level that never
  // appears.
  const base = Math.min(...included.map((heading) => heading.level));
  const counters = new Map<number, number>();

  return included
    .map((heading) => {
      const depth = heading.level - base;
      if (options.orderedList) {
        counters.set(depth, (counters.get(depth) ?? 0) + 1);
        for (const level of [...counters.keys()]) {
          if (level > depth) counters.delete(level);
        }
      }
      const marker = options.orderedList
        ? `${counters.get(depth) ?? 1}.`
        : "-";
      const indent = "  ".repeat(depth);
      return `${indent}${marker} [${heading.text}](#${anchorFor(heading.text)})`;
    })
    .join("\n");
}

export const TOC_START = "<!-- toc -->";
export const TOC_END = "<!-- /toc -->";

export interface TocUpdate {
  content: string;
  /** False when the document has no `<!-- toc -->` marker to fill. */
  replaced: boolean;
}

/**
 * Rewrites the block between the TOC markers, or reports that there is none
 * so the caller can insert one at the cursor instead of guessing a location.
 */
export function updateTocBlock(
  content: string,
  options: TocOptions,
): TocUpdate {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.trim() === TOC_START);
  if (start === -1) return { content, replaced: false };
  const end = lines.findIndex(
    (line, index) => index > start && line.trim() === TOC_END,
  );
  if (end === -1) return { content, replaced: false };

  const toc = renderToc(collectHeadings(lines), options);
  const next = [
    ...lines.slice(0, start + 1),
    ...(toc === "" ? [] : toc.split("\n")),
    ...lines.slice(end),
  ];
  return { content: next.join("\n"), replaced: true };
}

/** The full block to drop in when a document has no TOC markers yet. */
export function tocBlock(content: string, options: TocOptions): string {
  const toc = renderToc(collectHeadings(content.split("\n")), options);
  return [TOC_START, ...(toc === "" ? [] : [toc]), TOC_END, ""].join("\n");
}
