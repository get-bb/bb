import { isSettledWorkflowAgentState } from "@bb/domain";
import type {
  WorkflowAgentSnapshot,
  WorkflowPhaseSnapshot,
  WorkflowProgressSnapshot,
} from "@bb/domain";
import {
  deriveWorkflowAgentDisplayState,
  type WorkflowAgentDisplayState,
  type WorkflowRunDisplayState,
} from "@bb/thread-view";
import { Icon } from "../ui/icon.js";
import { cn } from "@/lib/utils";

/**
 * Shared agent-state glyph for every workflow agent surface (inline tree,
 * run-page agent list, chat panel header).
 */
export function WorkflowAgentStateIcon({
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
    case "paused":
      return (
        <Icon
          name="Pause"
          className={cn(className, "text-muted-foreground/60")}
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

/**
 * One-line agent metadata (`agentType · model · tokens · tools · duration …`)
 * shared by the inline tree and the run page's agent list.
 */
export function buildAgentStats(
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
  if (displayState === "paused") {
    parts.push("paused");
  }
  if (displayState === "interrupted") {
    parts.push("stopped");
  }
  return parts.join(" · ");
}

function WorkflowAgentLine({
  agent,
  runState,
}: {
  agent: WorkflowAgentSnapshot;
  runState: WorkflowRunDisplayState;
}) {
  const displayState = deriveWorkflowAgentDisplayState(agent.state, runState);
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

export interface WorkflowPhaseGroup {
  agents: WorkflowAgentSnapshot[];
  phase: WorkflowPhaseSnapshot | null;
}

/**
 * Groups agents under their phases in phase-index order, preserving declared
 * phases that have not started yet and collecting phase-less agents into a
 * trailing group.
 */
export function groupAgentsByPhase(
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

/** Settled-over-total progress label for one phase ("2/3", "not started"). */
export function phaseProgressLabel(
  agents: readonly WorkflowAgentSnapshot[],
): string {
  if (agents.length === 0) {
    return "not started";
  }
  const settled = agents.filter((agent) =>
    isSettledWorkflowAgentState(agent.state),
  ).length;
  return `${settled}/${agents.length}`;
}

export interface WorkflowAgentTreeProps {
  runState: WorkflowRunDisplayState;
  snapshot: WorkflowProgressSnapshot;
}

/**
 * The canonical phase-grouped agent tree for a workflow progress snapshot —
 * the single rendering path shared by the inline timeline workflow row and
 * the run page. Pure presentation: callers own scrolling, liveness, and any
 * run-level summary/error chrome around it.
 */
export function WorkflowAgentTree({ runState, snapshot }: WorkflowAgentTreeProps) {
  const groups = groupAgentsByPhase(snapshot.phases, snapshot.agents);
  return (
    <div className="flex flex-col gap-1">
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
              runState={runState}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
