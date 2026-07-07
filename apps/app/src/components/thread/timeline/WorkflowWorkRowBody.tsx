import { useEffect, useRef, useState } from "react";
import { isSettledWorkflowAgentState } from "@bb/domain";
import type {
  WorkflowAgentSnapshot,
  WorkflowPhaseSnapshot,
} from "@bb/domain";
import type { TimelineViewWorkflowWorkRow } from "@bb/thread-view";
import { Icon } from "@bb/shared-ui/icon";
import type { DetailScrollSize } from "../../ui/detail-scroll-size.js";
import { TimelineDetailScroll } from "./TimelineDetailScroll.js";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  activityIconClass,
  activityMetaClass,
  activityRowClass,
  activityTextClass,
  type ActivityRowState,
} from "@/components/ui/activity-row-styles";

/**
 * Display state per agent. "interrupted" is derived, not persisted: a settled
 * workflow can leave queued/running agents behind (stop, crash, daemon loss).
 */
type WorkflowAgentDisplayState = WorkflowAgentSnapshot["state"] | "interrupted";

const PROMPT_STACK_ACTIVE_ROW_CLASS = "shadow-none ring-0";
const PROMPT_STACK_ACTIVE_ICON_CLASS = "text-foreground";

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
  className: overrideClassName,
}: {
  state: WorkflowAgentDisplayState;
  className?: string;
}) {
  const baseClassName = "size-3.5 shrink-0";
  switch (state) {
    case "done":
      return (
        <Icon
          name="Check"
          className={cn(
            baseClassName,
            "text-muted-foreground/60",
            overrideClassName,
          )}
          aria-hidden="true"
        />
      );
    case "failed":
      return (
        <Icon
          name="X"
          className={cn(
            baseClassName,
            "text-destructive/80",
            overrideClassName,
          )}
          aria-hidden="true"
        />
      );
    case "skipped":
      return (
        <Icon
          name="X"
          className={cn(
            baseClassName,
            "text-muted-foreground/45",
            overrideClassName,
          )}
          aria-hidden="true"
        />
      );
    case "running":
      return (
        <Icon
          name="Square"
          className={cn(
            baseClassName,
            "text-muted-foreground",
            overrideClassName,
          )}
          aria-hidden="true"
        />
      );
    case "queued":
    case "interrupted":
      return (
        <Icon
          name="Square"
          className={cn(
            baseClassName,
            "text-muted-foreground/45",
            overrideClassName,
          )}
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

function activityStateForAgent(
  displayState: WorkflowAgentDisplayState,
): ActivityRowState {
  switch (displayState) {
    case "running":
      return "active";
    case "done":
    case "skipped":
      return "completed";
    case "failed":
      return "failed";
    case "queued":
      return "pending";
    case "interrupted":
      return "muted";
  }
}

function promptStackActivityRowClass(
  state: ActivityRowState,
  className?: string,
): string {
  return activityRowClass(
    state,
    cn(state === "active" && PROMPT_STACK_ACTIVE_ROW_CLASS, className),
  );
}

function promptStackActivityIconClass(
  state: ActivityRowState,
  className?: string,
): string {
  if (state === "active") {
    return cn(PROMPT_STACK_ACTIVE_ICON_CLASS, className);
  }
  return activityIconClass(state, className);
}

function WorkflowAgentLine({
  agent,
  promptStack = false,
  workflowSettled,
}: {
  agent: WorkflowAgentSnapshot;
  promptStack?: boolean;
  workflowSettled: boolean;
}) {
  const displayState = deriveAgentDisplayState(agent, workflowSettled);
  const activityState = activityStateForAgent(displayState);
  const stats = buildAgentStats(agent, displayState);
  if (promptStack) {
    return (
      <div
        className={promptStackActivityRowClass(
          activityState,
          "flex min-h-7 w-full min-w-0 items-center gap-2 text-xs",
        )}
      >
        <WorkflowAgentStateIcon
          state={displayState}
          className={promptStackActivityIconClass(activityState)}
        />
        <span
          className={activityTextClass(
            activityState,
            "min-w-0 truncate text-xs",
          )}
          title={agent.label}
        >
          {agent.label}
        </span>
        <span
          className="ml-auto shrink-0 whitespace-nowrap text-xs text-subtle-foreground"
          title={stats}
        >
          {stats}
        </span>
        {displayState === "failed" && agent.error ? (
          <span className="min-w-0 truncate text-xs text-destructive/80">
            — {agent.error}
          </span>
        ) : null}
      </div>
    );
  }
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

function groupKey(group: WorkflowPhaseGroup): string {
  return group.phase ? `phase-${group.phase.index}` : "unphased";
}

/**
 * The phase that should be expanded by default in collapsible mode: the one
 * with a running agent, else the first phase still in flight, else the last
 * phase that ever produced an agent. Returns null when there is nothing to
 * surface (no agents at all).
 */
function activePhaseKey(groups: readonly WorkflowPhaseGroup[]): string | null {
  const running = groups.find((group) =>
    group.agents.some((agent) => agent.state === "running"),
  );
  if (running) {
    return groupKey(running);
  }
  const inFlight = groups.find(
    (group) =>
      group.agents.length > 0 &&
      !group.agents.every((agent) => isSettledWorkflowAgentState(agent.state)),
  );
  if (inFlight) {
    return groupKey(inFlight);
  }
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i].agents.length > 0) {
      return groupKey(groups[i]);
    }
  }
  return null;
}

function activityStateForPhase({
  group,
  isActive,
  workflowSettled,
}: {
  group: WorkflowPhaseGroup;
  isActive: boolean;
  workflowSettled: boolean;
}): ActivityRowState {
  if (isActive && !workflowSettled) {
    return "active";
  }
  if (group.agents.some((agent) => agent.state === "failed")) {
    return "failed";
  }
  if (
    group.agents.length > 0 &&
    group.agents.every((agent) => isSettledWorkflowAgentState(agent.state))
  ) {
    return "completed";
  }
  if (group.agents.length === 0) {
    return "muted";
  }
  return "pending";
}

function StaticPhaseGroup({
  group,
  workflowSettled,
}: {
  group: WorkflowPhaseGroup;
  workflowSettled: boolean;
}) {
  const agentLines = group.agents.map((agent) => (
    <WorkflowAgentLine
      key={agent.index}
      agent={agent}
      workflowSettled={workflowSettled}
    />
  ));
  // Phase-less trailing agents have no header.
  if (!group.phase) {
    return <div>{agentLines}</div>;
  }
  return (
    <div>
      <div className="flex items-baseline gap-2 px-2 py-0.5">
        <span className="text-xs font-medium text-foreground">
          {group.phase.title}
        </span>
        <span className="text-xs text-subtle-foreground">
          {phaseProgressLabel(group.agents)}
        </span>
      </div>
      {agentLines}
    </div>
  );
}

// Leaves a small gap above the active phase when it scrolls into view so its
// header clears the container's top fade instead of sitting flush against it.
const ACTIVE_PHASE_SCROLL_OFFSET = 12;

function CollapsiblePhaseSection({
  group,
  expanded,
  isActive,
  onToggle,
  promptStack,
  workflowSettled,
}: {
  group: WorkflowPhaseGroup;
  expanded: boolean;
  /**
   * Whether this is the workflow's active phase. When a phase becomes active it
   * scrolls itself to the top of the container so the view follows the run
   * forward instead of leaving the user parked on a finished phase.
   */
  isActive: boolean;
  onToggle: () => void;
  promptStack: boolean;
  workflowSettled: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isActive) {
      return;
    }
    const el = ref.current;
    if (!el) {
      return;
    }
    const scroller = el.closest("[data-detail-scroll-area]");
    if (scroller instanceof HTMLElement) {
      scroller.scrollTop +=
        el.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        ACTIVE_PHASE_SCROLL_OFFSET;
    }
  }, [isActive]);

  const agentLines = group.agents.map((agent) => (
    <WorkflowAgentLine
      key={agent.index}
      agent={agent}
      promptStack={promptStack}
      workflowSettled={workflowSettled}
    />
  ));

  // Phase-less trailing agents have no header to collapse under.
  if (!group.phase) {
    if (!promptStack) {
      return <div ref={ref}>{agentLines}</div>;
    }
    return (
      <div ref={ref} className="flex min-w-0 flex-col pl-5">
        {agentLines}
      </div>
    );
  }

  const progress = phaseProgressLabel(group.agents);
  const activityState = activityStateForPhase({
    group,
    isActive,
    workflowSettled,
  });
  // A declared-but-empty phase has nothing to reveal, so it isn't a toggle.
  if (group.agents.length === 0) {
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center gap-1.5",
          promptStack
            ? promptStackActivityRowClass(activityState)
            : "px-2 py-0.5",
        )}
      >
        <span className="size-3 shrink-0" aria-hidden="true" />
        <span
          className={cn(
            "text-xs font-medium",
            promptStack
              ? activityTextClass(activityState)
              : "text-foreground",
          )}
        >
          {group.phase.title}
        </span>
        <span
          className={cn(
            "text-xs",
            promptStack
              ? activityMetaClass(activityState)
              : "text-subtle-foreground",
          )}
        >
          {progress}
        </span>
      </div>
    );
  }

  return (
    <div ref={ref}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-1.5 text-left transition-colors hover:bg-state-hover",
          promptStack
            ? promptStackActivityRowClass(activityState)
            : "rounded px-2 py-0.5",
        )}
      >
        <Icon
          name="ChevronDown"
          className={cn(
            "size-3 shrink-0 text-subtle-foreground transition-transform duration-200",
            !expanded && "-rotate-90",
            promptStack && promptStackActivityIconClass(activityState),
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            "text-xs font-medium",
            promptStack
              ? activityTextClass(activityState)
              : "text-foreground",
          )}
        >
          {group.phase.title}
        </span>
        <span
          className={cn(
            "text-xs",
            promptStack
              ? activityMetaClass(activityState)
              : "text-subtle-foreground",
          )}
        >
          {progress}
        </span>
      </button>
      {expanded ? (
        promptStack ? (
          <div className="mt-1 flex min-w-0 flex-col pl-5">
            {agentLines}
          </div>
        ) : (
          <div>{agentLines}</div>
        )
      ) : null}
    </div>
  );
}

