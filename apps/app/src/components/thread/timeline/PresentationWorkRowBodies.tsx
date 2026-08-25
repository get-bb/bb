import type { ThreadEventPlanStep } from "@bb/domain";
import type { TimelineRowPresentation } from "@bb/server-contract";
import type { TimelineViewWorkRow } from "@bb/thread-view";
import {
  activityIconClass,
  activityRowClass,
  activityTextClass,
  type ActivityRowState,
} from "@bb/shared-ui/activity-row-styles";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { MarkdownPreview } from "../../ui/markdown-preview.js";

/**
 * The declarative base for a row's expanded body: the bridge's short
 * Markdown `detail` (length-capped at ingest), rendered read-only with no
 * images. Every presented kind may carry one; an extension row has nothing
 * else unless a plugin registered a renderer for its kind.
 */
export function PresentationDetail({
  presentation,
}: {
  presentation: TimelineRowPresentation | undefined;
}) {
  const detail = presentation?.detail;
  if (detail === undefined || detail.trim().length === 0) {
    return null;
  }
  return (
    <MarkdownPreview
      content={detail}
      className="text-xs text-muted-foreground"
      imagePolicy="alt-text"
    />
  );
}

type PlanStepStatus = NonNullable<ThreadEventPlanStep["status"]>;

const PLAN_STEP_ACTIVITY_STATE: Record<PlanStepStatus, ActivityRowState> = {
  pending: "pending",
  active: "active",
  completed: "completed",
  failed: "completed",
};

const PLAN_STEP_ICON: Record<PlanStepStatus, IconName> = {
  pending: "Square",
  active: "Square",
  completed: "Check",
  failed: "X",
};

/**
 * A plan snapshot's steps in the order the agent keeps them (the todo banner
 * re-sorts by status; the row is the historical record and keeps the
 * agent's order).
 */
export function PlanStepsWorkRowBody({
  row,
}: {
  row: Extract<TimelineViewWorkRow, { workKind: "plan-steps" }>;
}) {
  return (
    <div className="space-y-2">
      <PresentationDetail presentation={row.presentation} />
      {row.explanation ? (
        <p className="text-xs text-muted-foreground">{row.explanation}</p>
      ) : null}
      <ul className="space-y-1" data-testid="plan-steps-body">
        {row.steps.map((step, index) => {
          const status = step.status ?? "pending";
          const activityState = PLAN_STEP_ACTIVITY_STATE[status];
          return (
            <li
              key={`${index}:${step.step}`}
              className={activityRowClass(
                activityState,
                "flex min-w-0 items-center gap-2 text-xs",
              )}
              data-plan-step-status={status}
            >
              <Icon
                name={PLAN_STEP_ICON[status]}
                className={cn(
                  "size-3.5 shrink-0",
                  status === "active"
                    ? "text-foreground"
                    : activityIconClass(activityState),
                )}
                aria-hidden="true"
              />
              <span
                className={activityTextClass(
                  activityState,
                  "min-w-0 flex-1 truncate",
                )}
                title={step.step}
              >
                {step.step}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
