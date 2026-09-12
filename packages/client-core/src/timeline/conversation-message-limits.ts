import { isRawThreadId } from "@bb/domain";

export const USER_MESSAGE_CHAR_CAP = 4096;

export const GENERATED_MESSAGE_COLLAPSED_PREVIEW_CHAR_CAP =
  USER_MESSAGE_CHAR_CAP;

interface BoundedMarkdownPreview {
  parseAsMarkdown: boolean;
  text: string;
  wasCapped: boolean;
}

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && /\s/u.test(value);
}

function scanOpenCodeSpan(text: string): {
  delimiterLength: number;
  contentStart: number;
} {
  let openDelimiterLength = 0;
  let openContentStart = -1;
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "`" || isEscapedBacktick(text, index)) continue;
    let delimiterEnd = index + 1;
    while (text[delimiterEnd] === "`") delimiterEnd += 1;
    const delimiterLength = delimiterEnd - index;
    if (openDelimiterLength === 0) {
      openDelimiterLength = delimiterLength;
      openContentStart = delimiterEnd;
    } else if (delimiterLength === openDelimiterLength) {
      openDelimiterLength = 0;
      openContentStart = -1;
    }
    index = delimiterEnd - 1;
  }
  return {
    delimiterLength: openDelimiterLength,
    contentStart: openContentStart,
  };
}

export function endsInsideExactRawThreadIdCodeSpan(text: string): boolean {
  const { delimiterLength, contentStart } = scanOpenCodeSpan(text);
  return (
    delimiterLength > 0 &&
    contentStart >= 0 &&
    isRawThreadId(text.slice(contentStart))
  );
}

function cappedMarkdownPreview(text: string): BoundedMarkdownPreview {
  return {
    parseAsMarkdown: !endsInsideExactRawThreadIdCodeSpan(text),
    text,
    wasCapped: true,
  };
}

export function boundedMarkdownPreview(
  text: string,
  cap: number,
): BoundedMarkdownPreview {
  if (text.length <= cap) {
    return { parseAsMarkdown: true, text, wasCapped: false };
  }

  const previewWindow = text.slice(0, cap + 1);
  const cappedText = previewWindow.slice(0, cap);
  const capSplitsToken =
    !isWhitespace(cappedText.at(-1)) && !isWhitespace(previewWindow[cap]);
  if (!capSplitsToken) {
    return cappedMarkdownPreview(cappedText);
  }

  const lastWhitespaceIndex = cappedText.search(/\s(?=\S*$)/u);
  if (lastWhitespaceIndex < 0) {
    return { parseAsMarkdown: false, text: cappedText, wasCapped: true };
  }

  return cappedMarkdownPreview(cappedText.slice(0, lastWhitespaceIndex + 1));
}

function isEscapedBacktick(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

export function closeUnterminatedMarkdownCodeSpan(text: string): string {
  const { delimiterLength } = scanOpenCodeSpan(text);
  return delimiterLength === 0 ? text : `${text}${"`".repeat(delimiterLength)}`;
}
