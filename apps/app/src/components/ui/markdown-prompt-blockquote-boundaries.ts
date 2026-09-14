const MARKDOWN_FENCE_START_PATTERN = /^(?: {0,3})(`{3,}|~{3,})/u;
const MARKDOWN_ANY_INDENT_FENCE_PATTERN = /^\s*(`{3,}|~{3,})/u;
export const MARKDOWN_LIST_MARKER_PATTERN =
  /^\s{0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/u;
export const MARKDOWN_INDENTED_CONTINUATION_PATTERN = /^(?: {2,}|\t)/u;

export interface MarkdownFence {
  character: string;
  length: number;
}

export function trimMarkdownLineCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function isPromptMarkdownBlankLine(line: string): boolean {
  return /^[ \t]*$/u.test(trimMarkdownLineCarriageReturn(line));
}

function isPromptMarkdownBlockquoteLine(line: string): boolean {
  return /^ {0,3}>/u.test(trimMarkdownLineCarriageReturn(line));
}

export function parseMarkdownFenceStart(line: string): MarkdownFence | null {
  const match = MARKDOWN_FENCE_START_PATTERN.exec(
    trimMarkdownLineCarriageReturn(line),
  );
  const marker = match?.[1];
  if (marker === undefined) {
    return null;
  }
  return { character: marker[0]!, length: marker.length };
}

export function isMarkdownFenceClose(
  line: string,
  fence: MarkdownFence,
): boolean {
  const value = trimMarkdownLineCarriageReturn(line);
  const leadingSpaces = /^ {0,3}/u.exec(value)?.[0].length ?? 0;
  let index = leadingSpaces;
  while (value[index] === fence.character) {
    index += 1;
  }
  return (
    index - leadingSpaces >= fence.length &&
    /^[ \t]*$/u.test(value.slice(index))
  );
}

export function parseAnyIndentMarkdownFenceStart(
  line: string,
): MarkdownFence | null {
  const marker = MARKDOWN_ANY_INDENT_FENCE_PATTERN.exec(line)?.[1];
  if (marker === undefined) {
    return null;
  }
  return { character: marker[0]!, length: marker.length };
}

export function closesAnyIndentMarkdownFence(
  line: string,
  fence: MarkdownFence,
): boolean {
  const match = MARKDOWN_ANY_INDENT_FENCE_PATTERN.exec(line);
  const marker = match?.[1];
  if (match === null || marker === undefined) {
    return false;
  }
  return (
    marker[0] === fence.character &&
    marker.length >= fence.length &&
    line.slice(match[0].length).trim().length === 0
  );
}

export function isMarkdownListLikeLine(line: string): boolean {
  return (
    MARKDOWN_LIST_MARKER_PATTERN.test(line) ||
    MARKDOWN_INDENTED_CONTINUATION_PATTERN.test(line)
  );
}

export function normalizePromptBlockquoteBoundaries(markdown: string): string {
  const lines = markdown.split("\n");
  if (lines.length < 2) {
    return markdown;
  }

  const normalizedLines: string[] = [];
  let activeFence: MarkdownFence | null = null;
  let previousNonblankLineWasBlockquote: boolean | null = null;

  for (const line of lines) {
    if (activeFence !== null) {
      normalizedLines.push(line);
      if (isMarkdownFenceClose(line, activeFence)) {
        activeFence = null;
      }
      continue;
    }

    const lineIsBlank = isPromptMarkdownBlankLine(line);
    const lineIsBlockquote = isPromptMarkdownBlockquoteLine(line);
    if (
      !lineIsBlank &&
      previousNonblankLineWasBlockquote === true &&
      !lineIsBlockquote
    ) {
      const previousLine = normalizedLines[normalizedLines.length - 1];
      if (
        previousLine !== undefined &&
        !isPromptMarkdownBlankLine(previousLine)
      ) {
        normalizedLines.push("");
      }
    }

    normalizedLines.push(line);

    if (lineIsBlank) {
      continue;
    }

    previousNonblankLineWasBlockquote = lineIsBlockquote;
    if (!lineIsBlockquote) {
      activeFence = parseMarkdownFenceStart(line);
    }
  }

  return normalizedLines.join("\n");
}
