import { useState, type ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";

export interface AnimatedBodyProps {
  id: string;
  labelledBy: string;
  isExpanded: boolean;
  /**
   * `reserve` keeps a transparent 1px top border while collapsed so the card
   * height does not jump by a pixel on expand; `none` draws the border only
   * while expanded (the prompt-stack cards' existing look).
   */
  collapsedBorder: "reserve" | "none";
  children: ReactNode;
}

/**
 * Collapsible card body with the shared grid-rows expand animation.
 *
 * Realizes `children` only after the first expand, then retains them. A
 * collapsed body still costs layout for every node inside it, and the bodies
 * behind the prompt-stack cards (agent trees, changed-file lists, per-row
 * live durations) are the expensive part; the DOM must not carry them before
 * anyone opens the card. Retained after the first open so re-expanding is
 * instant.
 */
export function AnimatedBody({
  id,
  labelledBy,
  isExpanded,
  collapsedBorder,
  children,
}: AnimatedBodyProps) {
  const [hasRealizedBody, setHasRealizedBody] = useState(isExpanded);
  if (isExpanded && !hasRealizedBody) {
    setHasRealizedBody(true);
  }
  const isBodyRealized = hasRealizedBody || isExpanded;

  return (
    <section
      id={id}
      role="region"
      aria-labelledby={labelledBy}
      aria-hidden={!isExpanded}
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows,opacity,border-color] duration-200 ease-out",
        isExpanded
          ? "grid-rows-[1fr] border-t border-border opacity-100"
          : cn(
              "pointer-events-none grid-rows-[0fr] opacity-0",
              collapsedBorder === "reserve" && "border-t border-transparent",
            ),
      )}
    >
      <div className="overflow-hidden bg-popover">
        {isBodyRealized ? children : null}
      </div>
    </section>
  );
}
