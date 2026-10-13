import type { ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@bb/shared-ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import { CONTEXT_SELECTION_SURFACE_CLASS } from "@bb/shared-ui/context-selection";
import { CompactLongPressMenu } from "@bb/shared-ui/compact-long-press-menu";
import {
  FIXED_PANEL_TAB_COLOR_TAGS,
  TAB_COLOR_TAG_LABELS,
  TAB_COLOR_TAG_SWATCH_CLASSES,
  type FixedPanelTabColorTag,
} from "./tabColorTag";

const VERTICAL_TAB_ICON_SIZE_CLASS = "size-8 max-md:pointer-coarse:size-9";
const VERTICAL_TAB_ICON_CLOSE_BUTTON_CLASS =
  "absolute -right-1 -top-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-sidebar text-muted-foreground opacity-0 hover:bg-state-hover group-hover/vertical-tab:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:opacity-100";

export interface VerticalTabIconProps {
  ariaLabel?: string;
  colorTag?: FixedPanelTabColorTag | null;
  isActive: boolean;
  label: string;
  leadingVisual: ReactNode;
  onClose?: (() => void) | null;
  onSelect: () => void;
  onSetColorTag?: ((colorTag: FixedPanelTabColorTag | null) => void) | null;
  title: string;
}

export function VerticalTabIcon({
  ariaLabel,
  colorTag = null,
  isActive,
  label,
  leadingVisual,
  onClose = null,
  onSelect,
  onSetColorTag = null,
  title,
}: VerticalTabIconProps) {
  const content = (
    <div className="group/vertical-tab relative shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onSelect}
            aria-label={ariaLabel ?? label}
            aria-pressed={isActive}
            className={cn(
              "relative flex items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&_[data-icon-root]]:size-4",
              VERTICAL_TAB_ICON_SIZE_CLASS,
              isActive
                ? cn(CONTEXT_SELECTION_SURFACE_CLASS, "text-foreground")
                : "text-muted-foreground hover:bg-state-hover",
            )}
          >
            {leadingVisual}
            <span className="sr-only">{label}</span>
            {colorTag !== null ? (
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-1.5 bottom-1 h-0.5 rounded-full",
                  TAB_COLOR_TAG_SWATCH_CLASSES[colorTag],
                )}
              />
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{title}</TooltipContent>
      </Tooltip>
      {onClose ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          aria-label={`Close ${label}`}
          className={VERTICAL_TAB_ICON_CLOSE_BUTTON_CLASS}
        >
          <Icon name="X" className="size-3" />
        </button>
      ) : null}
    </div>
  );

  if (onSetColorTag === null) {
    return content;
  }

  return (
    <CompactLongPressMenu
      label={`Color for ${label}`}
      items={
        <>
          {FIXED_PANEL_TAB_COLOR_TAGS.map((tag) => (
            <DropdownMenuItem key={tag} onSelect={() => onSetColorTag(tag)}>
              <span
                aria-hidden
                className={cn(
                  "size-3 shrink-0 rounded-full",
                  TAB_COLOR_TAG_SWATCH_CLASSES[tag],
                )}
              />
              {TAB_COLOR_TAG_LABELS[tag]}
            </DropdownMenuItem>
          ))}
          {colorTag !== null ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onSetColorTag(null)}>
                Clear color
              </DropdownMenuItem>
            </>
          ) : null}
        </>
      }
    >
      {content}
    </CompactLongPressMenu>
  );
}
