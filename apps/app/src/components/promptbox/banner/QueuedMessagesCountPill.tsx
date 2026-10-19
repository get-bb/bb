import { useState } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PROMPT_STACK_COUNT_PILL_CLASS,
  PROMPT_STACK_TRAILING_SLOT_CLASS,
} from "@bb/shared-ui/prompt-stack-disclosure";

export function QueuedMessagesCountPill({
  arrivals,
  count,
}: {
  arrivals: number;
  count: number;
}) {
  const [display, setDisplay] = useState<{
    arrivals: number;
    count: number;
    previousCount: number | null;
  }>({ arrivals, count, previousCount: null });
  if (display.arrivals !== arrivals || display.count !== count) {
    setDisplay({
      arrivals,
      count,
      previousCount:
        display.arrivals !== arrivals && count > display.count
          ? display.count
          : null,
    });
  }
  const bumped = display.arrivals > 0;
  return (
    <span className={PROMPT_STACK_TRAILING_SLOT_CLASS}>
      <span
        key={display.arrivals}
        data-queued-messages-count=""
        className={cn(
          PROMPT_STACK_COUNT_PILL_CLASS,
          "relative overflow-hidden",
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
    </span>
  );
}
