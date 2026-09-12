import remend from "remend";
import { closeUnterminatedMarkdownCodeSpan } from "@bb/client-core";
import {
  closesAnyIndentMarkdownFence,
  isMarkdownListLikeLine,
  MARKDOWN_INDENTED_CONTINUATION_PATTERN,
  MARKDOWN_LIST_MARKER_PATTERN,
  parseAnyIndentMarkdownFenceStart,
  type MarkdownFence,
} from "@/components/ui/markdown-prompt-blockquote-boundaries";

interface StreamingMarkdownSplit {
  settled: string;
  tail: string;
}

const STREAMING_MARKDOWN_BYPASS_PATTERN =
  /^(?:[ \t]*(?:>|[-+*]|\d{1,9}[.)]))*[ \t]*::[a-zA-Z]|`{3}|~{3}/mu;

export function repairStreamingMarkdownTail(tail: string): string {
  if (STREAMING_MARKDOWN_BYPASS_PATTERN.test(tail)) {
    return tail;
  }
  return remend(closeUnterminatedMarkdownCodeSpan(tail), {
    linkMode: "text-only",
    comparisonOperators: false,
    htmlTags: false,
    katex: false,
    setextHeadings: false,
    singleTilde: false,
  });
}

const MATH_DELIMITER = "$$";

function countOccurrences(line: string, needle: string): number {
  let count = 0;
  let index = line.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = line.indexOf(needle, index + needle.length);
  }
  return count;
}

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

export function splitStreamingMarkdown(
  text: string,
): StreamingMarkdownSplit | null {
  const lines = text.split("\n");
  const lastCompleteLineIndex = lines.length - 2;
  let openFence: MarkdownFence | null = null;
  let mathOpen = false;
  let lastNonBlankLine: string | null = null;
  let boundaryLineIndex = -1;

  for (let index = 0; index <= lastCompleteLineIndex; index += 1) {
    const line = lines[index] ?? "";
    if (openFence !== null) {
      if (closesAnyIndentMarkdownFence(line, openFence)) {
        openFence = null;
      }
      lastNonBlankLine = line;
      continue;
    }
    if (mathOpen) {
      if (countOccurrences(line, MATH_DELIMITER) % 2 === 1) {
        mathOpen = false;
      }
      lastNonBlankLine = line;
      continue;
    }
    if (isBlankLine(line)) {
      if (index + 1 > lastCompleteLineIndex) {
        continue;
      }
      const nextLine = lines[index + 1] ?? "";
      if (MARKDOWN_INDENTED_CONTINUATION_PATTERN.test(nextLine)) {
        continue;
      }
      if (
        lastNonBlankLine !== null &&
        isMarkdownListLikeLine(lastNonBlankLine) &&
        MARKDOWN_LIST_MARKER_PATTERN.test(nextLine)
      ) {
        continue;
      }
      if (lastNonBlankLine === null) {
        continue;
      }
      boundaryLineIndex = index;
      continue;
    }
    lastNonBlankLine = line;
    const fence = parseAnyIndentMarkdownFenceStart(line);
    if (fence !== null) {
      openFence = fence;
      continue;
    }
    if (countOccurrences(line, MATH_DELIMITER) % 2 === 1) {
      mathOpen = true;
    }
  }

  if (boundaryLineIndex === -1) {
    return null;
  }
  let settledLength = 0;
  for (let index = 0; index <= boundaryLineIndex; index += 1) {
    settledLength += (lines[index] ?? "").length + 1;
  }
  return {
    settled: text.slice(0, settledLength),
    tail: text.slice(settledLength),
  };
}
