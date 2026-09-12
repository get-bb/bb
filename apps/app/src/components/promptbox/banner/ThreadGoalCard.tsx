import type { ThreadTimelineGoal } from "@bb/domain";
import { CollapsibleActiveStackCard } from "@/components/promptbox/banner/CollapsibleActiveStackCard";
import { Icon } from "@bb/shared-ui/icon";

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = Math.round(seconds % 60);
    return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

function formatTokenUsage(goal: ThreadTimelineGoal): string {
  const used = goal.tokensUsed.toLocaleString();
  if (goal.tokenBudget === null) {
    return `${used} tokens`;
  }
  return `${used} / ${goal.tokenBudget.toLocaleString()} tokens`;
}

interface ThreadGoalCardProps {
  goal: ThreadTimelineGoal | null;
  isClearPending?: boolean;
  isExpanded: boolean;
  onClearGoal?: () => void;
  onToggle: () => void;
}

const BODY_ID = "thread-goal-card-body";
const TOGGLE_ID = "thread-goal-card-toggle";

export function ThreadGoalCard({
  goal,
  isClearPending = false,
  isExpanded,
  onClearGoal,
  onToggle,
}: ThreadGoalCardProps) {
  if (!goal || goal.status !== "active") {
    return null;
  }
  const objective = goal.objective.trim();
  return (
    <CollapsibleActiveStackCard
      cardAriaLabel="Goal"
      controlsAriaLabel="Goal controls"
      toggleId={TOGGLE_ID}
      bodyId={BODY_ID}
      toggleAriaLabel="Goal"
      iconName="Target"
      title="Goal"
      isExpanded={isExpanded}
      onToggle={onToggle}
      dismiss={
        onClearGoal
          ? {
              ariaLabel: "Clear active Goal",
              isPending: isClearPending,
              onDismiss: onClearGoal,
            }
          : null
      }
    >
      <div className="space-y-2 px-3 pb-2.5 pt-2">
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
          {objective.length > 0 ? objective : "No goal objective."}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="Zap" className="size-3.5 shrink-0" aria-hidden="true" />
            {formatTokenUsage(goal)}
          </span>
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <Icon
              name="Clock"
              className="size-3.5 shrink-0"
              aria-hidden="true"
            />
            {formatDuration(goal.timeUsedSeconds)}
          </span>
        </div>
      </div>
    </CollapsibleActiveStackCard>
  );
}
