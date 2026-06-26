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

export const SIDEBAR_WORKING_STATUS_COLOR_CLASS = "text-muted-foreground/50";

export const SIDEBAR_SUCCESS_STATUS_COLOR_CLASS = "text-muted-foreground/60";

export const SIDEBAR_SUCCESS_STATUS_ICON_SIZE_CLASS =
  "size-3.5 max-md:pointer-coarse:size-4";

export const SIDEBAR_SUCCESS_STATUS_DOT_CLASS =
  "size-[5px] rounded-full bg-muted-foreground/60 max-md:pointer-coarse:size-1.5";

// Identity-glyph slot: the folder / worktree icon box on a disclosure header.
export const SIDEBAR_LEADING_GLYPH_SLOT_CLASS =
  "inline-flex w-4 shrink-0 items-center justify-center";

const SIDEBAR_THREAD_ROW_BASE_PADDING_PX = 8;
const SIDEBAR_THREAD_ROW_DEPTH_STEP_PX = 24;
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
  "cursor-pointer text-sidebar-foreground/85 dark:text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

// Header rows whose caret (not the row body) is the click target: project and
// folder rows. Text color only — no row-level hover highlight.
export const SIDEBAR_ROW_STATIC_STATE_CLASS =
  "text-sidebar-foreground/85 dark:text-sidebar-foreground";

export const SIDEBAR_ROW_SELECTED_STATE_CLASS =
  "bg-sidebar-border/70 text-sidebar-foreground";

export const SIDEBAR_MORE_ACTION_TRIGGER_CLASS =
  "relative m-1 h-5 w-5 after:absolute after:left-1/2 after:top-1/2 after:h-7 after:w-7 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] max-md:pointer-coarse:m-0 max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9 max-md:pointer-coarse:after:hidden";

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
  "before:pointer-events-none before:absolute before:bottom-0 before:left-4 before:top-0 before:z-[45] before:w-px before:bg-border-hairline before:opacity-70 before:content-[''] max-md:pointer-coarse:before:left-5";
