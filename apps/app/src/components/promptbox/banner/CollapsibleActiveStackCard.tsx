import type { ReactNode } from "react";
import { AnimatedDisclosureBody } from "@/components/promptbox/banner/AnimatedBody";
import {
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PromptStackCard,
} from "@/components/promptbox/banner/PromptStackCard";
import {
  activityIconClass,
  activityRowClass,
  activityTextClass,
} from "@bb/shared-ui/activity-row-styles";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
  PromptStackHoverChevron,
  useDisclosureFocusHandoff,
} from "@bb/shared-ui/prompt-stack-disclosure";

const HEADER_GROUP_CLASS = activityRowClass(
  "active",
  "flex w-full items-stretch rounded-none px-0 py-0",
);
const HEADER_BUTTON_CLASS =
  "flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-none bg-transparent px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-background/80";
const DISMISS_BUTTON_CLASS =
  "flex min-h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-none border-l border-border/35 bg-transparent text-muted-foreground transition-colors hover:text-foreground disabled:cursor-wait disabled:text-muted-foreground/60";

interface CollapsibleActiveStackCardProps {
  cardAriaLabel: string;
  controlsAriaLabel: string;
  toggleId: string;
  bodyId: string;
  toggleAriaLabel: string;
  iconName: IconName;
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  dismiss: {
    ariaLabel: string;
    isPending: boolean;
    onDismiss: () => void;
  } | null;
  children: ReactNode;
}

export function CollapsibleActiveStackCard({
  cardAriaLabel,
  controlsAriaLabel,
  toggleId,
  bodyId,
  toggleAriaLabel,
  iconName,
  title,
  isExpanded,
  onToggle,
  dismiss,
  children,
}: CollapsibleActiveStackCardProps) {
  const focus = useDisclosureFocusHandoff(isExpanded, onToggle);
  return (
    <PromptStackCard
      ariaLabel={cardAriaLabel}
      className="overflow-hidden"
      style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
    >
      <div
        role="group"
        aria-label={controlsAriaLabel}
        className={HEADER_GROUP_CLASS}
      >
        <button
          ref={focus.triggerRef}
          type="button"
          id={toggleId}
          aria-expanded={isExpanded}
          aria-controls={bodyId}
          aria-label={toggleAriaLabel}
          onClick={focus.onTriggerClick}
          className={cn(
            HEADER_BUTTON_CLASS,
            PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
          )}
        >
          <Icon
            name={iconName}
            className={activityIconClass("active", "size-3.5 shrink-0")}
            aria-hidden="true"
          />
          <span
            className={activityTextClass(
              "active",
              "min-w-0 flex-1 truncate text-left",
            )}
          >
            {title}
          </span>
          <PromptStackHoverChevron isExpanded={isExpanded} />
        </button>
        {dismiss ? (
          <button
            type="button"
            aria-label={dismiss.ariaLabel}
            onClick={dismiss.onDismiss}
            disabled={dismiss.isPending}
            className={DISMISS_BUTTON_CLASS}
          >
            <Icon
              name={dismiss.isPending ? "Loading" : "X"}
              className={cn("size-3.5", dismiss.isPending && "animate-spin")}
              aria-hidden="true"
            />
          </button>
        ) : null}
      </div>
      <AnimatedDisclosureBody
        id={bodyId}
        labelledBy={toggleId}
        isExpanded={isExpanded}
        collapsedBorder="none"
        collapseLabel={`Collapse ${title}`}
        collapseRef={focus.collapseRef}
        onCollapse={focus.onCollapseClick}
      >
        {children}
      </AnimatedDisclosureBody>
    </PromptStackCard>
  );
}
