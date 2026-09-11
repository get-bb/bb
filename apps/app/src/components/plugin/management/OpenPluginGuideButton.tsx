import { Icon } from "@bb/shared-ui/icon";
import { buttonVariants } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";

export function OpenPluginGuideButton({
  compactWhenNarrow = false,
}: {
  compactWhenNarrow?: boolean;
}) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href="/plugins/plugin-api-docs/plugin-api"
            target="_blank"
            rel="noreferrer"
            aria-label="Plugin Guide (opens in a new tab)"
            className={cn(
              buttonVariants({ variant: "link", size: "sm" }),
              "shrink-0 gap-1.5 px-0 text-muted-foreground hover:text-foreground",
              compactWhenNarrow && "@max-[36rem]/resource-toolbar:w-8",
            )}
          >
            <Icon
              name="Explore"
              className={cn(
                "size-4",
                !compactWhenNarrow && "max-[360px]:hidden",
              )}
              aria-hidden
            />
            <span
              className={cn(
                "underline underline-offset-4",
                compactWhenNarrow && "@max-[36rem]/resource-toolbar:hidden",
              )}
            >
              Plugin Guide
            </span>
            <Icon
              name="ExternalLink"
              className={cn(
                "size-3.5",
                compactWhenNarrow && "@max-[36rem]/resource-toolbar:hidden",
              )}
              aria-hidden
            />
          </a>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Plugin Guide · Opens in a new tab
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
