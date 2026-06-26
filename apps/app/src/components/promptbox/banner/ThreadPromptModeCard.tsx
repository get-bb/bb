import type { ThreadTimelineActivePromptMode } from "@bb/domain";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import {
  activityIconClass,
  activityRowClass,
  activityTextClass,
} from "@/components/ui/activity-row-styles";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

const PROMPT_MODE_CARD_ROW_HEIGHT = 32;
const PROMPT_MODE_HEADER_BUTTON_CLASS = activityRowClass(
  "active",
  "flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-none px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-background/80",
);

export interface ThreadPromptModeCardProps {
  activePromptMode: ThreadTimelineActivePromptMode | null;
  isExpanded: boolean;
  onExitPlanMode?: () => void;
  onToggle: () => void;
}

const BODY_ID = "thread-prompt-mode-card-body";
const TOGGLE_ID = "thread-prompt-mode-card-toggle";

export function ThreadPromptModeCard({
  activePromptMode,
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
      style={{ minHeight: PROMPT_MODE_CARD_ROW_HEIGHT }}
    >
      <div className="flex items-center">
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
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
          >
            <Icon name="X" className="size-3.5" aria-hidden="true" />
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
