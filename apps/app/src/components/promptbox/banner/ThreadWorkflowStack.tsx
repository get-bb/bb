import { useId } from "react";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import {
  PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PromptStackCard,
} from "@/components/promptbox/banner/PromptStackCard";
import {
  ThreadWorkflowCard,
  ThreadWorkflowSummary,
} from "@/components/promptbox/banner/ThreadWorkflowCard";
import {
  PROMPT_STACK_COUNT_PILL_CLASS,
  PromptStackCollapseRow,
  PromptStackPeekLayers,
  useDisclosureFocusHandoff,
} from "@bb/shared-ui/prompt-stack-disclosure";

interface ThreadWorkflowStackProps {
  workflows: readonly TimelineWorkflowWorkRow[];
  isStackExpanded: boolean;
  onToggleStack: () => void;
  expandedWorkflowIds: ReadonlySet<string>;
  onToggleWorkflow: (workflowId: string) => void;
}

export function ThreadWorkflowStack({
  workflows,
  isStackExpanded,
  onToggleStack,
  expandedWorkflowIds,
  onToggleWorkflow,
}: ThreadWorkflowStackProps) {
  const listId = useId();
  const focus = useDisclosureFocusHandoff(isStackExpanded);
  const running = workflows.filter((workflow) => workflow.status === "pending");
  const front = running[0];
  if (!front) {
    return null;
  }
  const stacked = running.length > 1;
  if (stacked && !isStackExpanded) {
    return (
      <PromptStackPeekLayers hiddenCount={running.length - 1}>
        <PromptStackCard
          ariaLabel="Workflows"
          className="overflow-hidden"
          style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
        >
          <button
            ref={focus.triggerRef}
            type="button"
            aria-expanded="false"
            aria-label={`${running.length} workflows running. Show all`}
            onClick={() => {
              focus.focusCollapseAfterToggle();
              onToggleStack();
            }}
            className={PROMPT_STACK_CARD_HEADER_BUTTON_CLASS}
          >
            <ThreadWorkflowSummary workflow={front} />
            <span className={PROMPT_STACK_COUNT_PILL_CLASS}>
              +{running.length - 1}
            </span>
          </button>
        </PromptStackCard>
      </PromptStackPeekLayers>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div id={listId} className="flex flex-col gap-2">
        {running.map((workflow) => (
          <ThreadWorkflowCard
            key={workflow.id}
            workflow={workflow}
            isExpanded={expandedWorkflowIds.has(workflow.id)}
            onToggle={() => onToggleWorkflow(workflow.id)}
          />
        ))}
      </div>
      {stacked ? (
        <PromptStackCollapseRow
          buttonRef={focus.collapseRef}
          controlsId={listId}
          label={`Collapse ${running.length} workflows`}
          onCollapse={() => {
            focus.focusTriggerAfterToggle();
            onToggleStack();
          }}
        />
      ) : null}
    </div>
  );
}
