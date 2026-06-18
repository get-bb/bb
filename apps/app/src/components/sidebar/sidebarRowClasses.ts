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

// Caret box: the disclosure chevron, and the equal-width spacer leaf rows use
// so their titles stay in the caret rows' column.
export const SIDEBAR_CARET_BOX_CLASS = "size-5";

// Flex wrapper for a disclosure header's leading column (caret → glyph →
// label), shared by the project header and the worktree group header. Call
// sites add row-specific extras (positioning, text tone) via cn().
export const SIDEBAR_LEADING_CLUSTER_CLASS =
  "flex min-w-0 flex-1 items-center gap-1.5";

// Identity-glyph slot: the folder / worktree icon box on a disclosure header.
export const SIDEBAR_LEADING_GLYPH_SLOT_CLASS =
  "inline-flex w-4 shrink-0 items-center justify-center";

const SIDEBAR_THREAD_ROW_BASE_PADDING_PX = 8;
const SIDEBAR_THREAD_ROW_DEPTH_STEP_PX = 16;
const SIDEBAR_THREAD_ROW_GLYPH_CENTER_OFFSET_PX = 8;

export const SIDEBAR_STANDARD_ROW_PADDING_CLASS = "pl-2";

export function getSidebarThreadRowPaddingLeft(depth: number): number {
  return (
    SIDEBAR_THREAD_ROW_BASE_PADDING_PX +
    depth * SIDEBAR_THREAD_ROW_DEPTH_STEP_PX
  );
}

export function getSidebarThreadGroupLineLeft(depth: number): number {
  return (
    getSidebarThreadRowPaddingLeft(depth) +
    SIDEBAR_THREAD_ROW_GLYPH_CENTER_OFFSET_PX
  );
}

export const SIDEBAR_ROW_INTERACTIVE_STATE_CLASS =
  "text-sidebar-foreground/85 dark:text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

export const SIDEBAR_ROW_SELECTED_STATE_CLASS =
  "bg-sidebar-accent text-sidebar-foreground";

/**
 * Hairline that runs through an expanded project's thread list, sitting
 * under the center of the project chevron/folder icon. The coarse-pointer
 * variant nudges the line a few px right to follow the larger icon.
 *
 * Z-index sits between the parent tiers (z-40 and below) and the project
 * tier (z-50) so the line paints over parent rows and ordinary thread rows
 * (showing through their hover/active backgrounds) but a stuck project row
 * covers it cleanly.
 */
export const SIDEBAR_PROJECT_GROUP_LINE_CLASS =
  "before:pointer-events-none before:absolute before:bottom-0 before:left-4 before:top-0 before:z-[45] before:w-px before:bg-border-hairline before:opacity-40 before:content-[''] max-md:pointer-coarse:before:left-5";
