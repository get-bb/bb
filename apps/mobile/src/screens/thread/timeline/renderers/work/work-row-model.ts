import { formatPendingInteractionUserQuestionOptionLabel } from "@bb/core-ui";
import {
  isBackgroundAgentTaskType,
  isBackgroundCommandTaskType,
  isSettledWorkflowAgentState,
  type BackgroundTaskStatus,
  type BackgroundTaskUsage,
  type JsonValue,
  type WorkflowAgentSnapshot,
  type WorkflowPhaseSnapshot,
  type WorkflowProgressSnapshot,
} from "@bb/domain";
import type {
  TimelineActivityIntent,
  TimelineApprovalWorkRow,
  TimelineCommandWorkRow,
  TimelineQuestionWorkRow,
  TimelineToolArgs,
  TimelineWorkflowWorkRow,
} from "@bb/server-contract";
import {
  assertNever,
  buildTimelineActivityIntentTitles,
  primaryTimelineActivityIntent,
  type TimelineActivityIntentTitle,
  type TimelineViewWorkRow,
} from "@bb/thread-view";
import type { IconName } from "@/ui/icon-map";
import type { TimelineRowKind } from "../../rows";

/**
 * Pure presentation rules for the work-row renderers (port of the relevant
 * parts of apps/app ThreadTimelineRows / TimelineRowDetails / WorkflowProgress).
 * No React Native imports: vitest-covered under node.
 */

// ---------------------------------------------------------------------------
// Leading glyph + past-row dim
// ---------------------------------------------------------------------------

const SKILL_FILE_NAME = "SKILL.md";

function isSkillReadIntent(intent: TimelineActivityIntent): boolean {
  if (intent.type !== "read") return false;
  const target = (intent.path ?? intent.name).replaceAll("\\", "/");
  return target.split("/").pop() === SKILL_FILE_NAME;
}

function explorationIntentIcon(
  intentType: "read" | "list_files" | "search",
): IconName {
  switch (intentType) {
    case "search":
      return "Search";
    case "read":
      return "FileText";
    case "list_files":
      return "Folder";
    default:
      return assertNever(intentType);
  }
}

export function leadingIconForActivityIntentTitle(
  entry: TimelineActivityIntentTitle,
): IconName {
  if (isSkillReadIntent(entry.intent)) return "Zap";
  return explorationIntentIcon(entry.intentType);
}

/**
 * A leading glyph for every work row, keyed by kind so edits, explores and
 * commands read apart at a glance (web `leadingIconForWorkRow`).
 */
export function leadingIconForWorkRow(row: TimelineViewWorkRow): IconName {
  if ("activityIntents" in row && row.activityIntents.some(isSkillReadIntent)) {
    return "Zap";
  }
  if (row.workKind === "command" || row.workKind === "tool") {
    const intent = primaryTimelineActivityIntent(row);
    if (intent !== null && intent.type !== "unknown") {
      return explorationIntentIcon(intent.type);
    }
  }
  switch (row.workKind) {
    case "file-change":
      return "EditFile";
    case "command":
    case "tool":
      return "Terminal";
    case "web-search":
      return "Search";
    case "web-fetch":
      return "Globe";
    case "image-view":
      return "File";
    case "delegation":
      return "UserRoundPlus";
    case "workflow":
      if (isBackgroundCommandTaskType(row.taskType)) return "Terminal";
      if (isBackgroundAgentTaskType(row.taskType)) return "UserRoundPlus";
      return "ListTodo";
    case "approval":
      return "Lock";
    case "question":
      return "CircleQuestion";
    default:
      return assertNever(row);
  }
}

/**
 * Finished rows recede (drawn at `PAST_ROW_DIM_OPACITY` from ../shared);
 * still-running, errored and interrupted rows stay at full strength so live
 * work and failures keep attention.
 */
export function isPastWorkRow(row: TimelineViewWorkRow): boolean {
  return row.status === "completed";
}

// ---------------------------------------------------------------------------
// Compact activity intents (bundle / step children)
// ---------------------------------------------------------------------------

/**
 * Whether a list item's parent is a step/bundle summary (the list model
 * carries the enclosing container's kind on every flattened item).
 */
