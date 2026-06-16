import { type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const BASE_CHROME =
  "rounded-md border border-border bg-surface-recessed";

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
    <div className={cn(BASE_CHROME, className)} style={style} tabIndex={tabIndex}>
      {children}
    </div>
  );
}
