import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  CONTEXT_CARD_CLASS,
  CONTEXT_CARD_SEGMENT_CLASS,
  CONTEXT_CARD_TOGGLE_CLASS,
} from "./chrome-style-tokens";
import { Icon } from "./icon";
import { cn } from "../../lib/utils";

const COLLAPSE_ROW_CLASS =
  "flex min-h-6 w-full cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground";

export const PROMPT_STACK_COUNT_PILL_CLASS =
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

export const PROMPT_STACK_TRAILING_SLOT_CLASS =
  "ml-auto mr-px flex w-6 shrink-0 items-center justify-center";
const HOVER_CHEVRON_CLASS =
  "size-3.5 shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover/disclosure:opacity-100 group-focus-visible/disclosure:opacity-100 [@media(hover:none)]:hidden";

export function PromptStackHoverChevron({
  isExpanded,
}: {
  isExpanded: boolean;
}) {
  return (
    <span className={PROMPT_STACK_TRAILING_SLOT_CLASS}>
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
    <span className={PROMPT_STACK_TRAILING_SLOT_CLASS}>
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

export function PromptStackCountSlot({
  count,
  prefix = "",
}: {
  count: number;
  prefix?: "+" | "";
}) {
  return (
    <span className={PROMPT_STACK_TRAILING_SLOT_CLASS}>
      <span
        className={PROMPT_STACK_COUNT_PILL_CLASS}
      >{`${prefix}${count}`}</span>
    </span>
  );
}

const SEGMENT_SHRINK_CLASS = "min-w-0 overflow-hidden";

interface SectionToggleButtonProps {
  buttonRef: RefObject<HTMLButtonElement | null>;
  fillRow: boolean;
  id: string;
  controlsId: string;
  ariaLabel?: string;
  icon: ReactNode;
  label: ReactNode;
  compactLabel?: ReactNode;
  hideLabelInCompact?: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

export function SectionToggleButton({
  buttonRef,
  fillRow,
  id,
  controlsId,
  ariaLabel,
  icon,
  label,
  compactLabel,
  hideLabelInCompact = true,
  isExpanded,
  onToggle,
}: SectionToggleButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      id={id}
      aria-expanded={isExpanded}
      aria-controls={controlsId}
      aria-label={ariaLabel}
      onClick={onToggle}
      className={cn(
        CONTEXT_CARD_TOGGLE_CLASS,
        CONTEXT_CARD_SEGMENT_CLASS,
        SEGMENT_SHRINK_CLASS,
        label !== null && label !== undefined ? "gap-1.5" : "gap-0",
        fillRow && "flex-1 justify-start text-left",
        PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
        isExpanded ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {icon}
      {label !== null && label !== undefined ? (
        <span
          className="min-w-0 truncate"
          data-promptbox-hide-compact={hideLabelInCompact ? "" : undefined}
        >
          {label}
        </span>
      ) : null}
      {hideLabelInCompact &&
      compactLabel !== null &&
      compactLabel !== undefined ? (
        <span className="min-w-0 truncate" data-promptbox-compact-label="">
          {compactLabel}
        </span>
      ) : null}
      {fillRow ? <PromptStackHoverChevron isExpanded={isExpanded} /> : null}
    </button>
  );
}

interface AnimatedBodyProps {
  id: string;
  labelledBy: string;
  isExpanded: boolean;
  collapsedBorder: "reserve" | "none";
  children: ReactNode;
}

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
      inert={!isExpanded}
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

interface AnimatedDisclosureBodyProps extends AnimatedBodyProps {
  collapseLabel: string;
  collapseRef: RefObject<HTMLButtonElement | null>;
  onCollapse: () => void;
}

export function AnimatedDisclosureBody({
  collapseLabel,
  collapseRef,
  onCollapse,
  children,
  ...bodyProps
}: AnimatedDisclosureBodyProps) {
  return (
    <AnimatedBody {...bodyProps}>
      {children}
      <div className="px-1 pb-1">
        <PromptStackCollapseRow
          buttonRef={collapseRef}
          controlsId={bodyProps.id}
          label={collapseLabel}
          onCollapse={onCollapse}
        />
      </div>
    </AnimatedBody>
  );
}
