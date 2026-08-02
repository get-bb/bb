import type { ReactNode } from "react";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";

export function AutomationMetadataItem({
  children,
  icon,
  iconLabel,
  title,
}: {
  children: ReactNode;
  icon?: IconName;
  iconLabel?: string;
  title?: string;
}) {
  return (
    <span className="inline-flex h-4 min-w-0 items-center gap-1.5 whitespace-nowrap leading-4">
      {icon && iconLabel ? (
        <TooltipProvider delayDuration={250}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="img"
                aria-label={iconLabel}
                tabIndex={0}
                className="inline-flex shrink-0 items-center rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Icon name={icon} className="size-3.5" aria-hidden />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{iconLabel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
      <span className="min-w-0 truncate" title={title}>
        {children}
      </span>
    </span>
  );
}
