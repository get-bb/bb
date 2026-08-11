/**
 * Split a growing Markdown body only at boundaries that are safe to parse as
 * independent documents. Completed segments stay byte-stable as text is
 * appended, so Streamdown can skip their unified parse on later updates.
 */

export interface SplitMarkdownStreamSegmentsOptions {
  /** Coalesce short blocks to avoid creating many parser instances. */
  minSegmentChars?: number;
}

const DEFAULT_MIN_SEGMENT_CHARS = 500;
const FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,}|:{3,})(.*)$/;
const FENCE_CLOSE_PATTERN = /^ {0,3}(`{3,}|~{3,}|:{3,})[ \t]*$/;
const MATH_FENCE_PATTERN = /^ {0,3}\$\$/;
const MATH_FENCE_CLOSE_PATTERN = /^ {0,3}\$\$[ \t]*$/;
const HTML_COMMENT_OPEN_PATTERN = /^ {0,3}<!--/;
const HTML_RAW_TAG_OPEN_PATTERN = /^ {0,3}<(script|pre|style|textarea)\b/i;
// Link references and footnotes resolve across the full document. Any
// definition makes independent parsing unsafe, so keep the body in one block.
const LINK_DEFINITION_PATTERN = /^ {0,3}\[[^\]]*\]:/;
// Message-directive limits are per full message. Independent parser blocks
// would each receive a fresh limit, so any directive syntax stays one block.
const DIRECTIVE_PATTERN = /^ {0,3}:{2,}[A-Za-z]/;
// Blank lines can occur inside one loose list. Without complete list-state
// tracking, never place a boundary immediately before another list item.
const LIST_MARKER_PATTERN = /^(?:[*+-](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$))/;
const BLANK_LINE_PATTERN = /^[ \t]*$/;

interface FenceState {
  marker: string;
  minLength: number;
}

export function splitMarkdownStreamSegments(
  body: string,
  options?: SplitMarkdownStreamSegmentsOptions,
): string[] {
  const minSegmentChars = options?.minSegmentChars ?? DEFAULT_MIN_SEGMENT_CHARS;
  const boundaries: number[] = [];
  let fence: FenceState | null = null;
  let mathFence = false;
  let htmlBlockClose: RegExp | null = null;
  let pendingBoundary = false;
  let offset = 0;

  while (offset < body.length) {
    const newlineIndex = body.indexOf("\n", offset);
    const terminated = newlineIndex !== -1;
    const rawLine = terminated
      ? body.slice(offset, newlineIndex)
      : body.slice(offset);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    if (fence !== null) {
      const close = FENCE_CLOSE_PATTERN.exec(line);
      if (
        close !== null &&
        close[1][0] === fence.marker &&
        close[1].length >= fence.minLength
      ) {
        fence = null;
      }
      pendingBoundary = false;
    } else if (mathFence) {
      if (MATH_FENCE_CLOSE_PATTERN.test(line)) {
        mathFence = false;
      }
      pendingBoundary = false;
    } else if (htmlBlockClose !== null) {
      if (htmlBlockClose.test(line)) {
        htmlBlockClose = null;
      }
      pendingBoundary = false;
    } else if (BLANK_LINE_PATTERN.test(line)) {
      pendingBoundary = true;
    } else {
      if (pendingBoundary) {
        pendingBoundary = false;
        // The current line can still become a list marker while it streams.
        // Wait for its newline before freezing the preceding segment.
        const indented = line.startsWith(" ") || line.startsWith("\t");
        if (terminated && !indented && !LIST_MARKER_PATTERN.test(line)) {
          boundaries.push(offset);
        }
      }

      if (LINK_DEFINITION_PATTERN.test(line)) {
        return [body];
      }
      if (DIRECTIVE_PATTERN.test(line)) {
        return [body];
      }

      const fenceOpen = FENCE_OPEN_PATTERN.exec(line);
      if (
        fenceOpen !== null &&
        !(fenceOpen[1][0] === "`" && fenceOpen[2].includes("`"))
      ) {
        fence = { marker: fenceOpen[1][0], minLength: fenceOpen[1].length };
      } else if (
        MATH_FENCE_PATTERN.test(line) &&
        !line.replace(MATH_FENCE_PATTERN, "").includes("$$")
      ) {
        mathFence = true;
      } else if (HTML_COMMENT_OPEN_PATTERN.test(line)) {
        if (!line.includes("-->")) {
          htmlBlockClose = /-->/;
        }
      } else {
        const rawTag = HTML_RAW_TAG_OPEN_PATTERN.exec(line);
        if (rawTag !== null) {
          const closePattern = new RegExp(`</${rawTag[1]}`, "i");
          if (!closePattern.test(line)) {
            htmlBlockClose = closePattern;
          }
        }
      }
    }

    offset = terminated ? newlineIndex + 1 : body.length;
  }

  const segments: string[] = [];
  let start = 0;
  for (const boundary of boundaries) {
    if (boundary - start >= minSegmentChars) {
      segments.push(body.slice(start, boundary));
      start = boundary;
    }
  }
  segments.push(body.slice(start));
  return segments;
}
