import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
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
 * The row grammar shared by the pending region's two halves — queued messages
 * and held dispatches: one line of text, then the row's actions.
 */
export const PROMPT_STACK_ROW_CLASS = "relative px-2.5 py-0.5";

/**
 * A row's actions sit *on top of* the row's own text rather than beside it, so
 * the text can use the full width until a pointer arrives. This paints the
 * action cluster onto the card surface and fades the text out beneath its left
 * edge instead of letting a glyph collide with a truncated word.
 */
export const PROMPT_STACK_ROW_ACTION_TAKEOVER_CLASS =
  "relative bg-surface-raised-solid before:pointer-events-none before:absolute before:inset-y-0 before:right-full before:w-4 before:bg-gradient-to-r before:from-transparent before:to-surface-raised-solid before:content-['']";

/**
 * The always-visible action cluster of a held row.
 *
 * Held dispatches deliberately break from the hover-revealed glyphs used by
 * queued messages next to them. A queued message runs when the thread frees up
 * and its actions can wait to be discovered; a held one is counting down
 * towards a send that the reader may want to stop, so "Send now" and "Cancel"
 * have to be named and reachable at rest — including on touch, where there is
 * no hover to reveal anything. The cluster wraps under the row's own text when
 * the card is too narrow to hold both on one line.
 */
export function PromptStackRowTextActions({
  children,
  label,
}: {
  children: ReactNode;
  /** Identifies the cluster's owning row for assistive technology. */
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="ml-auto flex shrink-0 items-center gap-1"
    >
      {children}
    </div>
  );
}

/**
 * The in-flight label that replaces a row's actions while one of them runs.
 * Sized and coloured like the actions it stands in for so the row does not jump.
 */
export function PromptStackRowPendingLabel({ children }: { children: ReactNode }) {
  return (
    <span className="whitespace-nowrap px-1 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

/**
 * Trailing action cluster for a banner row. The `data-promptbox-*` attributes
 * are the promptbox container's responsive-truncation hooks.
 */
export function PromptBannerActionSlot({
  children,
  hideInCompact = false,
}: {
  children: ReactNode;
  hideInCompact?: boolean;
}) {
  return (
    <div
      className="ml-auto flex shrink-0 items-center gap-1.5 pr-2 text-xs text-muted-foreground"
      data-promptbox-hide-compact={hideInCompact ? "" : undefined}
      data-promptbox-hide-tiny=""
    >
      {children}
    </div>
  );
}
