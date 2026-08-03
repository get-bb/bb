import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Popover, PopoverAnchor, PopoverContent } from "@bb/shared-ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { useAppCommandShortcut } from "@/components/commands/AppCommandProvider";
import { HEADER_PANE_ACTION_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";
import { useHoverPopover } from "@/components/ui/hooks/use-hover-popover";
import type { SplitSide } from "@/lib/split-layout";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePaneContext } from "./PaneContext";

const ARRANGEMENT_ACTIONS: ReadonlyArray<{
  label: string;
  side: SplitSide;
}> = [
  { label: "Move left", side: "left" },
  { label: "Move right", side: "right" },
  { label: "Move top", side: "top" },
  { label: "Move bottom", side: "bottom" },
];

const MENU_ITEM_CLASS =
  "flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-foreground outline-none transition-colors hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none [&>svg]:size-4 [&>svg]:shrink-0";

const ARRANGEMENT_REGION_CLASS: Record<SplitSide, string> = {
  left: "inset-y-[3px] left-[3px] w-2.5",
  right: "inset-y-[3px] right-[3px] w-2.5",
  top: "inset-x-[3px] top-[3px] h-1.5",
  bottom: "inset-x-[3px] bottom-[3px] h-1.5",
};

function ArrangementGlyph({ side }: { side: SplitSide }) {
  return (
    <span
      data-pane-arrangement-glyph={side}
      aria-hidden
      className="relative block h-5 w-8 rounded-[5px] border-2 border-current"
    >
      <span
        className={cn(
          "absolute rounded-[2px] bg-current",
          ARRANGEMENT_REGION_CLASS[side],
        )}
      />
    </span>
  );
}

export function PaneMaximizeButton({
  defaultMenuOpen = false,
  defaultTooltipOpen = false,
}: {
  /** Keeps the hover menu visible in its focused Ladle story. */
  defaultMenuOpen?: boolean;
  /** Keeps the full-screen tooltip visible in its focused Ladle story. */
  defaultTooltipOpen?: boolean;
}) {
  const { isMaximized, onToggleMaximize, onMoveToSide } = usePaneContext();
  const shortcut = useAppCommandShortcut("pane.maximize.toggle");
  const {
    open: hoverOpen,
    triggerHoverProps,
    contentHoverProps,
    handleOpenChange,
  } = useHoverPopover({ closeDelayMs: 100 });

  if (onToggleMaximize === null) return null;

  const label = isMaximized ? "Exit Full Screen" : "Full Screen";
  const accessibleLabel = shortcut ? `${label} (${shortcut.label})` : label;
  const menuOpen = !isMaximized && (defaultMenuOpen || hoverOpen);
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        HEADER_PANE_ACTION_ICON_BUTTON_CLASS,
        CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
      )}
      aria-label={accessibleLabel}
      aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
      aria-pressed={isMaximized}
      aria-haspopup={!isMaximized ? "menu" : undefined}
      aria-expanded={!isMaximized ? menuOpen : undefined}
      onFocus={!isMaximized ? () => handleOpenChange(true) : undefined}
      onClick={() => {
        handleOpenChange(false);
        onToggleMaximize();
      }}
      {...(!isMaximized ? triggerHoverProps : {})}
    >
      <Icon name={isMaximized ? "Minimize2" : "Maximize2"} />
    </Button>
  );

  if (isMaximized) {
    return (
      <Tooltip defaultOpen={defaultTooltipOpen}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="bottom">
          <span>Exit Full Screen</span>
          {shortcut ? ` (${shortcut.label})` : ""}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover open={menuOpen} onOpenChange={handleOpenChange}>
      <PopoverAnchor asChild>{button}</PopoverAnchor>
      <PopoverContent
        role="menu"
        aria-label="Pane arrangement"
        side="bottom"
        align="end"
        sideOffset={6}
        className="w-52 space-y-1 rounded-lg p-1.5"
        {...contentHoverProps}
      >
        <button
          type="button"
          role="menuitem"
          className={MENU_ITEM_CLASS}
          onClick={() => {
            handleOpenChange(false);
            onToggleMaximize();
          }}
        >
          <Icon name="Maximize2" />
          <span className="flex-1">Full Screen</span>
          {shortcut ? (
            <span className="text-subtle-foreground">{shortcut.label}</span>
          ) : null}
        </button>
        {onMoveToSide ? (
          <div
            className="grid grid-cols-4 gap-1 border-t border-border-hairline pt-1.5"
            aria-label="Move pane"
          >
            {ARRANGEMENT_ACTIONS.map((action) => (
              <Tooltip key={action.side}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="menuitem"
                    aria-label={action.label}
                    className="flex h-11 cursor-default items-center justify-center rounded-md text-subtle-foreground outline-none transition-colors hover:bg-state-hover hover:text-foreground focus-visible:bg-state-hover focus-visible:text-foreground focus-visible:outline-none"
                    onClick={() => {
                      handleOpenChange(false);
                      onMoveToSide(action.side);
                    }}
                  >
                    <ArrangementGlyph side={action.side} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{action.label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
