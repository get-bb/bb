import type { ThreadTimelineActivePromptMode } from "@bb/domain";
import { CollapsibleStackCard } from "@/components/promptbox/banner/CollapsibleStackCard";

interface ThreadPromptModeCardProps {
  activePromptMode: ThreadTimelineActivePromptMode | null;
  onExitPlanMode?: () => Promise<void>;
}

export function ThreadPromptModeCard({
  activePromptMode,
  onExitPlanMode,
}: ThreadPromptModeCardProps) {
  if (activePromptMode?.mode !== "plan") {
    return null;
  }
  const promptText = activePromptMode.prompt.trim();
  const hasPrompt = promptText.length > 0;

  return (
    <CollapsibleStackCard
      label="Plan"
      title="Plan"
      icon="ListTodo"
      isActive
      {...(onExitPlanMode
        ? {
            dismiss: {
              label: "Exit plan mode",
              failureMessage: "Failed to exit Plan mode.",
              onDismiss: onExitPlanMode,
            },
          }
        : {})}
    >
      <div className="px-3 pb-2.5 pt-2">
        <p
          className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90"
          title={promptText}
        >
          {hasPrompt ? promptText : "No prompt text."}
        </p>
      </div>
    </CollapsibleStackCard>
  );
}
