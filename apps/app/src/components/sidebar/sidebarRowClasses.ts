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

// ===========================================================================
// Sidebar leading-column geometry — one system.
//
// Every disclosure row (project, worktree group, thread) lays out its leading
// column identically: a caret box, a gap, an optional identity-glyph box, then
// the title/label. Each class token below is paired with its px equivalent —
// the JSX renders from the class, the indent-guide position is DERIVED from the
// px, so the guide can never drift from the rendered layout. Retune the column
// by editing a pair here, and everything (rows + guide) moves together.
// ===========================================================================

// Caret box: the disclosure chevron, and the equal-width spacer leaf rows use
// so their titles stay in the caret rows' column.
export const SIDEBAR_CARET_BOX_CLASS = "size-5";
const SIDEBAR_CARET_BOX_PX = 20;

// Flex wrapper for a row's leading column. Its `gap-1.5` is the gap between
// every cluster child (caret → glyph → title); keep it equal to the px below.
// Call sites add row-specific extras (positioning, text tone) via cn().
export const SIDEBAR_LEADING_CLUSTER_CLASS =
  "flex min-w-0 flex-1 items-center gap-1.5";
const SIDEBAR_LEADING_GAP_PX = 6; // the cluster's gap-1.5

// Identity-glyph slot: the fork / worktree / no-project / folder icon box.
export const SIDEBAR_LEADING_GLYPH_SLOT_CLASS =
  "inline-flex w-4 shrink-0 items-center justify-center";
const SIDEBAR_GLYPH_BOX_PX = 16; // the slot's w-4

// Indentation (Tailwind spacing scale, 4px unit): a small base inset keeps even
// level-0 rows' carets off the row's rounded edge (so a hovered caret's
// background floats inside the row selection instead of clashing with its
// corner); each deeper level adds one `spacing-3` step.
const SIDEBAR_THREAD_ROW_BASE_PADDING_PX = 4; // spacing-1
const SIDEBAR_THREAD_ROW_DEPTH_STEP_PX = 12; // spacing-3

// Indent-guide x = the parent glyph's horizontal center: caret box + gap + half
// the glyph box. Derived from the geometry above, never hand-tuned.
const SIDEBAR_ROW_GLYPH_CENTER_OFFSET_PX =
  SIDEBAR_CARET_BOX_PX + SIDEBAR_LEADING_GAP_PX + SIDEBAR_GLYPH_BOX_PX / 2;

export const SIDEBAR_STANDARD_ROW_PADDING_CLASS = "pl-2";

export function getSidebarThreadRowPaddingLeft(depth: number): number {
  return (
    SIDEBAR_THREAD_ROW_BASE_PADDING_PX +
    depth * SIDEBAR_THREAD_ROW_DEPTH_STEP_PX
  );
}

// The indent guide runs straight down under the parent header's leading glyph
// (folder / no-project / worktree icon), so its nested children read as
// branching out from that icon.
export function getSidebarThreadGroupLineLeft(parentDepth: number): number {
  return (
    getSidebarThreadRowPaddingLeft(parentDepth) +
    SIDEBAR_ROW_GLYPH_CENTER_OFFSET_PX
  );
}

export const SIDEBAR_ROW_INTERACTIVE_STATE_CLASS =
  "text-sidebar-foreground/85 dark:text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
