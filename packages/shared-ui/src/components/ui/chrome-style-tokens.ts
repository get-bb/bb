export const CHROME_SECTION_LABEL_CLASS =
  "text-xs font-normal leading-5 text-subtle-foreground/75";

export const SIDEBAR_DISCLOSURE_ACTION_CLASS =
  "text-sm leading-5 text-subtle-foreground [&>[data-icon-root]]:size-3.5";

export const CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS =
  "text-subtle-foreground/75 hover:text-muted-foreground data-[state=open]:text-subtle-foreground/75";

export const CONTEXT_CARD_CLASS =
  "rounded-lg border border-border bg-surface-raised-solid";

export const CONTEXT_CARD_INSET_CLASS = "p-1";

export const CONTEXT_CARD_SEGMENT_CLASS = "min-h-6 px-2 py-1 rounded";

export const CONTEXT_CARD_TOGGLE_CLASS =
  "flex cursor-pointer items-center text-xs transition-colors hover:bg-state-hover";

export const CONTEXT_CARD_CHEVRON_CLASS =
  "size-3.5 shrink-0 text-subtle-foreground transition-transform duration-200";

export const THREAD_CONTEXT_CARD_MENU_TRIGGER_CLASS =
  "flex size-5 shrink-0 items-center justify-center rounded text-subtle-foreground transition-colors hover:bg-state-active hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-state-active data-[state=open]:text-foreground max-md:pointer-coarse:size-8 [&_[data-icon-root]]:size-3.5";

export const THREAD_CONTEXT_CARD_MENU_CONTENT_CLASS = "md:w-72 md:min-w-72";

const THREAD_CONTEXT_CARD_MENU_GAP_PX = 6;

export interface ThreadContextCardMenuOffsets {
  sideOffset: number;
  alignOffset: number;
}

export function getThreadContextCardMenuOffsets(
  trigger: Element,
): ThreadContextCardMenuOffsets {
  const card = trigger.closest("[data-thread-context-card]");
  if (card === null) {
    return { sideOffset: THREAD_CONTEXT_CARD_MENU_GAP_PX, alignOffset: 0 };
  }
  const cardRect = card.getBoundingClientRect();
  const triggerRect = trigger.getBoundingClientRect();
  return {
    sideOffset:
      cardRect.bottom - triggerRect.bottom + THREAD_CONTEXT_CARD_MENU_GAP_PX,
    alignOffset: triggerRect.right - cardRect.right,
  };
}
