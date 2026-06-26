import { Icon } from "@/components/ui/icon.js";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { cn } from "@/lib/utils";
import { CONTROL_HOVER_TRANSITION } from "./motion.js";
import type { ReactNode } from "react";

const TAB_PILL_DEFAULT_LABEL_MAX_WIDTH_CLASS = "max-w-[180px]";
const TAB_PILL_AFFORDANCE_BUTTON_BASE_CLASS =
  "inline-flex size-4 shrink-0 items-center justify-center rounded transition-opacity hover:bg-muted-foreground/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none max-md:pointer-coarse:size-5";
export const TAB_PILL_AFFORDANCE_ICON_CLASS =
  "size-3.5 max-md:pointer-coarse:size-5";
export const TAB_PILL_CLOSE_BUTTON_CLASS = `pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 bg-inherit ${TAB_PILL_AFFORDANCE_BUTTON_BASE_CLASS} opacity-0 hover:opacity-100 group-hover/tab-pill:pointer-events-auto group-hover/tab-pill:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 disabled:opacity-30 max-md:pointer-coarse:pointer-events-auto max-md:pointer-coarse:opacity-100`;
const TAB_PILL_LEADING_VISUAL_CLASS =
  "mr-1.5 inline-flex size-4 shrink-0 items-center justify-center transition-opacity [&_svg]:size-3.5 max-md:pointer-coarse:size-5 max-md:pointer-coarse:[&_svg]:size-5";

export interface TabPillCloseAction {
  onClose: () => void;
  closeLabel: string;
  closeTooltip: string;
  isClosing?: boolean;
}

export interface TabPillProps {
  label: string;
  leadingVisual?: ReactNode;
  secondaryLabel?: string | null;
  /** Extra classes for the label text (e.g. `line-through` for a done tab). */
  labelClassName?: string;
  title: string;
  isActive: boolean;
  onSelect: () => void;
  labelMaxWidthClass?: string;
  closeAction: TabPillCloseAction | null;
}

export function TabPill({
  label,
  leadingVisual,
  secondaryLabel = null,
  labelClassName,
  title,
  isActive,
  onSelect,
  labelMaxWidthClass = TAB_PILL_DEFAULT_LABEL_MAX_WIDTH_CLASS,
  closeAction,
}: TabPillProps) {
  return (
    <div
      className={cn(
        `group/tab-pill relative inline-flex h-7 shrink-0 items-center rounded-md ${CONTROL_HOVER_TRANSITION} max-md:pointer-coarse:h-9`,
        COARSE_POINTER_TEXT_SM_CLASS,
        isActive
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-state-hover",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isActive}
        className="flex h-full min-w-0 items-center rounded-md pl-2 pr-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {leadingVisual ? (
          <span
            className={cn(
              TAB_PILL_LEADING_VISUAL_CLASS,
              closeAction
                ? "group-hover/tab-pill:opacity-0 group-has-[[data-tab-pill-close]:focus-visible]/tab-pill:opacity-0 max-md:pointer-coarse:opacity-0"
                : null,
            )}
          >
            {leadingVisual}
          </span>
        ) : null}
        <span
          className={cn("truncate", labelMaxWidthClass, labelClassName)}
          title={title}
        >
          {label}
        </span>
        {secondaryLabel ? (
          <span className="ml-1 shrink-0 text-muted-foreground">
            {secondaryLabel}
          </span>
        ) : null}
      </button>
      {closeAction ? (
        <button
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onClick={closeAction.onClose}
          disabled={closeAction.isClosing}
          aria-label={closeAction.closeLabel}
          data-tab-pill-close
          className={TAB_PILL_CLOSE_BUTTON_CLASS}
        >
          {closeAction.isClosing ? (
            <Icon
              name="Spinner"
              className={`${TAB_PILL_AFFORDANCE_ICON_CLASS} animate-spin`}
            />
          ) : (
            <Icon name="X" className={TAB_PILL_AFFORDANCE_ICON_CLASS} />
          )}
        </button>
      ) : null}
    </div>
  );
}
