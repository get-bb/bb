import { parse } from "yaml";

export interface MarkdownDocument {
  frontmatter: string;
  body: string;
  title: string | null;
}

interface MarkdownLine {
  start: number;
  nextStart: number;
  text: string;
}

function readLine(content: string, start: number): MarkdownLine {
  const newline = content.indexOf("\n", start);
  const end = newline === -1 ? content.length : newline;
  const textEnd = end > start && content[end - 1] === "\r" ? end - 1 : end;
  return {
    start,
    nextStart: newline === -1 ? content.length : newline + 1,
    text: content.slice(start, textEnd),
  };
}

function parseFrontmatterTitle(source: string): string | null {
  try {
    const metadata: unknown = parse(source, { maxAliasCount: 20 });
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      Array.isArray(metadata)
    ) {
      return null;
    }
    const title = (metadata as Record<string, unknown>).title;
    return typeof title === "string" && title.trim() ? title.trim() : null;
  } catch {
    return null;
  }
}

export function parseMarkdownDocument(content: string): MarkdownDocument {
  const firstLineStart = content.startsWith("\uFEFF") ? 1 : 0;
  const firstLine = readLine(content, firstLineStart);
  if (firstLine.text !== "---") {
    return { frontmatter: "", body: content, title: null };
  }

  let lineStart = firstLine.nextStart;
  while (lineStart < content.length) {
    const line = readLine(content, lineStart);
    if (line.text === "---" || line.text === "...") {
      const frontmatterSource = content.slice(firstLine.nextStart, line.start);
      return {
        frontmatter: content.slice(0, line.nextStart),
        body: content.slice(line.nextStart),
        title: parseFrontmatterTitle(frontmatterSource),
      };
    }
    if (line.nextStart === lineStart) break;
    lineStart = line.nextStart;
  }

  return { frontmatter: "", body: content, title: null };
}
