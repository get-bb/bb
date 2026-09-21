import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  COARSE_POINTER_ROW_HEIGHT_CLASS,
  COARSE_POINTER_CHILD_ICON_BUTTON_CLASS,
  COARSE_POINTER_DOT_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import { CONTEXT_SELECTION_SURFACE_CLASS } from "@/components/ui/context-selection";
import { SIDEBAR_HOVER_ACTIONS_GAP_CLASS } from "@/components/ui/sidebar-hover-actions";

export const SIDEBAR_ROW_BASE_CLASS =
  "flex w-full items-center gap-2 rounded-md pr-0 text-sm transition-colors";

export const SIDEBAR_ROW_GLYPH_SLOT_CLASS =
  "inline-flex shrink-0 items-center justify-center text-subtle-foreground";

export const SIDEBAR_STATUS_ICON_CLASS = "size-4";

export const SIDEBAR_STATUS_GLYPH_BOX_CLASS = "h-4 w-4";

export const SIDEBAR_UNREAD_DOT_CLASS = `rounded-full bg-foreground ${COARSE_POINTER_DOT_SIZE_CLASS}`;

export const SIDEBAR_WORKING_STATUS_COLOR_CLASS = "text-muted-foreground/50";

export const SIDEBAR_SUCCESS_STATUS_COLOR_CLASS = "text-success-foreground";

export const SIDEBAR_SUCCESS_STATUS_DOT_CLASS =
  "size-[5px] rounded-full bg-muted-foreground/60 max-md:pointer-coarse:size-1.5";

const SIDEBAR_THREAD_ROW_BASE_PADDING_PX = 8;
const SIDEBAR_THREAD_ROW_DEPTH_STEP_PX = 24;
const SIDEBAR_THREAD_ROW_GLYPH_CENTER_OFFSET_PX = 8;

export const SIDEBAR_STANDARD_ROW_PADDING_CLASS = "pl-2";

export const SIDEBAR_ROW_TEXT_CLASS = "text-sidebar-foreground";

export const SIDEBAR_GROUP_TEXT_CLASS = "text-muted-foreground";

export const SIDEBAR_CONTROL_TONE_CLASS =
  "text-subtle-foreground hover:text-muted-foreground focus-visible:text-muted-foreground data-[state=open]:text-muted-foreground";

export const SIDEBAR_CONTROL_STATE_CLASS = `${SIDEBAR_CONTROL_TONE_CLASS} hover:bg-state-hover focus-visible:bg-state-hover active:bg-state-active data-[state=open]:bg-state-active data-[state=open]:hover:bg-state-active data-[state=open]:focus-visible:bg-state-active`;

const SIDEBAR_CONTROL_BUTTON_BASE_CLASS = `${SIDEBAR_CONTROL_STATE_CLASS} relative m-0 shrink-0 cursor-pointer rounded-md p-0 outline-none focus-visible:ring-0`;

export const SIDEBAR_CONTROL_BUTTON_CLASS = `${COARSE_POINTER_ROW_ACTION_SIZE_CLASS} ${SIDEBAR_CONTROL_BUTTON_BASE_CLASS}`;

export const SIDEBAR_CONTROL_PRIMARY_BUTTON_CLASS = `h-7 w-7 max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-8 ${SIDEBAR_CONTROL_BUTTON_BASE_CLASS}`;

export const SIDEBAR_CONTROL_PAIR_GAP_CLASS = `${SIDEBAR_HOVER_ACTIONS_GAP_CLASS} max-md:pointer-coarse:gap-0`;

export const SIDEBAR_CONTROL_PAIR_SIZE_CLASS =
  "h-7 w-[3.625rem] max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-[4.25rem]";

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

export const SIDEBAR_ROW_INTERACTIVE_STATE_CLASS = `cursor-pointer ${SIDEBAR_ROW_TEXT_CLASS} hover:bg-sidebar-accent hover:text-sidebar-accent-foreground`;

export const SIDEBAR_ROW_SELECTED_STATE_CLASS = `${CONTEXT_SELECTION_SURFACE_CLASS} bb-sidebar-selected-row ${SIDEBAR_ROW_TEXT_CLASS}`;

export const SIDEBAR_ROW_OPEN_IN_SPLIT_STATE_CLASS =
  "bb-sidebar-open-in-split-row";

export const SIDEBAR_FOOTER_ACTION_CLASS = cn(
  COARSE_POINTER_ROW_HEIGHT_CLASS,
  COARSE_POINTER_CHILD_ICON_BUTTON_CLASS,
  "text-muted-foreground hover:text-sidebar-foreground [&>[data-icon-root]]:opacity-80",
);

export const SIDEBAR_MORE_ACTION_TRIGGER_CLASS =
  "relative m-1 h-5 w-5 after:absolute after:left-1/2 after:top-1/2 after:h-7 after:w-7 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] max-md:pointer-coarse:m-0 max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9 max-md:pointer-coarse:after:hidden";

export const SIDEBAR_PROJECT_GROUP_LINE_CLASS =
  "before:pointer-events-none before:absolute before:bottom-0 before:left-4 before:top-0 before:z-[45] before:w-px before:bg-border-hairline before:opacity-70 before:content-[''] max-md:pointer-coarse:before:left-5";

export const PROJECT_LIST_ACTION_BUTTON_CLASS = cn(
  SIDEBAR_ROW_BASE_CLASS,
  LIST_HOVER_TRANSITION,
  SIDEBAR_STANDARD_ROW_PADDING_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
  "min-w-0 cursor-pointer justify-start overflow-hidden font-normal ring-sidebar-ring focus-visible:ring-2 disabled:cursor-default disabled:opacity-70 max-md:pointer-coarse:[&_[data-icon-root]]:size-5",
);