/**
 * Collapsible phase tree for the prompt-stack banner. Expansion is derived from
 * the active phase so it auto-advances as the run progresses — the live phase is
 * open and the rest collapse, with no extra render to keep state in sync. A
 * click records an override that sticks across active changes, so a phase the
 * user explicitly opened (or closed) stays that way.
 */
function CollapsiblePhaseGroups({
  groups,
  promptStack,
  workflowSettled,
}: {
  groups: readonly WorkflowPhaseGroup[];
  promptStack: boolean;
  workflowSettled: boolean;
}) {
  const activeKey = activePhaseKey(groups);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const isExpanded = (key: string): boolean =>
    overrides.get(key) ?? key === activeKey;
  const toggle = (key: string) =>
    setOverrides((current) => {
      const wasExpanded = current.get(key) ?? key === activeKey;
      const next = new Map(current);
      next.set(key, !wasExpanded);
      return next;
    });

  return (
    <>
      {groups.map((group) => {
        const key = groupKey(group);
        const expanded = isExpanded(key);
        return (
          <CollapsiblePhaseSection
            key={key}
            group={group}
            expanded={expanded}
            isActive={key === activeKey}
            onToggle={() => toggle(key)}
            promptStack={promptStack}
            workflowSettled={workflowSettled}
          />
        );
      })}
    </>
  );
}

