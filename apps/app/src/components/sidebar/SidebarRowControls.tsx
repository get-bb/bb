import { type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { SIDEBAR_HOVER_ACTIONS_GAP_CLASS } from "@/components/ui/sidebar-hover-actions";
import { SIDEBAR_CONTROL_BUTTON_CLASS } from "./sidebarRowClasses";

export function SidebarRowControls({
  primaryAction,
  children,
}: {
  primaryAction: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      data-sidebar-row-controls=""
      className={cn(
        "inline-flex shrink-0 items-center",
        SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
      )}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {primaryAction}
      {children}
    </span>
  );
}

export function SidebarControlButton({
  label,
  icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip delayDuration={350} disableHoverableContent>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={disabled}
          className={SIDEBAR_CONTROL_BUTTON_CLASS}
          onClick={(event) => {
            event.stopPropagation();
            if (event.detail > 0) event.currentTarget.blur();
            onClick();
          }}
        >
          <Icon name={icon} className={COARSE_POINTER_ICON_SIZE_CLASS} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
