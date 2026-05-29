import { COARSE_POINTER_DOT_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing.js";

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
 * The unread "attention" dot shared by a leaf thread row and a collapsed
 * worktree header. Inner styling only — call sites own wrapper, positioning,
 * fade, and the aria-label.
 */
export const SIDEBAR_UNREAD_DOT_CLASS = `rounded-full bg-primary ${COARSE_POINTER_DOT_SIZE_CLASS}`;

export const SIDEBAR_STANDARD_ROW_PADDING_CLASS = "pl-2";

export const SIDEBAR_PROJECT_THREAD_ROW_PADDING_CLASS = "pl-8";

export const SIDEBAR_MANAGER_ROW_PADDING_CLASS = "pl-8";

export const SIDEBAR_MANAGER_CHILD_ROW_PADDING_CLASS = "pl-14";

export const SIDEBAR_MANAGER_ENV_GROUPED_CHILD_ROW_PADDING_CLASS = "pl-20";

export type SidebarThreadRowIndent =
  | "root"
  | "project-child"
  | "nested-child"
  | "deep-child";

export function getSidebarThreadRowPaddingClass(
  indent: SidebarThreadRowIndent,
): string {
  if (indent === "root") return SIDEBAR_STANDARD_ROW_PADDING_CLASS;
  if (indent === "project-child") {
    return SIDEBAR_PROJECT_THREAD_ROW_PADDING_CLASS;
  }
  if (indent === "nested-child") return SIDEBAR_MANAGER_CHILD_ROW_PADDING_CLASS;
  return SIDEBAR_MANAGER_ENV_GROUPED_CHILD_ROW_PADDING_CLASS;
}

export const SIDEBAR_ROW_INTERACTIVE_STATE_CLASS =
  "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

/**
 * Hairline that runs through an expanded project's thread list, sitting
 * under the center of the project chevron/folder icon. The coarse-pointer
 * variant nudges the line a few px right to follow the larger icon.
 *
 * Z-index sits between the manager (z-40) and project (z-50) sticky tiers
 * so the line paints over manager rows and ordinary thread rows (showing
 * through their hover/active backgrounds) but a stuck project row covers
 * it cleanly.
 */
export const SIDEBAR_PROJECT_GROUP_LINE_CLASS =
  "before:pointer-events-none before:absolute before:bottom-0 before:left-4 before:top-0 before:z-[45] before:w-px before:bg-border-hairline before:content-[''] max-md:pointer-coarse:before:left-5";

export const SIDEBAR_SECTION_GROUP_LINE_CLASS =
  "before:pointer-events-none before:absolute before:bottom-0 before:left-4 before:top-0 before:z-30 before:w-px before:bg-border-hairline before:content-[''] max-md:pointer-coarse:before:left-5";

/**
 * Hairline that runs through a manager's managed-child list, sitting under
 * the center of the manager's user icon. Z-index sits below both the
 * manager (z-40), env (z-35), and project (z-50) sticky tiers so a stuck
 * parent row covers the line, while ordinary thread rows still let it show
 * through their hover/active backgrounds.
 */
export const SIDEBAR_MANAGER_GROUP_LINE_CLASS =
  "before:pointer-events-none before:absolute before:bottom-0 before:left-10 before:top-0 before:z-30 before:w-px before:bg-border-hairline before:content-['']";

/**
 * Hairline that runs through an env sub-group nested inside a manager.
 * Sits under the center of the sub-group header's worktree glyph at the
 * managed-child indent (pl-14), so the line lands at left-16. It stays below
 * the env sticky tier (z-35).
 */
export const SIDEBAR_MANAGED_ENV_GROUP_LINE_CLASS =
  "before:pointer-events-none before:absolute before:bottom-0 before:left-16 before:top-0 before:z-30 before:w-px before:bg-border-hairline before:content-['']";

/**
 * Bridges the manager hairline across a nested env sub-group header. That header
 * is an opaque sticky tier (z-35) sitting above the manager line (z-30), and it
 * also paints a `child-row-gap` shield directly below itself, so the line is
 * hidden behind both the header box and that bottom shield. This continuation
 * redraws the line over both: `top-0` + `-bottom-0.5` spans the header plus the
 * 0.125rem shield (= --bb-sidebar-sticky-child-row-gap) so the hairline stays
 * unbroken into the first child row.
 */
export const SIDEBAR_MANAGER_LINE_CONTINUATION_CLASS =
  "pointer-events-none absolute -bottom-0.5 left-10 top-0 z-[1] w-px bg-border-hairline";

export const SIDEBAR_SECTION_LINE_CONTINUATION_CLASS =
  "pointer-events-none absolute -bottom-0.5 left-4 top-0 z-[1] w-px bg-border-hairline max-md:pointer-coarse:left-5";
