import type { ThreadTimelineActivePromptMode } from "@bb/domain";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

const PROMPT_MODE_CARD_ROW_HEIGHT = 32;
const PROMPT_PREVIEW_MAX_CHARS = 420;

export interface ThreadPromptModeCardProps {
  activePromptMode: ThreadTimelineActivePromptMode | null;
  isExpanded: boolean;
  onExitPlanMode?: () => void;
  onToggle: () => void;
}

const BODY_ID = "thread-prompt-mode-card-body";
const TOGGLE_ID = "thread-prompt-mode-card-toggle";

function truncatedPrompt(prompt: string): string {
  if (prompt.length <= PROMPT_PREVIEW_MAX_CHARS) {
    return prompt;
  }
  return `${prompt.slice(0, PROMPT_PREVIEW_MAX_CHARS).trimEnd()}...`;
}

export function ThreadPromptModeCard({
  activePromptMode,
  isExpanded,
  onExitPlanMode,
  onToggle,
}: ThreadPromptModeCardProps) {
  if (activePromptMode?.mode !== "plan") {
    return null;
  }
  const promptPreview = truncatedPrompt(activePromptMode.prompt);
  const hasPrompt = promptPreview.length > 0;

  return (
    <PromptStackCard
      ariaLabel="Prompt mode"
      className="overflow-hidden"
      style={{ minHeight: PROMPT_MODE_CARD_ROW_HEIGHT }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1">
        <button
          type="button"
          id={TOGGLE_ID}
          aria-expanded={isExpanded}
          aria-controls={BODY_ID}
          aria-label="Plan mode: Creating plan"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-xs text-foreground transition-colors hover:bg-state-hover"
        >
          <Icon
            name="ListTodo"
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="shrink-0 font-medium opacity-70">
            Creating plan
          </span>
          {hasPrompt ? (
            <span
              className="min-w-0 flex-1 truncate text-left text-muted-foreground"
              title={activePromptMode.prompt}
            >
              {promptPreview}
            </span>
          ) : null}
          <Icon
            name="ChevronDown"
            className={cn(
              "size-3.5 shrink-0 text-subtle-foreground transition-transform duration-200",
              isExpanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
        {onExitPlanMode ? (
          <button
            type="button"
            aria-label="Exit plan mode"
            title="Exit plan mode"
            onClick={onExitPlanMode}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
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
            : "pointer-events-none grid-rows-[0fr] border-t border-transparent opacity-0",
        )}
      >
        <div className="overflow-hidden bg-popover">
          <div className="px-3 pb-2.5 pt-2">
            <p
              className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90"
              title={activePromptMode.prompt}
            >
              {hasPrompt ? promptPreview : "No prompt text."}
            </p>
          </div>
        </div>
      </section>
    </PromptStackCard>
  );
}
