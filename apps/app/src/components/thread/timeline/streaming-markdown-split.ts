/**
 * Splits an in-progress assistant message into a settled prefix and a live
 * tail so the timeline can render them as two memoized `MarkdownPreview`
 * instances: only the tail is re-parsed when the next delta arrives.
 *
 * The boundary is the last blank line that
 *  - is not inside an open fenced code block or `$$` math block,
 *  - is not inside a list (the next line is neither indented continuation
 *    nor a further list item), and
 *  - is followed by a complete line (one already terminated by `\n`), so the
 *    partially streamed last line can never make an earlier boundary
 *    eligible and later ineligible. Boundaries therefore only ever move
 *    forward while text is appended.
 *
 * Returns `null` when no such boundary exists (short messages, an open fence
 * spanning the whole text, ...) so the caller renders one document.
 */
export interface StreamingMarkdownSplit {
  settled: string;
  tail: string;
}

interface OpenFence {
  char: string;
  length: number;
}

const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/u;
const LIST_MARKER_PATTERN = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/u;
const INDENTED_CONTINUATION_PATTERN = /^(?: {2,}|\t)/u;
const MATH_DELIMITER = "$$";

function parseFenceOpen(line: string): OpenFence | null {
  const match = FENCE_PATTERN.exec(line);
  if (match === null) {
    return null;
  }
  const marker = match[1] ?? "";
  return { char: marker[0] ?? "`", length: marker.length };
}

function closesFence(line: string, fence: OpenFence): boolean {
  const match = FENCE_PATTERN.exec(line);
  if (match === null) {
    return false;
  }
  const marker = match[1] ?? "";
  if (marker[0] !== fence.char || marker.length < fence.length) {
    return false;
  }
  return line.slice(match[0].length).trim().length === 0;
}

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

function isListLike(line: string): boolean {
  return (
    LIST_MARKER_PATTERN.test(line) || INDENTED_CONTINUATION_PATTERN.test(line)
  );
}

export function splitStreamingMarkdown(
  text: string,
): StreamingMarkdownSplit | null {
  const lines = text.split("\n");
  // `lines[lines.length - 1]` is the unterminated last line (possibly empty).
  const lastCompleteLineIndex = lines.length - 2;
  let openFence: OpenFence | null = null;
  let mathOpen = false;
  let lastNonBlankLine: string | null = null;
  let boundaryLineIndex = -1;

  for (let index = 0; index <= lastCompleteLineIndex; index += 1) {
    const line = lines[index] ?? "";
    if (openFence !== null) {
      if (closesFence(line, openFence)) {
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
      // The line after the boundary must already be complete.
      if (index + 1 > lastCompleteLineIndex) {
        continue;
      }
      const nextLine = lines[index + 1] ?? "";
      if (INDENTED_CONTINUATION_PATTERN.test(nextLine)) {
        continue;
      }
      if (
        lastNonBlankLine !== null &&
        isListLike(lastNonBlankLine) &&
        LIST_MARKER_PATTERN.test(nextLine)
      ) {
        continue;
      }
      if (lastNonBlankLine === null) {
        // Leading blank lines: nothing settled yet.
        continue;
      }
      boundaryLineIndex = index;
      continue;
    }
    lastNonBlankLine = line;
    const fence = parseFenceOpen(line);
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
