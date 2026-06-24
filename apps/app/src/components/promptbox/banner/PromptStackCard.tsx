import { type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const BASE_CHROME = "rounded-lg border border-border bg-surface-recessed";

export const PROMPT_STACK_CARD_ROW_HEIGHT = 32;
// Outer cards are rounded-lg (8px). A 4px inset means inner hover/focus
// targets use rounded (4px) so the corner arcs stay visually aligned.
export const PROMPT_STACK_INLAY_INSET_CLASS = "p-1";
export const PROMPT_STACK_INLAY_SEGMENT_CLASS = "min-h-6 rounded px-2 py-1";
export const PROMPT_STACK_INLAY_HEADER_CLASS =
  "flex min-h-6 w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export interface PromptStackCardProps {
  children: ReactNode;
  /**
   * Accessible region label. When provided the card renders as
   * <section aria-label={...}>; otherwise it renders as a plain <div>.
   */
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
  /**
   * Makes the card keyboard-focusable — set to 0 when the card is itself a
   * scroll region (e.g. a height-capped list) so keyboard users can scroll it.
   */
  tabIndex?: number;
}

/**
 * Shared chrome for the stack of context cards rendered above the FollowUp
 * prompt box (today: ContextBanner + QueuedMessagesList). Owns the
 * bordered/rounded/muted surface only — each consumer owns its internal
 * padding and layout. The point of the primitive is so the whole stack stays
 * visually unified and a future "compact" stack treatment can plug in here.
 */
export function PromptStackCard({
  children,
  ariaLabel,
  className,
  style,
  tabIndex,
}: PromptStackCardProps) {
  if (ariaLabel) {
    return (
      <section
        aria-label={ariaLabel}
        className={cn(BASE_CHROME, className)}
        style={style}
        tabIndex={tabIndex}
      >
        {children}
      </section>
    );
  }
  return (
    <div
      className={cn(BASE_CHROME, className)}
      style={style}
      tabIndex={tabIndex}
    >
      {children}
    </div>
  );
}
