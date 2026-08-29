import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@bb/shared-ui/lib/utils";

/**
 * The action chrome shared by every prompt-stack banner: a small bordered
 * button that sits on the raised card surface. Extracted from
 * `ThreadPromptContextBanner` when the held-dispatch card and banner needed the
 * same affordance — one definition keeps the stack's buttons identical.
 */
export const PROMPT_BANNER_ACTION_FILL_CLASS = "bg-background shadow-xs";
export const PROMPT_BANNER_ACTION_INTERACTIVE_CLASS =
  "cursor-pointer text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
export const PROMPT_BANNER_ACTION_BUTTON_CLASS = cn(
  "inline-flex items-center whitespace-nowrap rounded border border-border px-1.5 py-0.5 text-xs",
  PROMPT_BANNER_ACTION_FILL_CLASS,
  PROMPT_BANNER_ACTION_INTERACTIVE_CLASS,
);
export const PROMPT_BANNER_ACTION_SEGMENT_CLASS = cn(
  "text-xs",
  PROMPT_BANNER_ACTION_INTERACTIVE_CLASS,
  "focus-visible:z-10",
);

export const PromptBannerActionButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function PromptBannerActionButton(
  { className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(PROMPT_BANNER_ACTION_BUTTON_CLASS, className)}
      {...props}
    />
  );
});

/**
 * A row's actions sit *on top of* the row's own text rather than beside it, so
 * the text can use the full width until a pointer arrives. This paints the
 * action cluster onto the card surface and fades the text out beneath its left
 * edge instead of letting a glyph collide with a truncated word.
 */
export const PROMPT_STACK_ROW_ACTION_TAKEOVER_CLASS =
  "relative bg-surface-raised-solid before:pointer-events-none before:absolute before:inset-y-0 before:right-full before:w-4 before:bg-gradient-to-r before:from-transparent before:to-surface-raised-solid before:content-['']";

