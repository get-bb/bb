import type { ReactNode } from "react";
import type { WorkflowAgentSnapshot } from "@bb/domain";
import {
  deriveWorkflowAgentDisplayState,
  type WorkflowRunDisplayState,
} from "@bb/thread-view";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body.js";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import {
  buildAgentStats,
  WorkflowAgentStateIcon,
} from "@/components/workflow/WorkflowAgentTree.js";

export interface WorkflowAgentChatPanelProps {
  /**
   * Snapshot row for the selected agent; null when the URL names an index the
   * snapshot doesn't know (stale link, snapshot still loading). The timeline
   * body renders either way — its query needs only the index.
   */
  agent: WorkflowAgentSnapshot | null;
  agentIndex: number;
  /** The rendered drill-in timeline (the caller wires the event-log query). */
  children: ReactNode;
  onClose: () => void;
  runState: WorkflowRunDisplayState;
}

/**
 * Right-hand chat panel of the run page: one agent's event log rendered as a
 * standard bb thread timeline, with a header carrying the agent's identity,
 * stats, and a close affordance back to the run route.
 */
export function WorkflowAgentChatPanel({
  agent,
  agentIndex,
  children,
  onClose,
  runState,
}: WorkflowAgentChatPanelProps) {
  const displayState = agent
    ? deriveWorkflowAgentDisplayState(agent.state, runState)
    : null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-hairline px-4 py-2">
        {displayState ? <WorkflowAgentStateIcon state={displayState} /> : null}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {agent?.label ?? `agent ${agentIndex}`}
        </span>
        {agent && displayState ? (
          <span className="shrink-0 truncate text-xs text-subtle-foreground">
            {buildAgentStats(agent, displayState)}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 rounded-md p-0 text-muted-foreground"
          aria-label="Close agent timeline"
          title="Close agent timeline"
          onClick={onClose}
        >
          <Icon name="X" className="size-3.5" />
        </Button>
      </header>
      <BottomAnchoredScrollBody
        footer={null}
        maxWidthClassName="max-w-[760px]"
        contentClassName="px-4 py-3"
      >
        {children}
      </BottomAnchoredScrollBody>
    </div>
  );
}
