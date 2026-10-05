import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { CONTEXT_CARD_CLASS } from "./chrome-style-tokens";
import { Icon } from "./icon";
import { cn } from "../../lib/utils";

export const PROMPT_STACK_COLLAPSE_ROW_CLASS =
  "flex min-h-6 w-full cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground";

export const PROMPT_STACK_COUNT_PILL_CLASS =
  "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-surface-recessed px-1 text-2xs leading-none tabular-nums text-subtle-foreground";

const PEEK_LAYER_CLASSES: Record<number, readonly string[]> = {
  1: ["inset-x-2 top-1 bottom-0"],
  2: ["inset-x-4 top-2 bottom-0", "inset-x-2 top-1 bottom-1"],
};
const PEEK_PADDING_CLASS: Record<number, string> = { 1: "pb-1", 2: "pb-2" };

export interface DisclosureFocusHandoff {
  triggerRef: RefObject<HTMLButtonElement | null>;
  collapseRef: RefObject<HTMLButtonElement | null>;
  focusCollapseAfterToggle: () => void;
  focusTriggerAfterToggle: () => void;
}

export function useDisclosureFocusHandoff(
  isExpanded: boolean,
): DisclosureFocusHandoff {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<"trigger" | "collapse" | null>(null);
  useEffect(() => {
    const target =
      pendingFocus.current === "collapse"
        ? collapseRef.current
        : pendingFocus.current === "trigger"
          ? triggerRef.current
          : null;
    pendingFocus.current = null;
    target?.focus();
  }, [isExpanded]);
  return {
    triggerRef,
    collapseRef,
    focusCollapseAfterToggle: () => {
      pendingFocus.current = "collapse";
    },
    focusTriggerAfterToggle: () => {
      pendingFocus.current = "trigger";
    },
  };
}

export function PromptStackCollapseRow({
  buttonRef,
  controlsId,
  label,
  onCollapse,
  className,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  controlsId: string;
  label: string;
  onCollapse: () => void;
  className?: string;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded="true"
      aria-controls={controlsId}
      aria-label={label}
      onClick={onCollapse}
      className={cn(PROMPT_STACK_COLLAPSE_ROW_CLASS, className)}
    >
      <Icon name="ChevronUp" className="size-3.5" aria-hidden="true" />
    </button>
  );
}

export function PromptStackPeekLayers({
  hiddenCount,
  children,
}: {
  hiddenCount: number;
  children: ReactNode;
}) {
  const peekCount = Math.min(Math.max(hiddenCount, 0), 2);
  return (
    <div className={cn("relative", PEEK_PADDING_CLASS[peekCount])}>
      {(PEEK_LAYER_CLASSES[peekCount] ?? []).map((layerClass) => (
        <div
          key={layerClass}
          aria-hidden="true"
          data-prompt-stack-peek=""
          className={cn("absolute", CONTEXT_CARD_CLASS, layerClass)}
        />
      ))}
      <div className="relative">{children}</div>
    </div>
  );
}
