import type { ReactNode, RefObject } from "react";
import {
  CONTEXT_CARD_TOGGLE_CLASS,
  CONTEXT_CARD_SEGMENT_CLASS,
} from "@bb/shared-ui/chrome-style-tokens";
import {
  PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
  PromptStackHoverChevron,
} from "@bb/shared-ui/prompt-stack-disclosure";
import { cn } from "@bb/shared-ui/lib/utils";

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

export function PromptStackSectionToggleButton({
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
