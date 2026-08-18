import { Icon } from "@bb/shared-ui/icon";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import type { ReactNode } from "react";
import { CONTEXT_SELECTION_SURFACE_CLASS } from "./context-selection";

const TAB_PILL_DEFAULT_LABEL_MAX_WIDTH_CLASS = "max-w-[180px]";
// No transition: the tab strip is a swept, list-like row, so the affordance
// reveal (icon→close) and the close button's own hover tile both snap instantly,
// matching the pill's instant hover (LIST_HOVER_TRANSITION) instead of trailing
// the pointer. The instant swap also removes the icon/close cross-fade overlap,
// so the close button needs no background to mask the icon underneath it.
const TAB_PILL_AFFORDANCE_BUTTON_BASE_CLASS =
  "inline-flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted-foreground/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none max-md:pointer-coarse:size-5";
export const TAB_PILL_AFFORDANCE_ICON_CLASS =
  "size-3.5 max-md:pointer-coarse:size-5";
export const TAB_PILL_CLOSE_BUTTON_CLASS = `pointer-events-none absolute left-1.5 top-1/2 z-10 -translate-y-1/2 ${TAB_PILL_AFFORDANCE_BUTTON_BASE_CLASS} opacity-0 hover:opacity-100 group-hover/tab-pill:pointer-events-auto group-hover/tab-pill:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 disabled:opacity-30 max-md:pointer-coarse:pointer-events-auto max-md:pointer-coarse:opacity-100`;
const TAB_PILL_LEADING_VISUAL_CLASS =
  "inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5 max-md:pointer-coarse:size-5 max-md:pointer-coarse:[&_svg]:size-5";

export interface TabPillCloseAction {
  onClose: () => void;
  closeLabel: string;
  closeTooltip: string;
  isClosing?: boolean;
}

export interface TabPillProps {
  label: string;
  ariaLabel?: string;
  ariaKeyshortcuts?: string;
  iconOnly?: boolean;
  leadingVisual?: ReactNode;
  secondaryLabel?: string | null;
  /** Extra classes for the label text (e.g. `line-through` for a done tab). */
  labelClassName?: string;
  title: string;
  isActive: boolean;
  /**
   * Full-width panels use a quiet underline because the view already owns the
   * whole canvas; the filled selection surface is reserved for sibling panes.
   */
  activeTreatment?: "fill" | "underline";
  onSelect: () => void;
  labelMaxWidthClass?: string;
  closeAction: TabPillCloseAction | null;
}

export function TabPill({
  label,
  ariaLabel,
  ariaKeyshortcuts,
  iconOnly = false,
  leadingVisual,
  secondaryLabel = null,
  labelClassName,
  title,
  isActive,
  activeTreatment = "fill",
  onSelect,
  labelMaxWidthClass = TAB_PILL_DEFAULT_LABEL_MAX_WIDTH_CLASS,
  closeAction,
}: TabPillProps) {
  return (
    <div
      className={cn(
        `group/tab-pill relative inline-flex h-7 shrink-0 items-center rounded-md ${LIST_HOVER_TRANSITION} max-md:pointer-coarse:h-9`,
        COARSE_POINTER_TEXT_SM_CLASS,
        isActive
          ? activeTreatment === "fill"
            ? cn(CONTEXT_SELECTION_SURFACE_CLASS, "text-foreground")
            : "text-foreground after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground/60"
          : "text-muted-foreground hover:bg-state-hover",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={ariaLabel}
        aria-keyshortcuts={ariaKeyshortcuts}
        aria-pressed={isActive}
        className={cn(
          "flex h-full min-w-0 items-center rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          iconOnly ? "px-1.5" : "pl-1.5 pr-2",
        )}
      >
        {leadingVisual ? (
          <span
            className={cn(
              TAB_PILL_LEADING_VISUAL_CLASS,
              !iconOnly && "mr-1.5",
              closeAction
                ? "group-hover/tab-pill:opacity-0 tab-pill-close-focus-visible:opacity-0 max-md:pointer-coarse:opacity-0"
                : null,
            )}
          >
            {leadingVisual}
          </span>
        ) : null}
        <span
          className={cn(
            iconOnly ? "sr-only" : "truncate",
            !iconOnly && labelMaxWidthClass,
            labelClassName,
          )}
          title={iconOnly ? undefined : title}
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
