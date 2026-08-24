/**
 * Rendering budget for BB's source renderer.
 *
 * Tokenizing and laying out a 20k-line file is what stalls iOS Safari, so the
 * renderer paints a leading prefix until the reader asks for the whole file.
 * The rule lives here, apart from the renderer itself, because it is pure and
 * the file preview's tests assert it directly — importing it must never pull
 * the `@pierre/diffs` chunk.
 */

export const SOURCE_CODE_MAX_LINES = 5_000;
const SOURCE_CODE_MAX_CHARS = 512 * 1024;

export interface SourceCodeTruncation {
  /** The rendered prefix, cut at a line boundary. */
  contents: string;
  renderedLineCount: number;
  totalLineCount: number;
}

// FNV-1a over the contents, prefixed with the length; used to fold file
// contents into a highlight cache key.
export function hashSourceContents(contents: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < contents.length; index += 1) {
    hash ^= contents.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${contents.length}:${(hash >>> 0).toString(36)}`;
}

function countLines(contents: string): number {
  if (contents.length === 0) return 0;
  let count = 1;
  for (let index = contents.indexOf("\n"); index !== -1; ) {
    count += 1;
    index = contents.indexOf("\n", index + 1);
  }
  return contents.endsWith("\n") ? count - 1 : count;
}

/**
 * Decide whether a source render exceeds {@link SOURCE_CODE_MAX_LINES} or
 * {@link SOURCE_CODE_MAX_CHARS} and, if so, return the leading prefix
 * that fits both budgets. Returns `null` when the whole file fits.
 */
export function truncateSourceCode(
  contents: string,
): SourceCodeTruncation | null {
  const totalLineCount = countLines(contents);
  if (
    contents.length <= SOURCE_CODE_MAX_CHARS &&
    totalLineCount <= SOURCE_CODE_MAX_LINES
  ) {
    return null;
  }
  let renderedLineCount = 0;
  let cutIndex = 0;
  for (
    let lineStart = 0;
    lineStart < contents.length &&
    renderedLineCount < SOURCE_CODE_MAX_LINES;
  ) {
    const newlineIndex = contents.indexOf("\n", lineStart);
    const lineEnd = newlineIndex === -1 ? contents.length : newlineIndex;
    if (lineEnd > SOURCE_CODE_MAX_CHARS && renderedLineCount > 0) {
      break;
    }
    renderedLineCount += 1;
    cutIndex = lineEnd;
    lineStart = lineEnd + 1;
  }
  return {
    contents: contents.slice(0, cutIndex),
    renderedLineCount,
    totalLineCount,
  };
}
