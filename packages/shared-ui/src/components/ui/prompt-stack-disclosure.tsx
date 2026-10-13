import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { CONTEXT_CARD_CLASS } from "./chrome-style-tokens";
import { Icon } from "./icon";
import { cn } from "../../lib/utils";

const COLLAPSE_ROW_CLASS =
  "flex min-h-6 w-full cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground";

const COUNT_PILL_CLASS =
  "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-surface-recessed px-1 text-2xs leading-none tabular-nums text-subtle-foreground";

const PEEK_LAYER_CLASSES: Record<number, readonly string[]> = {
  1: ["inset-x-2 top-1 bottom-0"],
  2: ["inset-x-4 top-2 bottom-0", "inset-x-2 top-1 bottom-1"],
};
const PEEK_PADDING_CLASS: Record<number, string> = { 1: "pb-1", 2: "pb-2" };

export function useDisclosureFocusHandoff(
  isExpanded: boolean,
  toggle: () => void,
) {
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
    onTriggerClick: () => {
      if (!isExpanded) pendingFocus.current = "collapse";
      toggle();
    },
    onCollapseClick: () => {
      pendingFocus.current = "trigger";
      toggle();
    },
  };
}

export function PromptStackCollapseRow({
  buttonRef,
  className,
  controlsId,
  label,
  onCollapse,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  className?: string;
  controlsId: string;
  label: string;
  onCollapse: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded="true"
      aria-controls={controlsId}
      aria-label={label}
      onClick={onCollapse}
      className={cn(COLLAPSE_ROW_CLASS, className)}
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

export const PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS = "group/disclosure";

const TRAILING_SLOT_CLASS =
  "-mr-3 ml-auto flex w-8 shrink-0 items-center justify-center";
const HOVER_CHEVRON_CLASS =
  "size-3.5 shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover/disclosure:opacity-100 group-focus-visible/disclosure:opacity-100 [@media(hover:none)]:hidden";

export function PromptStackHoverChevron({
  isExpanded,
}: {
  isExpanded: boolean;
}) {
  return (
    <span className={TRAILING_SLOT_CLASS}>
      {isExpanded ? null : (
        <Icon
          name="ChevronDown"
          className={HOVER_CHEVRON_CLASS}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

export function PromptStackChevron({ isExpanded }: { isExpanded: boolean }) {
  return (
    <span className={TRAILING_SLOT_CLASS}>
      {isExpanded ? null : (
        <Icon
          name="ChevronDown"
          className="size-3.5 shrink-0 text-subtle-foreground"
          aria-hidden="true"
        />
      )}
    </span>
  );
}

export function PromptStackCountSlot({ count }: { count: number }) {
  return (
    <span className={TRAILING_SLOT_CLASS}>
      <span className={COUNT_PILL_CLASS}>{`+${count}`}</span>
    </span>
  );
}
