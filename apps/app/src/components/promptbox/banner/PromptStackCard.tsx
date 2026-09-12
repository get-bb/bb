import { type CSSProperties, type ReactNode, type Ref } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

export const PROMPT_STACK_CARD_ROW_HEIGHT = 32;
export const PROMPT_STACK_CARD_HEADER_BUTTON_CLASS =
  "flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-none px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-background/80";
const PROMPT_STACK_CARD_RADIUS_CLASS = "rounded-lg";
const PROMPT_STACK_INLAY_RADIUS_CLASS = "rounded";
export const PROMPT_STACK_INLAY_INSET_CLASS = "p-1";
export const PROMPT_STACK_INLAY_SEGMENT_CLASS = cn(
  "min-h-6 px-2 py-1",
  PROMPT_STACK_INLAY_RADIUS_CLASS,
);
export const PROMPT_STACK_EDGE_CARET_BUTTON_WIDTH_CLASS = "w-6 px-0";
const BASE_CHROME = cn(
  PROMPT_STACK_CARD_RADIUS_CLASS,
  "border border-border bg-surface-raised-solid",
);

export const PROMPT_STACK_TRACK_CLASS = "grid-cols-[minmax(0,1fr)]";

export interface PromptStackCardProps {
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
  rootRef?: Ref<HTMLElement>;
  style?: CSSProperties;
}

export function PromptStackCard({
  children,
  ariaLabel,
  className,
  rootRef,
  style,
}: PromptStackCardProps) {
  if (ariaLabel) {
    return (
      <section
        ref={rootRef}
        aria-label={ariaLabel}
        className={cn(BASE_CHROME, className)}
        style={style}
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
    >
      {children}
    </div>
  );
}

export function PromptStackCardChevron({
  isExpanded,
  className,
}: {
  isExpanded: boolean;
  className: string;
}) {
  return (
    <Icon
      name="ChevronDown"
      className={cn(
        className,
        "size-3.5 shrink-0 transition-transform duration-200",
        isExpanded && "rotate-180",
      )}
      aria-hidden="true"
    />
  );
}
