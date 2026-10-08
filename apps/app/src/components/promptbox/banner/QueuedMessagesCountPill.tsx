import { useState } from "react";
import { cn } from "@bb/shared-ui/lib/utils";

export function QueuedMessagesCountPill({ count }: { count: number }) {
  const [display, setDisplay] = useState<{
    bump: number;
    count: number;
    previousCount: number | null;
  }>({ bump: 0, count, previousCount: null });
  if (display.count !== count) {
    setDisplay(
      count > display.count
        ? { bump: display.bump + 1, count, previousCount: display.count }
        : { bump: display.bump, count, previousCount: null },
    );
  }
  const bumped = display.bump > 0;
  return (
    <span
      key={display.bump}
      data-queued-messages-count=""
      className={cn(
        "relative -mr-1 ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-recessed px-1 text-2xs leading-none tabular-nums text-subtle-foreground",
        bumped && "bb-count-flash",
      )}
    >
      {display.previousCount === null ? null : (
        <span
          aria-hidden
          data-queued-messages-previous-count=""
          className="bb-count-roll-out absolute inset-0 flex items-center justify-center"
          onAnimationEnd={() =>
            setDisplay((current) => ({ ...current, previousCount: null }))
          }
        >
          {display.previousCount}
        </span>
      )}
      <span className={cn(bumped && "bb-count-roll-in")}>{count}</span>
    </span>
  );
}
