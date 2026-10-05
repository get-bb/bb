import { useEffect, useId, useRef } from "react";
import { isSettledWorkflowAgentState } from "@bb/domain";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import { AnimatedBody } from "@/components/promptbox/banner/AnimatedBody";
import {
  PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PromptStackCard,
} from "@/components/promptbox/banner/PromptStackCard";
import { LiveDurationText } from "@/components/thread/timeline/LiveDurationText";
import { WorkflowWorkRowBody } from "@/components/thread/timeline/WorkflowWorkRowBody";
import { activityIconClass } from "@bb/shared-ui/activity-row-styles";
import { Icon } from "@bb/shared-ui/icon";
import { WorkflowPhaseStrip } from "@bb/shared-ui/workflow-progress";

export const WORKFLOW_COLLAPSE_ROW_CLASS =
  "flex min-h-6 w-full cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground";

function agentProgressLabel(workflow: TimelineWorkflowWorkRow): string | null {
  const agents = workflow.workflow?.agents ?? [];
  if (agents.length === 0) {
    return null;
  }
  const settled = agents.filter((agent) =>
    isSettledWorkflowAgentState(agent.state),
  ).length;
  return `${settled}/${agents.length} agents`;
}

interface ThreadWorkflowCardProps {
  workflow: TimelineWorkflowWorkRow;
  isExpanded: boolean;
  onToggle: () => void;
}

export function ThreadWorkflowSummary({
  workflow,
}: {
  workflow: TimelineWorkflowWorkRow;
}) {
  const name = workflow.workflowName ?? workflow.description;
  const progress = agentProgressLabel(workflow);
  return (
    <>
      <Icon
        name="Workflow"
        className={activityIconClass("active", "size-3.5 shrink-0")}
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <span
          className="min-w-0 truncate font-medium text-foreground"
          title={name}
        >
          {name}
        </span>
        {progress ? (
          <span className="shrink-0 text-2xs tabular-nums text-subtle-foreground">
            {progress}
          </span>
        ) : null}
        <span className="shrink-0 text-2xs tabular-nums text-subtle-foreground">
          <LiveDurationText startedAt={workflow.startedAt} />
        </span>
      </span>
      {workflow.workflow ? (
        <WorkflowPhaseStrip
          progress={workflow.workflow}
          settled={false}
          className="w-16 shrink-0"
        />
      ) : null}
    </>
  );
}

export function ThreadWorkflowCard({
  workflow,
  isExpanded,
  onToggle,
}: ThreadWorkflowCardProps) {
  const bodyId = useId();
  const toggleId = useId();
  const headerRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<"header" | "collapse" | null>(null);
  useEffect(() => {
    const target =
      pendingFocus.current === "collapse"
        ? collapseRef.current
        : pendingFocus.current === "header"
          ? headerRef.current
          : null;
    pendingFocus.current = null;
    target?.focus();
  }, [isExpanded]);
  if (workflow.status !== "pending") {
    return null;
  }
  const name = workflow.workflowName ?? workflow.description;
  return (
    <PromptStackCard
      ariaLabel="Workflow"
      className="overflow-hidden"
      style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
    >
      <button
        ref={headerRef}
        type="button"
        id={toggleId}
        aria-expanded={isExpanded}
        aria-controls={bodyId}
        aria-label={`Workflow: ${name}`}
        onClick={() => {
          pendingFocus.current = isExpanded ? null : "collapse";
          onToggle();
        }}
        className={PROMPT_STACK_CARD_HEADER_BUTTON_CLASS}
      >
        <ThreadWorkflowSummary workflow={workflow} />
      </button>
      <AnimatedBody
        id={bodyId}
        labelledBy={toggleId}
        isExpanded={isExpanded}
        collapsedBorder="none"
      >
        <WorkflowWorkRowBody row={workflow} size="base" collapsiblePhases />
        <div className="px-1 pb-1">
          <button
            ref={collapseRef}
            type="button"
            aria-expanded={isExpanded}
            aria-controls={bodyId}
            aria-label={`Collapse workflow ${name}`}
            onClick={() => {
              pendingFocus.current = "header";
              onToggle();
            }}
            className={WORKFLOW_COLLAPSE_ROW_CLASS}
          >
            <Icon name="ChevronUp" className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </AnimatedBody>
    </PromptStackCard>
  );
}
