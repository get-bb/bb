/**
 * Fenced-code detection, shared by the TOC builder and the decoration pass.
 *
 * Both need the same answer to "is this line prose?" — a `# comment` in a
 * shell block is neither a heading to list nor a heading to colour — and
 * keeping one implementation stops the two from disagreeing.
 */

const FENCE = /^[ \t]*(```+|~~~+)/;

/**
 * Line numbers (1-based) that sit inside a fenced code block, including the
 * fence lines themselves.
 *
 * A closing fence must be at least as long as the one that opened it, which
 * is what lets a block delimited by ```` contain a bare ``` line. An
 * unclosed fence runs to the end of the document, matching how CommonMark
 * and every editor renders it.
 */
export function fencedCodeLines(lines: readonly string[]): ReadonlySet<number> {
  const fenced = new Set<number>();
  let openMarker: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = FENCE.exec(line);
    const marker = match?.[1];

    if (openMarker === null) {
      if (marker !== undefined) {
        openMarker = marker;
        fenced.add(index + 1);
      }
      continue;
    }

    fenced.add(index + 1);
    if (
      marker !== undefined &&
      marker[0] === openMarker[0] &&
      marker.length >= openMarker.length
    ) {
      openMarker = null;
    }
  }

  return fenced;
}
