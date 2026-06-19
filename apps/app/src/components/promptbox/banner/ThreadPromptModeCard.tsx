import type { ThreadTimelineActivePromptMode } from "@bb/domain";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { Icon } from "@/components/ui/icon.js";

const PROMPT_MODE_CARD_ROW_HEIGHT = 32;

export interface ThreadPromptModeCardProps {
  activePromptMode: ThreadTimelineActivePromptMode | null;
}

export function ThreadPromptModeCard({
  activePromptMode,
}: ThreadPromptModeCardProps) {
  if (activePromptMode?.mode !== "plan") {
    return null;
  }

  return (
    <PromptStackCard
      ariaLabel="Prompt mode"
      style={{ minHeight: PROMPT_MODE_CARD_ROW_HEIGHT }}
    >
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-foreground">
        <Icon
          name="ListTodo"
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate font-medium opacity-70">
          Creating plan
        </span>
      </div>
    </PromptStackCard>
  );
}
