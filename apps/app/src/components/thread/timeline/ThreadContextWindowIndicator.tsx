import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { Icon } from "@bb/shared-ui/icon";
import type { ThreadContextWindowUsage } from "@bb/server-contract";
import { useHoverPopover } from "../../ui/hooks/use-hover-popover.js";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  calculateContextWindowUsagePercent,
  calculatePromptCacheHitPercent,
  formatCompactTokenCount,
  formatTokenCount,
} from "./thread-context-window-usage.js";

export interface ThreadContextWindowIndicatorProps {
  usage: ThreadContextWindowUsage;
  className?: string;
  /** Render with the usage menu open on mount. Story-only escape hatch. */
  defaultOpen?: boolean;
}

const CONTEXT_WINDOW_POPOVER_CLOSE_DELAY_MS = 60;
const CONTEXT_WINDOW_PANEL_CLASS_NAME =
  "w-56 rounded-md border bg-popover p-2 text-popover-foreground shadow-md max-md:w-full max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-4 max-md:pt-2 max-md:pb-[max(1rem,env(safe-area-inset-bottom))] max-md:shadow-none";

export function ThreadContextWindowIndicator({
  usage,
  className,
  defaultOpen,
}: ThreadContextWindowIndicatorProps) {
  const {
    open: hoverOpen,
    triggerHoverProps,
    contentHoverProps,
    handleOpenChange,
  } = useHoverPopover({
    closeDelayMs: CONTEXT_WINDOW_POPOVER_CLOSE_DELAY_MS,
    hoverableContent: false,
  });
  const open = defaultOpen || hoverOpen;

  const usedPercent = calculateContextWindowUsagePercent(usage);
  const leftPercent = Math.max(0, 100 - usedPercent);
  const visualPercent = Math.min(Math.max(usedPercent, 0), 100);

  const radius = 6.5;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - visualPercent / 100);

  const toneClass =
    usedPercent >= 90
      ? "text-destructive"
      : usedPercent >= 75
        ? "text-warning-text"
        : "text-muted-foreground";

  const usedTokensLabel = formatCompactTokenCount(usage.usedTokens);
  const windowTokensLabel = formatCompactTokenCount(usage.modelContextWindow);
  const titleLabel = usage.estimated ? "Estimated context" : "Context window";
  const cacheUsage = usage.promptCacheUsage;
  const cacheHitPercent = calculatePromptCacheHitPercent(cacheUsage);
  const cacheStatus =
    cacheUsage.status === "unknown"
      ? "unknown"
      : cacheUsage.cachedInputTokens > 0
        ? "hit"
        : "miss";
  const cacheSummaryLabel =
    cacheHitPercent === null
      ? "Unavailable"
      : cacheStatus === "miss"
        ? `No hit (${cacheHitPercent}%)`
        : `${cacheHitPercent}% hit`;
  const cacheAriaLabel =
    cacheHitPercent === null
      ? "prompt cache unavailable"
      : cacheStatus === "miss"
        ? "no prompt cache hit"
        : `prompt cache ${cacheHitPercent}% hit`;
  const cacheToneClass =
    cacheStatus === "hit"
      ? "text-success"
      : cacheStatus === "unknown"
        ? "text-subtle-foreground"
        : "text-muted-foreground";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          {...triggerHoverProps}
          className={cn(
            "-m-1 inline-flex h-8 cursor-pointer items-center justify-center gap-1 rounded-full px-1 transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          aria-label={`Context window ${usedPercent}% used; ${cacheAriaLabel}`}
        >
          <svg
            viewBox="0 0 16 16"
            className={cn("size-4", toneClass)}
            aria-hidden="true"
          >
            <circle
              cx="8"
              cy="8"
              r={radius}
              fill="none"
              strokeWidth="3"
              className="stroke-border-hairline"
            />
            <circle
              cx="8"
              cy="8"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 8 8)"
            />
          </svg>
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs tabular-nums",
              cacheToneClass,
            )}
            data-prompt-cache-status={cacheStatus}
            aria-hidden="true"
          >
            <Icon name="Layers" className="size-3" aria-hidden />
            {cacheHitPercent === null ? "—" : `${cacheHitPercent}%`}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        {...contentHoverProps}
        mobileTitle={titleLabel}
        className={CONTEXT_WINDOW_PANEL_CLASS_NAME}
      >
        <div className="space-y-2 max-md:space-y-3">
          <div className="flex items-baseline justify-between gap-2 text-xs max-md:text-sm">
            <span className="text-muted-foreground">{titleLabel}</span>
            <span className={cn("font-medium tabular-nums", toneClass)}>
              {usedPercent}% used
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border max-md:h-2">
            <div
              className={cn("h-full rounded-full bg-current", toneClass)}
              style={{ width: `${visualPercent}%` }}
            />
          </div>
          <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums text-muted-foreground max-md:text-sm">
            <span>
              {usedTokensLabel} / {windowTokensLabel} tokens
            </span>
            <span>{leftPercent}% left</span>
          </div>
          <div className="space-y-1 border-t border-border pt-2 max-md:pt-3">
            <div className="flex items-baseline justify-between gap-2 text-xs max-md:text-sm">
              <span className="text-muted-foreground">Prompt cache</span>
              <span className={cn("font-medium tabular-nums", cacheToneClass)}>
                {cacheSummaryLabel}
              </span>
            </div>
            {cacheUsage.status === "reported" ? (
              <div className="text-xs tabular-nums text-muted-foreground max-md:text-sm">
                {formatTokenCount(cacheUsage.cachedInputTokens)} cached of{" "}
                {formatTokenCount(cacheUsage.inputTokens)} input tokens
              </div>
            ) : (
              <div className="text-xs text-muted-foreground max-md:text-sm">
                Cached input tokens were not reported for the latest turn.
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
