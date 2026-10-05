import { useEffect, useId, useRef } from "react";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import {
  PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PromptStackCard,
} from "@/components/promptbox/banner/PromptStackCard";
import {
  ThreadWorkflowCard,
  ThreadWorkflowSummary,
  WORKFLOW_COLLAPSE_ROW_CLASS,
} from "@/components/promptbox/banner/ThreadWorkflowCard";
import { CONTEXT_CARD_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

const WORKFLOW_COUNT_PILL_CLASS =
  "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-surface-recessed px-1 text-2xs leading-none tabular-nums text-subtle-foreground";
const PEEK_LAYER_CLASSES: Record<number, readonly string[]> = {
  1: ["inset-x-2 top-1 bottom-0"],
  2: ["inset-x-4 top-2 bottom-0", "inset-x-2 top-1 bottom-1"],
};
const PEEK_PADDING_CLASS: Record<number, string> = { 1: "pb-1", 2: "pb-2" };

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
  const frontButtonRef = useRef<HTMLButtonElement>(null);
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<"front" | "collapse" | null>(null);
  useEffect(() => {
    const target =
      pendingFocus.current === "collapse"
        ? collapseButtonRef.current
        : pendingFocus.current === "front"
          ? frontButtonRef.current
          : null;
    pendingFocus.current = null;
    target?.focus();
  }, [isStackExpanded]);
  const running = workflows.filter((workflow) => workflow.status === "pending");
  const front = running[0];
  if (!front) {
    return null;
  }
  const cards = running.map((workflow) => (
    <ThreadWorkflowCard
      key={workflow.id}
      workflow={workflow}
      isExpanded={expandedWorkflowIds.has(workflow.id)}
      onToggle={() => onToggleWorkflow(workflow.id)}
    />
  ));
  if (running.length === 1) {
    return cards;
  }
  if (isStackExpanded) {
    return (
      <div className="flex flex-col gap-1">
        <div id={listId} className="flex flex-col gap-2">
          {cards}
        </div>
        <button
          ref={collapseButtonRef}
          type="button"
          aria-expanded="true"
          aria-controls={listId}
          onClick={() => {
            pendingFocus.current = "front";
            onToggleStack();
          }}
          aria-label={`Collapse ${running.length} workflows`}
          className={WORKFLOW_COLLAPSE_ROW_CLASS}
        >
          <Icon name="ChevronUp" className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }
  const peekCount = Math.min(running.length - 1, 2);
  return (
    <div className={cn("relative", PEEK_PADDING_CLASS[peekCount])}>
      {(PEEK_LAYER_CLASSES[peekCount] ?? []).map((layerClass) => (
        <div
          key={layerClass}
          aria-hidden="true"
          data-workflow-stack-peek=""
          className={cn("absolute", CONTEXT_CARD_CLASS, layerClass)}
        />
      ))}
      <PromptStackCard
        ariaLabel="Workflows"
        className="relative overflow-hidden"
        style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
      >
        <button
          type="button"
          aria-expanded="false"
          ref={frontButtonRef}
          aria-label={`${running.length} workflows running. Show all`}
          onClick={() => {
            pendingFocus.current = "collapse";
            onToggleStack();
          }}
          className={PROMPT_STACK_CARD_HEADER_BUTTON_CLASS}
        >
          <ThreadWorkflowSummary workflow={front} />
          <span className={WORKFLOW_COUNT_PILL_CLASS}>
            +{running.length - 1}
          </span>
        </button>
      </PromptStackCard>
    </div>
  );
}
