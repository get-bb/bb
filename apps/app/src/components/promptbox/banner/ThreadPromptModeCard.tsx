import type { ThreadTimelineActivePromptMode } from "@bb/domain";
import {
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PromptStackCard,
} from "@/components/promptbox/banner/PromptStackCard";
import {
  activityIconClass,
  activityRowClass,
  activityTextClass,
} from "@bb/shared-ui/activity-row-styles";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

const PROMPT_MODE_HEADER_GROUP_CLASS = activityRowClass(
  "active",
  "flex w-full items-stretch rounded-none px-0 py-0",
);
const PROMPT_MODE_HEADER_BUTTON_CLASS =
  "flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-none bg-transparent px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-background/80";
const PROMPT_MODE_EXIT_BUTTON_CLASS =
  "flex min-h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-none border-l border-border/35 bg-transparent text-muted-foreground transition-colors hover:text-foreground disabled:cursor-wait disabled:text-muted-foreground/60";

interface ThreadPromptModeCardProps {
  activePromptMode: ThreadTimelineActivePromptMode | null;
  isExitPending?: boolean;
  isExpanded: boolean;
  onExitPlanMode?: () => void;
  onToggle: () => void;
}

const BODY_ID = "thread-prompt-mode-card-body";
const TOGGLE_ID = "thread-prompt-mode-card-toggle";

export function ThreadPromptModeCard({
  activePromptMode,
  isExitPending = false,
  isExpanded,
  onExitPlanMode,
  onToggle,
}: ThreadPromptModeCardProps) {
  if (activePromptMode?.mode !== "plan") {
    return null;
  }
  const promptText = activePromptMode.prompt.trim();
  const hasPrompt = promptText.length > 0;

  return (
    <PromptStackCard
      ariaLabel="Prompt mode"
      className="overflow-hidden"
      style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
    >
      <div
        role="group"
        aria-label="Plan mode controls"
        className={PROMPT_MODE_HEADER_GROUP_CLASS}
      >
        <button
          type="button"
          id={TOGGLE_ID}
          aria-expanded={isExpanded}
          aria-controls={BODY_ID}
          aria-label="Plan"
          onClick={onToggle}
          className={PROMPT_MODE_HEADER_BUTTON_CLASS}
        >
          <Icon
            name="ListTodo"
            className={activityIconClass("active", "size-3.5 shrink-0")}
            aria-hidden="true"
          />
          <span
            className={activityTextClass(
              "active",
              "min-w-0 flex-1 truncate text-left",
            )}
          >
            Plan
          </span>
          <Icon
            name="ChevronDown"
            className={cn(
              activityIconClass("active"),
              "size-3.5 shrink-0 transition-transform duration-200",
              isExpanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
        {onExitPlanMode ? (
          <button
            type="button"
            aria-label="Exit plan mode"
            onClick={onExitPlanMode}
            disabled={isExitPending}
            className={PROMPT_MODE_EXIT_BUTTON_CLASS}
          >
            <Icon
              name={isExitPending ? "Loading" : "X"}
              className={cn("size-3.5", isExitPending && "animate-spin")}
              aria-hidden="true"
            />
          </button>
        ) : null}
      </div>
      <section
        id={BODY_ID}
        role="region"
        aria-labelledby={TOGGLE_ID}
        aria-hidden={!isExpanded}
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows,opacity,border-color] duration-200 ease-out",
          isExpanded
            ? "grid-rows-[1fr] border-t border-border opacity-100"
            : "pointer-events-none grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden bg-popover">
          <div className="px-3 pb-2.5 pt-2">
            <p
              className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90"
              title={promptText}
            >
              {hasPrompt ? promptText : "No prompt text."}
            </p>
          </div>
        </div>
      </section>
    </PromptStackCard>
  );
}
