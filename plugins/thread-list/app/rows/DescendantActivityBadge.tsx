import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface DescendantActivityItem {
  id: string;
  label: string;
}

export function DescendantActivityBadge({
  items,
  onSelect,
  className,
}: {
  items: readonly DescendantActivityItem[];
  onSelect: (threadId: string) => void;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const count = items.length;
  if (count === 0) return null;
  const label = descendantActivityLabel(count);
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-sidebar-descendant-activity=""
              data-descendant-count={count}
              aria-label={label}
              className={cn(
                "inline-flex shrink-0 items-center gap-0.5 rounded px-1",
                "text-[10px] leading-none font-medium tabular-nums",
                "text-muted-foreground hover:text-foreground",
                "hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:outline-none",
                className,
              )}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Icon name="GitBranch" className="size-3" />
              <span data-descendant-count-label="">{count}</span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="left"
        align="start"
        className="w-64 p-1"
        onClick={(event) => event.stopPropagation()}
      >
        <ul
          data-sidebar-descendant-activity-list=""
          aria-label={label}
          className="max-h-64 overflow-y-auto"
        >
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-sidebar-descendant-activity-item={item.id}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left",
                  "text-xs text-sidebar-foreground hover:bg-state-hover",
                  "focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:outline-none",
                )}
                onClick={() => {
                  setIsOpen(false);
                  onSelect(item.id);
                }}
              >
                <Icon
                  name="GitBranch"
                  className="size-3 shrink-0 text-muted-foreground"
                />
                <span className="truncate">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function descendantActivityLabel(count: number): string {
  return count === 1
    ? "1 descendant thread working"
    : `${count} descendant threads working`;
}
