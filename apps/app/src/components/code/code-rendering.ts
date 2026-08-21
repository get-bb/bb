import type {
  CodeOverflowMode,
  DiffViewMode,
  SourceCodeLineRange,
} from "@get-bb/plugin-sdk";
import type { ParsedGitDiffFile } from "@/components/git-diff/git-diff-parsing";

/**
 * Internal contracts for the two host-owned code renderers.
 *
 * The host boundary splits every render into two halves. The *semantic* half
 * (`SourceCodePresentation` / `DiffPresentation` plus the content) is what a
 * plugin replacement receives — fully resolved, with no BB implementation
 * types in it. The *host-only* half (pre-parsed diff files, selection-to-chat,
 * layout classes) never leaves BB, so replacing a renderer can never make a
 * plugin responsible for BB product behavior it cannot implement.
 *
 * This module is types plus two literals: importing it must never pull the
 * renderer graph (`@pierre/diffs` and Shiki behind it) onto a caller's chunk.
 */

export const DEFAULT_CODE_OVERFLOW: CodeOverflowMode = "scroll";
export const DEFAULT_DIFF_VIEW: DiffViewMode = "unified";

/** Presentation the host resolved for one source render. */
interface SourceCodePresentation {
  overflow: CodeOverflowMode;
  highlightedLines: SourceCodeLineRange | null;
}

/** Presentation the host resolved for one diff render. */
export interface DiffPresentation {
  view: DiffViewMode;
  overflow: CodeOverflowMode;
  showLineNumbers: boolean;
}

/** Props BB's default source renderer receives from {@link SourceCodeHost}. */
export interface BbSourceCodeProps extends SourceCodePresentation {
  content: string;
  path: string;
  /**
   * Stable identity for the highlighter's result cache. Defaults to `path`;
   * callers that re-render the same path with different bytes (a file reloaded
   * at a new revision) pass their own.
   */
  cacheKey?: string;
  className?: string;
  /**
   * Scroll the first highlighted line into view once it renders. The file
   * preview wants it for `?L12` deep links; an inline snippet does not.
   */
  scrollToHighlightedLines?: boolean;
  onSelectionAddToChat?: (text: string) => void;
}

/** Props BB's default diff renderer receives from {@link DiffHost}. */
export interface BbDiffProps extends DiffPresentation {
  /**
   * The diff to draw. Already parsed — and possibly enriched with full file
   * contents for context expansion — by the caller, which also needs it for
   * its own header.
   */
  file: ParsedGitDiffFile;
  className?: string;
  /**
   * How many unchanged lines each expand-context click reveals. Set ONLY by a
   * caller that can attach full file contents to `file`: pierre renders an
   * empty diff when it is given an expansion budget for a hunk-only patch,
   * which is what the timeline supplies.
   */
  expansionLineCount?: number;
  onSelectionAddToChat?: (text: string) => void;
}
