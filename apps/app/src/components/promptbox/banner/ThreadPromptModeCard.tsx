import type { ThreadTimelineActivePromptMode } from "@bb/domain";
import { CollapsibleActiveStackCard } from "@/components/promptbox/banner/CollapsibleActiveStackCard";

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
    <CollapsibleActiveStackCard
      cardAriaLabel="Prompt mode"
      controlsAriaLabel="Plan mode controls"
      toggleId={TOGGLE_ID}
      bodyId={BODY_ID}
      toggleAriaLabel="Plan"
      iconName="ListTodo"
      title="Plan"
      isExpanded={isExpanded}
      onToggle={onToggle}
      dismiss={
        onExitPlanMode
          ? {
              ariaLabel: "Exit plan mode",
              isPending: isExitPending,
              onDismiss: onExitPlanMode,
            }
          : null
      }
    >
      <div className="px-3 pb-2.5 pt-2">
        <p
          className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90"
          title={promptText}
        >
          {hasPrompt ? promptText : "No prompt text."}
        </p>
      </div>
    </CollapsibleActiveStackCard>
  );
}
