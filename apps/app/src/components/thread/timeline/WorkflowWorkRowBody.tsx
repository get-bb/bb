import { isSettledWorkflowAgentState } from "@bb/domain";
import type {
  WorkflowAgentSnapshot,
  WorkflowPhaseSnapshot,
} from "@bb/domain";
import type { TimelineViewWorkflowWorkRow } from "@bb/thread-view";
import { Icon } from "../../ui/icon.js";
import { TimelineDetailScroll } from "./TimelineDetailScroll.js";
import { cn } from "@/lib/utils";

/**
 * Display state per agent. "interrupted" is derived, not persisted: a settled
 * workflow can leave queued/running agents behind (stop, crash, daemon loss).
 */
type WorkflowAgentDisplayState = WorkflowAgentSnapshot["state"] | "interrupted";

function deriveAgentDisplayState(
  agent: WorkflowAgentSnapshot,
  workflowSettled: boolean,
): WorkflowAgentDisplayState {
  if (workflowSettled && !isSettledWorkflowAgentState(agent.state)) {
    return "interrupted";
  }
  return agent.state;
}

function WorkflowAgentStateIcon({
  state,
}: {
  state: WorkflowAgentDisplayState;
}) {
  const className = "size-3.5 shrink-0";
  switch (state) {
    case "done":
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
          name="X"
          className={cn(className, "text-destructive/80")}
          aria-hidden="true"
        />
      );
    case "skipped":
      return (
        <Icon
          name="X"
          className={cn(className, "text-muted-foreground/45")}
          aria-hidden="true"
        />
      );
    case "running":
      return (
        <Icon
          name="Square"
          className={cn(className, "fill-current text-muted-foreground/30")}
          aria-hidden="true"
        />
      );
    case "queued":
    case "interrupted":
      return (
        <Icon
          name="Square"
          className={cn(className, "text-muted-foreground/45")}
          aria-hidden="true"
        />
      );
  }
}

function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${tokens}`;
}

function formatCompactDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

function shortModelName(model: string): string {
  // "claude-haiku-4-5-20251001" → "haiku"; pass through aliases like "haiku".
  const match = /^claude-([a-z]+)/.exec(model);
  return match?.[1] ?? model;
}

function buildAgentStats(
  agent: WorkflowAgentSnapshot,
  displayState: WorkflowAgentDisplayState,
): string {
  const parts: string[] = [];
  if (agent.agentType) {
    parts.push(agent.agentType);
  }
  parts.push(shortModelName(agent.model));
  if (agent.tokens !== undefined && agent.tokens > 0) {
    parts.push(`${formatCompactTokens(agent.tokens)} tok`);
  }
  if (agent.toolCalls !== undefined && agent.toolCalls > 0) {
    parts.push(
      `${agent.toolCalls} ${agent.toolCalls === 1 ? "tool" : "tools"}`,
    );
  }
  if (agent.durationMs !== undefined) {
    parts.push(formatCompactDuration(agent.durationMs));
  }
  if (agent.attempt > 1) {
    parts.push(`attempt ${agent.attempt}`);
  }
  if (agent.cached) {
    parts.push("cached");
  }
  if (displayState === "queued") {
    parts.push("queued");
  }
  if (displayState === "interrupted") {
    parts.push("stopped");
  }
  return parts.join(" · ");
}

function WorkflowAgentLine({
  agent,
  workflowSettled,
}: {
  agent: WorkflowAgentSnapshot;
  workflowSettled: boolean;
}) {
  const displayState = deriveAgentDisplayState(agent, workflowSettled);
  return (
    <div className="flex min-w-0 items-center gap-2 px-2 py-0.5">
      <WorkflowAgentStateIcon state={displayState} />
      <span
        className={cn(
          "min-w-0 truncate text-xs",
          displayState === "running"
            ? "text-foreground"
            : "text-muted-foreground",
        )}
      >
        {agent.label}
      </span>
      <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-subtle-foreground">
        {buildAgentStats(agent, displayState)}
      </span>
      {displayState === "failed" && agent.error ? (
        <span className="min-w-0 truncate text-xs text-destructive/80">
          — {agent.error}
        </span>
      ) : null}
    </div>
  );
}

interface WorkflowPhaseGroup {
  agents: WorkflowAgentSnapshot[];
  phase: WorkflowPhaseSnapshot | null;
}

/**
 * Groups agents under their phases in phase-index order, preserving declared
 * phases that have not started yet and collecting phase-less agents into a
 * trailing group.
 */
function groupAgentsByPhase(
  phases: readonly WorkflowPhaseSnapshot[],
  agents: readonly WorkflowAgentSnapshot[],
): WorkflowPhaseGroup[] {
  const groups: WorkflowPhaseGroup[] = [];
  const byIndex = new Map<number, WorkflowPhaseGroup>();
  for (const phase of phases) {
    const group: WorkflowPhaseGroup = { phase, agents: [] };
    groups.push(group);
    byIndex.set(phase.index, group);
  }
  const unphased: WorkflowAgentSnapshot[] = [];
  for (const agent of agents) {
    const group =
      agent.phaseIndex !== undefined ? byIndex.get(agent.phaseIndex) : null;
    if (group) {
      group.agents.push(agent);
    } else {
      unphased.push(agent);
    }
  }
  if (unphased.length > 0) {
    groups.push({ phase: null, agents: unphased });
  }
  return groups;
}

function phaseProgressLabel(agents: readonly WorkflowAgentSnapshot[]): string {
  if (agents.length === 0) {
    return "not started";
  }
  const settled = agents.filter((agent) =>
    isSettledWorkflowAgentState(agent.state),
  ).length;
  return `${settled}/${agents.length}`;
}

export function WorkflowWorkRowBody({
  row,
}: {
  row: TimelineViewWorkflowWorkRow;
}) {
  const workflowSettled = row.status !== "pending";

  if (!row.workflow) {
    // Degraded body: no progress records — show the terminal summary or error.
    if (!row.summary && !row.error) {
      return null;
    }
    return (
      <div className="px-2 py-1 text-xs text-muted-foreground">
        {row.summary ?? row.error}
      </div>
    );
  }

  const groups = groupAgentsByPhase(row.workflow.phases, row.workflow.agents);
  // Sticky-bottom scroll keys off agent activity so live progress stays visible.
  const contentKey = row.workflow.agents
    .map((agent) => `${agent.index}:${agent.state}:${agent.lastProgressAt}`)
    .join("|");

  return (
    <TimelineDetailScroll
      size="delegation"
      streaming={row.status === "pending"}
      contentKey={contentKey}
    >
      <div className="flex flex-col gap-1 py-1">
        {groups.map((group) => (
          <div key={group.phase?.index ?? "unphased"}>
            {group.phase ? (
              <div className="flex items-baseline gap-2 px-2 py-0.5">
                <span className="text-xs font-medium text-foreground">
                  {group.phase.title}
                </span>
                <span className="text-xs text-subtle-foreground">
                  {phaseProgressLabel(group.agents)}
                </span>
              </div>
            ) : null}
            {group.agents.map((agent) => (
              <WorkflowAgentLine
                key={agent.index}
                agent={agent}
                workflowSettled={workflowSettled}
              />
            ))}
          </div>
        ))}
        {row.error ? (
          <div className="px-2 py-0.5 text-xs text-destructive/80">
            {row.error}
          </div>
        ) : null}
      </div>
    </TimelineDetailScroll>
  );
}
