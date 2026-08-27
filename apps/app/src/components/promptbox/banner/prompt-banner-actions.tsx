import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
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
 * and held dispatches. The row's own text owns the full width and the actions
 * are revealed over its tail, so a held card and a queued message read as the
 * same kind of thing rather than as two unrelated widgets stacked together.
 */
export const PROMPT_STACK_ROW_CLASS = "group/row relative px-2.5 py-0.5";

/**
 * A row's actions sit *on top of* the row's own text rather than beside it, so
 * the text can use the full width until a pointer arrives. This paints the
 * action cluster onto the card surface and fades the text out beneath its left
 * edge instead of letting a glyph collide with a truncated word.
 */
export const PROMPT_STACK_ROW_ACTION_TAKEOVER_CLASS =
  "relative bg-surface-raised-solid before:pointer-events-none before:absolute before:inset-y-0 before:right-full before:w-4 before:bg-gradient-to-r before:from-transparent before:to-surface-raised-solid before:content-['']";

/**
 * Reveal rules for a row's action cluster: invisible at rest, present on hover,
 * on keyboard focus, and unconditionally on touch devices where there is no
 * hover to reveal them with.
 */
const PROMPT_STACK_ROW_ACTION_REVEAL_CLASS = cn(
  "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-[120ms] ease-out",
  "group-hover/row:pointer-events-auto group-hover/row:opacity-100",
  "group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100",
);

/**
 * The hover-revealed icon-button cluster used by the rows of the pending region
 * (queued messages and held dispatches). Hidden below `md`, where
 * {@link PromptStackRowOverflowTrigger} takes over with a menu — a row is too
 * narrow there to expose three targets without crowding the text.
 */
export function PromptStackRowActions({
  children,
  label,
}: {
  children: ReactNode;
  /** Identifies the cluster's owning row for assistive technology. */
  label: string;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <div
        role="group"
        aria-label={label}
        data-prompt-stack-row-actions=""
        className={cn(
          PROMPT_STACK_ROW_ACTION_TAKEOVER_CLASS,
          PROMPT_STACK_ROW_ACTION_REVEAL_CLASS,
          "hidden items-center gap-0.5 rounded-md md:flex",
        )}
      >
        {children}
      </div>
    </TooltipProvider>
  );
}

/**
 * One glyph action in a {@link PromptStackRowActions} cluster. The label is both
 * the accessible name and the tooltip, so the two can never disagree.
 */
export function PromptStackRowActionButton({
  compact = true,
  destructive = false,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  compact?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn(
            "shrink-0 text-muted-foreground",
            destructive && "hover:text-destructive",
            compact ? "size-7" : "size-8",
          )}
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
        >
          <Icon name={icon} className="size-4" aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The below-`md` counterpart to {@link PromptStackRowActions}: a single overflow
 * trigger holding the same actions in a menu. Spread onto a `DropdownMenuTrigger`
 * child so the menu owns its open state.
 */
export const PROMPT_STACK_ROW_OVERFLOW_TRIGGER_CLASS = cn(
  PROMPT_STACK_ROW_ACTION_TAKEOVER_CLASS,
  PROMPT_STACK_ROW_ACTION_REVEAL_CLASS,
  "size-7 shrink-0 text-muted-foreground md:hidden",
  "data-[state=open]:pointer-events-auto data-[state=open]:opacity-100",
  "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
);

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
