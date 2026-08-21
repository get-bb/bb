/**
 * Pure helpers for `TerminalOutputBlock`: which lines are visible when the
 * output is collapsed. The collapsed view keeps the *tail* so streaming
 * output behaves like the web's sticky-bottom scroll without a nested
 * vertical scroll view.
 */

/**
 * Lines shown before output collapses. The web caps the block at 288px ≈ 16
 * lines of `text-xs leading-tight`; phones have a taller viewport ratio, so
 * the cap is a little more generous.
 */
export const TERMINAL_DEFAULT_MAX_LINES = 24;
/** Below this many hidden lines, collapsing is not worth a button row. */
const TERMINAL_COLLAPSE_SLACK = 6;

export interface TerminalTail<T> {
  visible: readonly T[];
  /** Lines hidden above `visible` (0 when everything is shown). */
  hiddenLines: number;
}

export function selectTerminalTail<T>(
  lines: readonly T[],
  maxLines: number,
  expanded: boolean,
): TerminalTail<T> {
  if (
    expanded ||
    !Number.isFinite(maxLines) ||
    lines.length <= maxLines + TERMINAL_COLLAPSE_SLACK
  ) {
    return { visible: lines, hiddenLines: 0 };
  }
  const hiddenLines = lines.length - maxLines;
  return { visible: lines.slice(hiddenLines), hiddenLines };
}