export function isInsideWorkSummary(
  parentKind: TimelineRowKind | null,
): boolean {
  return parentKind === "step-summary" || parentKind === "bundle-summary";
}

/**
 * Inside a summary, an exploration command/tool row (no approval) renders as
 * one flat line per intent instead of its single title (web
 * `compact-activity-intents`). Null when the row keeps its regular title.
 */
export function compactActivityIntentTitles(
  row: TimelineViewWorkRow,
  parentKind: TimelineRowKind | null,
): TimelineActivityIntentTitle[] | null {
  if (!isInsideWorkSummary(parentKind)) return null;
  if (row.workKind !== "command" && row.workKind !== "tool") return null;
  if (row.approvalStatus !== null) return null;
  const titles = buildTimelineActivityIntentTitles(row);
  return titles.length > 0 ? titles : null;
}

// ---------------------------------------------------------------------------
// Command / tool bodies
// ---------------------------------------------------------------------------

export function commandMetadataLines(row: TimelineCommandWorkRow): string[] {
  const lines: string[] = [];
  if (row.source) lines.push(`source: ${row.source}`);
  return lines;
}

function formatToolArgValue(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

interface ToolArgEntry {
  key: string;
  value: string;
}

export function toolArgEntries(args: TimelineToolArgs): ToolArgEntry[] {
  if (!args) return [];
  return Object.entries(args).map(([key, value]) => ({
    key,
    value: formatToolArgValue(value),
  }));
}

/** Characters per line the tool-card header estimate assumes (phone width, 14px mono). */
const TOOL_HEADER_CHARS_PER_LINE = 40;

/**
 * Estimated rendered line count of the tool-card header (tool name plus one
 * `key: value` line per argument, multi-line values counted per line, long
 * values wrapped at `charsPerLine`). RN reports only the clamped lines from
 * `onTextLayout`, so the "Show more" affordance is decided from this
 * estimate instead.
 */
export function estimateToolHeaderLines(
  toolName: string,
  entries: readonly ToolArgEntry[],
  charsPerLine: number = TOOL_HEADER_CHARS_PER_LINE,
): number {
  const wrapped = (text: string): number =>
    text
      .split("\n")
      .reduce(
        (total, line) =>
          total + Math.max(1, Math.ceil(line.length / charsPerLine)),
        0,
      );
  return entries.reduce(
    (total, entry) => total + wrapped(`${entry.key}: ${entry.value}`),
    wrapped(toolName),
  );
}

// ---------------------------------------------------------------------------
// Approval (read-only decision glyph)
// ---------------------------------------------------------------------------

type ApprovalDecisionTone = "pending" | "granted" | "denied" | "muted";

interface ApprovalDecision {
  icon: IconName;
  tone: ApprovalDecisionTone;
  /** Accessibility label for the glyph. */
  label: string;
}

/**
 * Trailing decision glyph for an approval row. The title already spells out
 * the lifecycle (and grant scope); the glyph gives the decision a fixed
 * place to land the eye on.
 */
export function describeApprovalDecision(
  row: TimelineApprovalWorkRow,
): ApprovalDecision {
  switch (row.approvalKind) {
    case "file-edit":
      switch (row.lifecycle) {
        case "waiting":
          return { icon: "Clock", tone: "pending", label: "Waiting" };
        case "denied":
          return { icon: "X", tone: "denied", label: "Denied" };
        default:
          return assertNever(row);
      }
    case "permission-grant":
      switch (row.lifecycle) {
        case "pending":
          return { icon: "Clock", tone: "pending", label: "Waiting" };
        case "resolving":
          return { icon: "Clock", tone: "pending", label: "Resolving" };
        case "granted":
          return {
            icon: "Check",
            tone: "granted",
            label:
              row.grantScope === "session"
                ? "Granted for this session"
                : row.grantScope === "turn"
                  ? "Granted for this turn"
                  : "Granted",
          };
        case "denied":
          return { icon: "X", tone: "denied", label: "Denied" };
        case "interrupted":
          return { icon: "Pause", tone: "muted", label: "Interrupted" };
        default:
          return assertNever(row);
      }
    default:
      return assertNever(row);
  }
}

// ---------------------------------------------------------------------------
// Question (answered body)
// ---------------------------------------------------------------------------

interface AnsweredQuestionEntry {
  id: string;
  prompt: string;
  /** Option labels (falling back to raw values) the user picked. */
  selectedLabels: string[];
  freeText: string | null;
}

/**
 * The recorded answers of a question row (web `QuestionWorkRowBody`):
 * `resolving` and `answered` both carry `answers`; pending and interrupted
 * rows are title-only and yield null.
 */
export function answeredQuestionEntries(
  row: TimelineQuestionWorkRow,
): AnsweredQuestionEntry[] | null {
  if (row.lifecycle !== "answered" && row.lifecycle !== "resolving") {
    return null;
  }
  return row.questions.map((question) => {
    const answer = row.answers?.[question.id] ?? null;
    return {
      id: question.id,
      prompt: question.prompt,
      selectedLabels:
        answer?.selected.map((value) =>
          formatPendingInteractionUserQuestionOptionLabel({ question, value }),
        ) ?? [],
      freeText: answer?.freeText ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Workflow / background task
// ---------------------------------------------------------------------------

export type WorkflowAgentDisplayState =
  | WorkflowAgentSnapshot["state"]
  | "interrupted";

export interface WorkflowPhaseGroup {
  phase: WorkflowPhaseSnapshot | null;
  agents: WorkflowAgentSnapshot[];
}

export function groupWorkflowAgentsByPhase(
  snapshot: WorkflowProgressSnapshot,
): WorkflowPhaseGroup[] {
  const groups: WorkflowPhaseGroup[] = [];
  const byIndex = new Map<number, WorkflowPhaseGroup>();
  for (const phase of snapshot.phases) {
    const group: WorkflowPhaseGroup = { phase, agents: [] };
    groups.push(group);
    byIndex.set(phase.index, group);
  }
  const unphased: WorkflowAgentSnapshot[] = [];
  for (const agent of snapshot.agents) {
    const group =
      agent.phaseIndex !== undefined ? byIndex.get(agent.phaseIndex) : null;
    if (group) group.agents.push(agent);
    else unphased.push(agent);
  }
  if (unphased.length > 0) groups.push({ phase: null, agents: unphased });
  return groups;
}

export function workflowPhaseGroupKey(group: WorkflowPhaseGroup): string {
  return group.phase ? `phase-${group.phase.index}` : "unphased";
}

/**
 * A settled workflow with agents that never settled shows them as
 * interrupted (render-time only; never persisted).
 */
export function deriveWorkflowAgentDisplayState(
  agent: WorkflowAgentSnapshot,
  workflowSettled: boolean,
): WorkflowAgentDisplayState {
  if (workflowSettled && !isSettledWorkflowAgentState(agent.state)) {
    return "interrupted";
  }
  return agent.state;
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
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

function shortModelName(model: string): string {
  const match = /^claude-([a-z]+)/.exec(model);
  return match?.[1] ?? model;
}

export interface WorkflowAgentStats {
  /** Agent type / model plus qualifiers, without the duration. */
  meta: string;
  duration: string | null;
}

export function buildWorkflowAgentStats(
  agent: WorkflowAgentSnapshot,
  displayState: WorkflowAgentDisplayState,
): WorkflowAgentStats {
  const parts: string[] = [];
  if (agent.agentType !== undefined) parts.push(agent.agentType);
  parts.push(shortModelName(agent.model));
  if (agent.tokens !== undefined && agent.tokens > 0) {
    parts.push(`${formatCompactTokens(agent.tokens)} tok`);
  }
  if (agent.toolCalls !== undefined && agent.toolCalls > 0) {
    parts.push(
      `${agent.toolCalls} ${agent.toolCalls === 1 ? "tool" : "tools"}`,
    );
  }
  if (agent.attempt > 1) parts.push(`attempt ${agent.attempt}`);
  if (agent.cached) parts.push("cached");
  if (displayState === "queued") parts.push("queued");
  if (displayState === "interrupted") parts.push("stopped");
  return {
    meta: parts.join(" · "),
    duration:
      agent.durationMs === undefined
        ? null
        : formatCompactDuration(agent.durationMs),
  };
}

export function workflowPhaseProgressLabel(
  agents: readonly WorkflowAgentSnapshot[],
): string {
  if (agents.length === 0) return "not started";
  const settled = agents.filter((agent) =>
    isSettledWorkflowAgentState(agent.state),
  ).length;
  return `${settled}/${agents.length}`;
}

export function isWorkflowPhaseCompleted(group: WorkflowPhaseGroup): boolean {
  return (
    group.agents.length > 0 &&
    group.agents.every((agent) => agent.state === "done")
  );
}

export type WorkflowPhaseStripState = "done" | "active" | "failed" | "upcoming";

/** Which phase group is "current": running → in flight → last non-empty. */
export function activeWorkflowPhaseKey(
  groups: readonly WorkflowPhaseGroup[],
): string | null {
  const running = groups.find((group) =>
    group.agents.some((agent) => agent.state === "running"),
  );
  if (running) return workflowPhaseGroupKey(running);
  const inFlight = groups.find(
    (group) =>
      group.agents.length > 0 &&
      !group.agents.every((agent) => isSettledWorkflowAgentState(agent.state)),
  );
  if (inFlight) return workflowPhaseGroupKey(inFlight);
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group && group.agents.length > 0) return workflowPhaseGroupKey(group);
  }
  return null;
}

export function workflowPhaseStripState(
  group: WorkflowPhaseGroup,
  isCurrent: boolean,
  workflowSettled: boolean,
): WorkflowPhaseStripState {
  if (group.agents.some((agent) => agent.state === "failed")) return "failed";
  const total = group.agents.length;
  const settled = group.agents.filter((agent) =>
    isSettledWorkflowAgentState(agent.state),
  ).length;
  if (total > 0 && settled === total && (workflowSettled || !isCurrent)) {
    return "done";
  }
  if (
    (isCurrent && !workflowSettled) ||
    group.agents.some((agent) => agent.state === "running") ||
    settled > 0
  ) {
    return "active";
  }
  if (workflowSettled && total > 0) return "done";
  return "upcoming";
}

export type WorkflowStatusPillState =
  | "queued"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Terminal status chip (web `WorkflowStatusPill`). There is deliberately no
 * "running" state: a live run already reads as active from the shimmering
 * title and the phase strip.
 */
export function workflowStatusPillState(
  taskStatus: BackgroundTaskStatus,
): WorkflowStatusPillState | null {
  switch (taskStatus) {
    case "pending":
      return "queued";
    case "running":
    case "paused":
      return null;
    case "completed":
      return "completed";
    case "failed":
    case "killed":
      return "failed";
    case "stopped":
      return "cancelled";
    default:
      return assertNever(taskStatus);
  }
}

export function formatWorkflowUsage(
  usage: BackgroundTaskUsage | null,
): string | null {
  if (!usage) return null;
  const parts: string[] = [];
  if (usage.totalTokens > 0) {
    parts.push(`${formatCompactTokens(usage.totalTokens)} tok`);
  }
  if (usage.toolUses > 0) {
    parts.push(`${usage.toolUses} ${usage.toolUses === 1 ? "tool" : "tools"}`);
  }
  if (usage.durationMs > 0) parts.push(formatCompactDuration(usage.durationMs));
  return parts.length > 0 ? parts.join(" · ") : null;
}

type WorkflowBodyKind =
  | { kind: "tree"; snapshot: WorkflowProgressSnapshot }
  | { kind: "text"; text: string }
  | { kind: "none" };

/**
 * What the expanded workflow body shows (web `WorkflowWorkRowBody`): the
 * phase/agent tree when the provider reported progress, otherwise the
 * terminal summary or error, otherwise nothing.
 */
export function workflowBodyKind(
  row: TimelineWorkflowWorkRow,
): WorkflowBodyKind {
  if (row.workflow) return { kind: "tree", snapshot: row.workflow };
  const text = row.summary ?? row.error;
  return text ? { kind: "text", text } : { kind: "none" };
}
