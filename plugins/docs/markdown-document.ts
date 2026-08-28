import { parse } from "yaml";
import { z } from "zod";

const jsonObjectSchema = z.record(z.string(), z.json());
type JsonObject = z.output<typeof jsonObjectSchema>;

interface MarkdownDocument {
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

function parseFrontmatterMetadata(source: string): JsonObject | null {
  let metadata: JsonObject | null;
  try {
    const parsed = parse(source, { maxAliasCount: 20 });
    if (parsed === null || parsed === undefined) return {};
    const result = jsonObjectSchema.safeParse(parsed);
    metadata = result.success ? result.data : null;
  } catch {
    return null;
  }
  return metadata;
}

function frontmatterTitle(metadata: JsonObject): string | null {
  const title = z.string().safeParse(metadata.title);
  return title.success && title.data.trim() ? title.data.trim() : null;
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
      const metadata = parseFrontmatterMetadata(frontmatterSource);
      if (!metadata) break;
      return {
        frontmatter: content.slice(0, line.nextStart),
        body: content.slice(line.nextStart),
        title: frontmatterTitle(metadata),
      };
    }
    if (line.nextStart === lineStart) break;
    lineStart = line.nextStart;
  }

  return { frontmatter: "", body: content, title: null };
}
