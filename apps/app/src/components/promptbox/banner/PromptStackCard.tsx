import { type CSSProperties, type ReactNode, type Ref } from "react";
import { cn } from "@bb/shared-ui/lib/utils";

export const PROMPT_STACK_CARD_ROW_HEIGHT = 32;
export const PROMPT_STACK_CARD_RADIUS_CLASS = "rounded-lg";
// Outer cards are rounded-lg (8px). A 4px inset means inner hover/focus
// targets use rounded (4px) so the corner arcs stay visually aligned.
export const PROMPT_STACK_INLAY_RADIUS_CLASS = "rounded";
export const PROMPT_STACK_INLAY_INSET_CLASS = "p-1";
export const PROMPT_STACK_INLAY_SEGMENT_CLASS = cn(
  "min-h-6 px-2 py-1",
  PROMPT_STACK_INLAY_RADIUS_CLASS,
);
const BASE_CHROME = cn(
  PROMPT_STACK_CARD_RADIUS_CLASS,
  "border border-border bg-surface-raised-solid",
);

export interface PromptStackCardProps {
  children: ReactNode;
  /**
   * Accessible region label. When provided the card renders as
   * <section aria-label={...}>; otherwise it renders as a plain <div>.
   */
  ariaLabel?: string;
  className?: string;
  rootRef?: Ref<HTMLElement>;
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
 * bordered/rounded/raised surface only — each consumer owns its internal
 * padding and layout. The point of the primitive is so the whole stack stays
 * visually unified and a future "compact" stack treatment can plug in here.
 */
export function PromptStackCard({
  children,
  ariaLabel,
  className,
  rootRef,
  style,
  tabIndex,
}: PromptStackCardProps) {
  if (ariaLabel) {
    return (
      <section
        ref={rootRef}
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
      ref={rootRef as Ref<HTMLDivElement>}
      className={cn(BASE_CHROME, className)}
      style={style}
      tabIndex={tabIndex}
    >
      {children}
    </div>
  );
}
