import { useEffect, useState } from "react";
import {
  isBackgroundCommandTaskType,
  isSettledWorkflowAgentState,
} from "@bb/domain";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import { durationToCompactString } from "@bb/thread-view";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { WorkflowWorkRowBody } from "@/components/thread/timeline/WorkflowWorkRowBody";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

const WORKFLOW_CARD_ROW_HEIGHT = 32;
const BODY_ID = "thread-workflow-card-body";
const TOGGLE_ID = "thread-workflow-card-toggle";

/**
 * Live elapsed time since the workflow started, ticking every second. Mirrors
 * the timeline title's live duration; stays blank for the first second to avoid
 * sub-second flicker on entry.
 */
function WorkflowDuration({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);
  useEffect(() => {
    setElapsed(Date.now() - startedAt);
    const interval = window.setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [startedAt]);
  if (elapsed <= 1_000) {
    return null;
  }
  return <>{durationToCompactString(elapsed)}</>;
}

function agentProgressLabel(workflow: TimelineWorkflowWorkRow): string | null {
  const agents = workflow.workflow?.agents ?? [];
  if (agents.length === 0) {
    return null;
  }
  const settled = agents.filter((agent) =>
    isSettledWorkflowAgentState(agent.state),
  ).length;
  return `(${settled}/${agents.length} agents)`;
}

export interface ThreadWorkflowCardProps {
  workflow: TimelineWorkflowWorkRow | null;
  isExpanded: boolean;
  onToggle: () => void;
}

/**
 * Collapsible card for the prompt stack above the composer. Surfaces a running
 * background task the same way ThreadGoalCard surfaces the active goal: a
 * Workflow tool run shows the workflow name, agent progress, and live elapsed
 * time and expands to the full phase/agent tree; a backgrounded shell command
 * (Bash run_in_background) shows the command description and live elapsed time.
 * Reuses WorkflowWorkRowBody so there is a single rendering path. Only rendered
 * while the task is running — once it settles it drops out of the prompt stack
 * and its timeline row carries the terminal state. A running shell command has
 * no body yet, so the card renders as a non-expandable single line.
 */
export function ThreadWorkflowCard({
  workflow,
  isExpanded,
  onToggle,
}: ThreadWorkflowCardProps) {
  if (!workflow || workflow.status !== "pending") {
    return null;
  }
  const isCommand = isBackgroundCommandTaskType(workflow.taskType);
  const name = workflow.workflowName ?? workflow.description;
  const progress = agentProgressLabel(workflow);
  const label = isCommand ? "Background command" : "Workflow";
  const verb = isCommand ? "Running background command:" : "Running workflow:";
  const iconName = isCommand ? "Terminal" : "Workflow";
  const hasBody =
    workflow.workflow !== null ||
    workflow.summary !== null ||
    workflow.error !== null;

  const header = (
    <span className="flex min-w-0 flex-1 items-center gap-1 text-left">
      <span className="shrink-0 text-muted-foreground">{verb}</span>
      <span
        className="min-w-0 truncate font-medium text-foreground opacity-70"
        title={name}
      >
        {name}
      </span>
      {progress ? (
        <span className="shrink-0 text-muted-foreground">{progress}</span>
      ) : null}
      <span className="shrink-0 text-muted-foreground">
        <WorkflowDuration startedAt={workflow.startedAt} />
      </span>
    </span>
  );

  return (
    <PromptStackCard
      ariaLabel={label}
      className="overflow-hidden"
      style={{ minHeight: WORKFLOW_CARD_ROW_HEIGHT }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1">
        {hasBody ? (
          <button
            type="button"
            id={TOGGLE_ID}
            aria-expanded={isExpanded}
            aria-controls={BODY_ID}
            aria-label={`${label}: ${name}`}
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-xs text-foreground transition-colors hover:bg-state-hover"
          >
            <Icon
              name={iconName}
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            {header}
            <Icon
              name="ChevronDown"
              className={cn(
                "size-3.5 shrink-0 text-subtle-foreground transition-transform duration-200",
                isExpanded && "rotate-180",
              )}
              aria-hidden="true"
            />
          </button>
        ) : (
          <div
            className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-0.5 text-xs text-foreground"
            aria-label={`${label}: ${name}`}
          >
            <Icon
              name={iconName}
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            {header}
          </div>
        )}
      </div>
      {hasBody ? (
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
            <WorkflowWorkRowBody row={workflow} />
          </div>
        </section>
      ) : null}
    </PromptStackCard>
  );
}
