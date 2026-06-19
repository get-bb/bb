import type {
  ThreadTimelinePendingPlan,
  ThreadTimelinePendingPlanStep,
} from "@bb/domain";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

const PLAN_CARD_ROW_HEIGHT = 32;

export interface ThreadPlanCardProps {
  pendingPlan: ThreadTimelinePendingPlan | null;
  isExpanded: boolean;
  onToggle: () => void;
}

const BODY_ID = "thread-plan-card-body";
const TOGGLE_ID = "thread-plan-card-toggle";

function getPlanSummary(steps: readonly ThreadTimelinePendingPlanStep[]): {
  visible: string;
  aria: string;
} {
  let completedCount = 0;
  for (const step of steps) {
    if (step.status === "completed") completedCount += 1;
  }
  return {
    visible: `${completedCount}/${steps.length} complete`,
    aria: `${completedCount} of ${steps.length} ${
      steps.length === 1 ? "step" : "steps"
    } complete`,
  };
}

function PlanStatusIcon({
  status,
}: {
  status: ThreadTimelinePendingPlanStep["status"];
}) {
  const className = "size-3.5 shrink-0";
  switch (status) {
    case "active":
      return (
        <Icon
          name="Square"
          className={cn(className, "fill-current text-muted-foreground/30")}
          aria-hidden="true"
        />
      );
    case "completed":
      return (
        <Icon
          name="Check"
          className={cn(className, "text-muted-foreground/60")}
          aria-hidden="true"
        />
      );
    case "failed":
      return (
        <Icon
          name="CircleX"
          className={cn(className, "text-destructive")}
          aria-hidden="true"
        />
      );
    case "pending":
      return (
        <Icon
          name="Square"
          className={cn(className, "text-muted-foreground/45")}
          aria-hidden="true"
        />
      );
  }
}

function PlanBody({ plan }: { plan: ThreadTimelinePendingPlan }) {
  return (
    <div className="max-h-48 overflow-y-auto px-3 pb-2 pt-1.5">
      {plan.explanation ? (
        <p className="pb-1.5 text-xs leading-relaxed text-foreground/80">
          {plan.explanation}
        </p>
      ) : null}
      <ul className="space-y-0.5">
        {plan.steps.map((step) => (
          <li
            key={step.id}
            className="flex min-w-0 items-center gap-2 py-0.5 text-xs"
          >
            <PlanStatusIcon status={step.status} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                step.status === "active" && "font-medium text-foreground",
                step.status === "pending" && "text-muted-foreground",
                step.status === "completed" &&
                  "text-subtle-foreground line-through decoration-subtle-foreground",
                step.status === "failed" && "text-destructive",
              )}
              title={step.text}
            >
              {step.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ThreadPlanCard({
  pendingPlan,
  isExpanded,
  onToggle,
}: ThreadPlanCardProps) {
  const steps = pendingPlan?.steps ?? [];
  if (!pendingPlan || steps.length === 0) {
    return null;
  }
  const summary = getPlanSummary(steps);
  return (
    <PromptStackCard
      ariaLabel="Plan"
      className="overflow-hidden"
      style={{ minHeight: PLAN_CARD_ROW_HEIGHT }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1">
        <button
          type="button"
          id={TOGGLE_ID}
          aria-expanded={isExpanded}
          aria-controls={BODY_ID}
          aria-label={`Plan: ${summary.aria}`}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-xs text-foreground transition-colors hover:bg-state-hover"
        >
          <Icon
            name="ListTodo"
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="min-w-0 truncate text-left font-medium text-foreground opacity-80">
            Plan
          </span>
          <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
            {summary.visible}
          </span>
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
          <PlanBody plan={pendingPlan} />
        </div>
      </section>
    </PromptStackCard>
  );
}
