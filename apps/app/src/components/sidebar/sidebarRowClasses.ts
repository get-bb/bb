import { COARSE_POINTER_DOT_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing.js";

export type SidebarUnreadDotTone = "default" | "error";

export const SIDEBAR_ROW_BASE_CLASS =
  "flex w-full items-center gap-2 rounded-md pr-0 text-sm transition-colors";

/**
 * Leading-glyph slot shared by sidebar rows (manager icon/chevron, worktree
 * header icon, app-row icon): centers the glyph and paints it in the subtle
 * foreground used for non-status row affordances. Call sites add the glyph box
 * sizing and any positioning they need.
 */
export const SIDEBAR_ROW_GLYPH_SLOT_CLASS =
  "inline-flex shrink-0 items-center justify-center text-subtle-foreground";

/**
 * The unread dot shared by a leaf thread row and a collapsed worktree header.
 * Inner styling only — call sites own wrapper, positioning, fade, and the
 * aria-label.
 */
export const SIDEBAR_UNREAD_DOT_CLASS_BY_TONE: Record<
  SidebarUnreadDotTone,
  string
> = {
  default: `rounded-full bg-foreground ${COARSE_POINTER_DOT_SIZE_CLASS}`,
  error: `rounded-full bg-destructive ${COARSE_POINTER_DOT_SIZE_CLASS}`,
};

export const SIDEBAR_UNREAD_DOT_CLASS =
  SIDEBAR_UNREAD_DOT_CLASS_BY_TONE.default;

// One indentation system for every sidebar row (sections, projects, worktree
// groups, threads), expressed on the Tailwind spacing scale (4px unit) so it
// stays in the design system. Level-0 rows (projects and projectless threads)
// sit flush at the list edge; each deeper level adds one `spacing-3` step. Tune
// these two numbers to retune every row's indent uniformly.
const SIDEBAR_THREAD_ROW_BASE_PADDING_PX = 0; // spacing-0
const SIDEBAR_THREAD_ROW_DEPTH_STEP_PX = 12; // spacing-3
// Horizontal center of a row's leading caret box (`size-5`, no negative margin):
// 20/2.
const SIDEBAR_ROW_CARET_CENTER_OFFSET_PX = 10;

export const SIDEBAR_STANDARD_ROW_PADDING_CLASS = "pl-2";

export function getSidebarThreadRowPaddingLeft(depth: number): number {
  return (
    SIDEBAR_THREAD_ROW_BASE_PADDING_PX +
    depth * SIDEBAR_THREAD_ROW_DEPTH_STEP_PX
  );
}

// The indent guide runs on the CHILDREN's caret column — one depth step in from
// the parent header — so it sits centered in the indent space, under the
// header's glyph, flush with where the indented children begin.
export function getSidebarThreadGroupLineLeft(parentDepth: number): number {
  return (
    getSidebarThreadRowPaddingLeft(parentDepth + 1) +
    SIDEBAR_ROW_CARET_CENTER_OFFSET_PX
  );
}

export const SIDEBAR_ROW_INTERACTIVE_STATE_CLASS =
  "text-sidebar-foreground/85 dark:text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
