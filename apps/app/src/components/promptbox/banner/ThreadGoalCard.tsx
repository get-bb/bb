import type { ThreadTimelineGoal } from "@bb/domain";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

const GOAL_CARD_ROW_HEIGHT = 32;

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

export interface ThreadGoalCardProps {
  goal: ThreadTimelineGoal | null;
  isExpanded: boolean;
  onToggle: () => void;
}

const BODY_ID = "thread-goal-card-body";
const TOGGLE_ID = "thread-goal-card-toggle";

/**
 * Collapsible goal card for the prompt stack above the composer. Surfaces the
 * provider's current durable objective (Codex `thread/goal/*` events projected
 * onto the timeline). Collapsed: objective. Expanded: full objective +
 * token/time usage. Mirrors the ThreadPromptContextBanner section chrome. Only
 * rendered while the goal is active — once the provider marks it complete (or
 * paused / budget-limited) it drops out of the prompt stack.
 */
export function ThreadGoalCard({
  goal,
  isExpanded,
  onToggle,
}: ThreadGoalCardProps) {
  if (!goal || goal.status !== "active") {
    return null;
  }
  const objective = goal.objective.trim();
  const hasObjective = objective.length > 0;
  return (
    <PromptStackCard
      ariaLabel="Goal"
      className="overflow-hidden"
      style={{ minHeight: GOAL_CARD_ROW_HEIGHT }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1">
        <button
          type="button"
          id={TOGGLE_ID}
          aria-expanded={isExpanded}
          aria-controls={BODY_ID}
          aria-label="Goal"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-xs text-foreground transition-colors hover:bg-state-hover"
        >
          <Icon
            name="Target"
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          {hasObjective ? (
            <span className="flex min-w-0 flex-1 items-center gap-1 text-left">
              <span className="shrink-0 text-muted-foreground">Goal:</span>
              <span
                className="min-w-0 truncate font-medium text-foreground opacity-70"
                title={objective}
              >
                {objective}
              </span>
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-left font-medium opacity-70">
              Goal
            </span>
          )}
          <Icon
            name="ChevronDown"
            className={cn(
              "size-3.5 shrink-0 text-subtle-foreground transition-transform duration-200",
              isExpanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
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
          <div className="space-y-2 px-3 pb-2.5 pt-2">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
              {goal.objective}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Icon
                  name="Zap"
                  className="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                {formatTokenUsage(goal)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Icon
                  name="Clock"
                  className="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                {formatDuration(goal.timeUsedSeconds)}
              </span>
            </div>
          </div>
        </div>
      </section>
    </PromptStackCard>
  );
}
