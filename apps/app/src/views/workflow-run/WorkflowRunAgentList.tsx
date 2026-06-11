import { useState } from "react";
import { isSettledWorkflowAgentState } from "@bb/domain";
import type {
  WorkflowAgentSnapshot,
  WorkflowProgressSnapshot,
} from "@bb/domain";
import {
  deriveWorkflowAgentDisplayState,
  type WorkflowRunDisplayState,
} from "@bb/thread-view";
import {
  buildAgentStats,
  groupAgentsByPhase,
  phaseProgressLabel,
  WorkflowAgentStateIcon,
  type WorkflowPhaseGroup,
} from "@/components/workflow/WorkflowAgentTree.js";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

interface AgentListRowProps {
  agent: WorkflowAgentSnapshot;
  isSelected: boolean;
  onSelect: () => void;
  runState: WorkflowRunDisplayState;
}

function AgentListRow({
  agent,
  isSelected,
  onSelect,
  runState,
}: AgentListRowProps) {
  const displayState = deriveWorkflowAgentDisplayState(agent.state, runState);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isSelected ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-state-hover",
        isSelected && "bg-surface-selected",
      )}
    >
      <span className="mt-0.5 inline-flex shrink-0">
        <WorkflowAgentStateIcon state={displayState} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm",
            displayState === "running"
              ? "text-foreground"
              : "text-muted-foreground",
          )}
        >
          {agent.label}
        </span>
        <span className="block truncate text-xs text-subtle-foreground">
          {buildAgentStats(agent, displayState)}
        </span>
        {displayState === "failed" && agent.error ? (
          <span className="mt-0.5 block break-words text-xs text-destructive/80">
            {agent.error}
          </span>
        ) : null}
      </span>
    </button>
  );
}

interface PhaseGroupSectionProps {
  group: WorkflowPhaseGroup;
  onSelectAgent: (agentIndex: number) => void;
  runState: WorkflowRunDisplayState;
  selectedAgentIndex: number | null;
}

function PhaseGroupSection({
  group,
  onSelectAgent,
  runState,
  selectedAgentIndex,
}: PhaseGroupSectionProps) {
  const containsSelection =
    selectedAgentIndex !== null &&
    group.agents.some((agent) => agent.index === selectedAgentIndex);
  const settledClean =
    group.agents.length > 0 &&
    group.agents.every((agent) => isSettledWorkflowAgentState(agent.state)) &&
    !group.agents.some((agent) => agent.state === "failed");
  // Auto-collapse a phase once it settles cleanly so live runs keep the
  // frontier in view; a manual toggle overrides, and a phase holding the
  // selected agent defaults open so the drill-in context never hides itself.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const isOpen = userOpen ?? (containsSelection ? true : !settledClean);

  return (
    <section className="shrink-0 overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setUserOpen(!isOpen)}
        className={cn(
          "flex w-full items-center gap-2 bg-surface-raised px-3 py-1.5 text-left transition-colors hover:bg-state-hover",
          isOpen && "border-b border-border-hairline",
        )}
      >
        <Icon
          name="ChevronDown"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            !isOpen && "-rotate-90",
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {group.phase?.title ?? "Agents"}
        </span>
        <span className="ml-auto shrink-0 text-xs text-subtle-foreground">
          {phaseProgressLabel(group.agents)}
        </span>
      </button>
      {isOpen && group.agents.length > 0 ? (
        <div className="flex flex-col gap-0.5 p-1.5">
          {group.agents.map((agent) => (
            <AgentListRow
              key={agent.index}
              agent={agent}
              isSelected={agent.index === selectedAgentIndex}
              onSelect={() => {
                onSelectAgent(agent.index);
              }}
              runState={runState}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export interface WorkflowRunAgentListProps {
  onSelectAgent: (agentIndex: number) => void;
  runState: WorkflowRunDisplayState;
  /** Journal-stable index of the agent open in the chat panel, or null. */
  selectedAgentIndex: number | null;
  snapshot: WorkflowProgressSnapshot;
}

/**
 * Run-page navigation list: the phase-grouped agents as collapsible cards
 * with clickable rows that drive the agent chat panel. The inline timeline
 * row keeps the compact non-interactive `WorkflowAgentTree`; both share the
 * state icon, stats line, and phase grouping.
 */
export function WorkflowRunAgentList({
  onSelectAgent,
  runState,
  selectedAgentIndex,
  snapshot,
}: WorkflowRunAgentListProps) {
  const groups = groupAgentsByPhase(snapshot.phases, snapshot.agents);
  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => (
        <PhaseGroupSection
          key={group.phase?.index ?? "unphased"}
          group={group}
          onSelectAgent={onSelectAgent}
          runState={runState}
          selectedAgentIndex={selectedAgentIndex}
        />
      ))}
    </div>
  );
}