export function WorkflowWorkRowBody({
  row,
  size = "delegation",
  collapsiblePhases = false,
}: {
  row: TimelineViewWorkflowWorkRow;
  /** Max-height tier for the scroll container. */
  size?: DetailScrollSize;
  /**
   * When true, each phase is an independent collapse toggle and expansion
   * follows the active phase as the run advances. Used by the prompt-stack
   * banner where a long workflow needs to stay glanceable; the timeline keeps
   * phases fully open.
   */
  collapsiblePhases?: boolean;
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
      size={size}
      // Collapsible mode lets the active phase pull itself into view instead of
      // chasing the bottom, which in a long run would only show empty queued
      // phases.
      streaming={collapsiblePhases ? false : row.status === "pending"}
      contentKey={contentKey}
      scrollClassName={collapsiblePhases ? "px-2.5 py-2" : undefined}
    >
      <div
        className={cn(
          "flex flex-col",
          collapsiblePhases ? "gap-1.5" : "gap-1 py-1",
        )}
      >
        {collapsiblePhases ? (
          <CollapsiblePhaseGroups
            groups={groups}
            promptStack={collapsiblePhases}
            workflowSettled={workflowSettled}
          />
        ) : (
          groups.map((group) => (
            <StaticPhaseGroup
              key={groupKey(group)}
              group={group}
              workflowSettled={workflowSettled}
            />
          ))
        )}
        {row.error ? (
          <div className="px-2 py-0.5 text-xs text-destructive/80">
            {row.error}
          </div>
        ) : null}
      </div>
    </TimelineDetailScroll>
  );
}
