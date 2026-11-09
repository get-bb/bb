import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function DescendantActivityBadge({
  count,
  label,
  className,
}: {
  count: number;
  label: string;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-sidebar-descendant-activity=""
          data-descendant-count={count}
          role="img"
          aria-label={label}
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 rounded px-1",
            "text-[10px] leading-none font-medium tabular-nums",
            "text-muted-foreground",
            className,
          )}
        >
          <Icon name="GitBranch" className="size-3" />
          <span data-descendant-count-label="">{count}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

export function descendantActivityLabel(count: number): string {
  return count === 1
    ? "1 descendant thread working"
    : `${count} descendant threads working`;
}

export type DescendantActivityThread = Pick<
  PluginSidebarThread,
  "runtimeStatus" | "activity"
>;
