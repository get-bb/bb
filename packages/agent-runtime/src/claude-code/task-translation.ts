import type {
  BackgroundTaskStatus,
  BackgroundTaskUsage,
  ThreadEvent,
  ThreadEventBackgroundTaskItem,
  WorkflowAgentSnapshot,
  WorkflowAgentState,
  WorkflowPhaseSnapshot,
  WorkflowProgressSnapshot,
} from "@bb/domain";
import {
  LOCAL_BASH_TASK_TYPE,
  LOCAL_WORKFLOW_TASK_TYPE,
  backgroundTaskItemStatus,
  isSettledBackgroundTaskStatus,
  threadScope,
  turnScope,
} from "@bb/domain";
import {
  claudeTaskNotificationMessageSchema,
  claudeTaskProgressMessageSchema,
  claudeTaskStartedMessageSchema,
  claudeTaskUpdatedMessageSchema,
  claudeWorkflowAgentRecordSchema,
  claudeWorkflowPhaseRecordSchema,
  type ClaudeTaskUsage,
  type ClaudeWorkflowAgentRecord,
} from "./schemas.js";

/**
 * Minimum gap between persisted progress snapshots per task. The CLI flushes
 * progress batches every 16ms; every batch is folded into adapter state, but
 * only snapshots at this cadence become events. Status transitions flush
 * immediately, and the terminal completed event always carries the final
 * state, so skipped intermediate snapshots are never load-bearing.
 */
export const CLAUDE_TASK_PROGRESS_THROTTLE_MS = 500;

/**
 * Thread-lifetime state for one provider background task. Lives outside the
 * transient turn state (tasks outlive turns by design) and pins its thread's
 * registry entry against LRU eviction while any task is open.
 */
export interface ClaudeTrackedTask {
  taskId: string;
  itemId: string;
  /** Spawning turn; places the item in the timeline via its item/started. */
  turnId: string;
  toolUseId: string | undefined;
  taskType: string;
  generation: number;
  workflowName: string | undefined;
  description: string;
  taskStatus: BackgroundTaskStatus;
  skipTranscript: boolean;
  phasesByIndex: Map<number, WorkflowPhaseSnapshot>;
  agentsByIndex: Map<number, WorkflowAgentSnapshot>;
  usage: BackgroundTaskUsage | undefined;
  summary: string | undefined;
  error: string | undefined;
  outputFile: string | undefined;
  lastProgressEmittedAt: number;
  terminal: boolean;
}

export type ClaudeTaskMap = Map<string, ClaudeTrackedTask>;

export interface TranslateClaudeTaskMessageArgs {
  /** Lazily opens the spawning turn and returns its id. */
  ensureTurnStarted: () => string;
  event: unknown;
  now: number;
  tasks: ClaudeTaskMap;
  threadId: string;
}

export function hasOpenClaudeBackgroundTasks(tasks: ClaudeTaskMap): boolean {
  for (const task of tasks.values()) {
    if (!task.terminal) {
      return true;
    }
  }
  return false;
}

function buildClaudeTaskItemId(taskId: string, generation: number): string {
  return generation > 1 ? `task:${taskId}#${generation}` : `task:${taskId}`;
}

function toBackgroundTaskUsage(usage: ClaudeTaskUsage): BackgroundTaskUsage {
  return {
    totalTokens: usage.total_tokens,
    toolUses: usage.tool_uses,
    durationMs: usage.duration_ms,
  };
}

/**
 * Raw record state machine: "start" (queued or running), "progress", "done",
 * "error" (+ skipped flag). Unknown future states degrade to running/queued by
 * slot acquisition rather than failing translation.
 */
function deriveWorkflowAgentState(
  record: ClaudeWorkflowAgentRecord,
): WorkflowAgentState {
  if (record.state === "done") {
    return "done";
  }
  if (record.state === "error") {
    return record.skipped === true ? "skipped" : "failed";
  }
  if (record.startedAt !== undefined) {
    return "running";
  }
  return record.queuedAt !== undefined ? "queued" : "running";
}

function isPositiveInt(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 1;
}

function normalizeWorkflowAgentRecord(
  record: ClaudeWorkflowAgentRecord,
): WorkflowAgentSnapshot {
  const attempt = isPositiveInt(record.attempt) ? record.attempt : 1;
  return {
    index: record.index,
    label: record.label,
    state: deriveWorkflowAgentState(record),
    model: record.model ?? "unknown",
    attempt,
    cached: record.cached ?? false,
    lastProgressAt:
      record.lastProgressAt ?? record.startedAt ?? record.queuedAt ?? 0,
    ...(isPositiveInt(record.phaseIndex)
      ? { phaseIndex: record.phaseIndex }
      : {}),
    ...(record.phaseTitle !== undefined
      ? { phaseTitle: record.phaseTitle }
      : {}),
    ...(record.agentType !== undefined ? { agentType: record.agentType } : {}),
    ...(record.isolation !== undefined ? { isolation: record.isolation } : {}),
    ...(record.queuedAt !== undefined ? { queuedAt: record.queuedAt } : {}),
    ...(record.startedAt !== undefined ? { startedAt: record.startedAt } : {}),
    ...(record.lastToolName !== undefined
      ? { lastToolName: record.lastToolName }
      : {}),
    ...(record.lastToolSummary !== undefined
      ? { lastToolSummary: record.lastToolSummary }
      : {}),
    ...(record.promptPreview !== undefined
      ? { promptPreview: record.promptPreview }
      : {}),
    ...(record.resultPreview !== undefined
      ? { resultPreview: record.resultPreview }
      : {}),
    ...(record.error !== undefined ? { error: record.error } : {}),
    ...(record.tokens !== undefined ? { tokens: record.tokens } : {}),
    ...(record.toolCalls !== undefined ? { toolCalls: record.toolCalls } : {}),
    ...(record.durationMs !== undefined
      ? { durationMs: record.durationMs }
      : {}),
  };
}

/**
 * Folds one workflow_progress delta batch into the task's per-index maps. The
 * wire carries only records produced since the last CLI flush; the latest
 * record for a (record type, index) key supersedes earlier ones across
 * events, so a snapshot must never be rebuilt from a single batch.
 */
function foldWorkflowProgressRecords(
  task: ClaudeTrackedTask,
  records: unknown[],
): void {
  for (const rawRecord of records) {
    const agentRecord = claudeWorkflowAgentRecordSchema.safeParse(rawRecord);
    if (agentRecord.success) {
      if (isPositiveInt(agentRecord.data.index)) {
        task.agentsByIndex.set(
          agentRecord.data.index,
          normalizeWorkflowAgentRecord(agentRecord.data),
        );
      }
      continue;
    }
    const phaseRecord = claudeWorkflowPhaseRecordSchema.safeParse(rawRecord);
    if (phaseRecord.success && isPositiveInt(phaseRecord.data.index)) {
      task.phasesByIndex.set(phaseRecord.data.index, {
        index: phaseRecord.data.index,
        title: phaseRecord.data.title,
        ...(phaseRecord.data.kind !== undefined
          ? { kind: phaseRecord.data.kind }
          : {}),
      });
    }
    // Unknown record kinds (e.g. future additions) are ignored by design.
  }
}

function buildWorkflowSnapshot(
  task: ClaudeTrackedTask,
): WorkflowProgressSnapshot | undefined {
  if (task.phasesByIndex.size === 0 && task.agentsByIndex.size === 0) {
    return undefined;
  }
  const byIndex = (a: { index: number }, b: { index: number }): number =>
    a.index - b.index;
  return {
    phases: [...task.phasesByIndex.values()].sort(byIndex),
    agents: [...task.agentsByIndex.values()].sort(byIndex),
  };
}

function buildClaudeTaskItem(
  task: ClaudeTrackedTask,
): ThreadEventBackgroundTaskItem {
  const workflow = buildWorkflowSnapshot(task);
  return {
    type: "backgroundTask",
    id: task.itemId,
    taskType: task.taskType,
    description: task.description,
    status: backgroundTaskItemStatus(task.taskStatus),
    taskStatus: task.taskStatus,
    skipTranscript: task.skipTranscript,
    ...(task.workflowName !== undefined
      ? { workflowName: task.workflowName }
      : {}),
    ...(workflow ? { workflow } : {}),
    ...(task.usage ? { usage: task.usage } : {}),
    ...(task.summary !== undefined ? { summary: task.summary } : {}),
    ...(task.error !== undefined ? { error: task.error } : {}),
    ...(task.outputFile !== undefined ? { outputFile: task.outputFile } : {}),
    ...(task.toolUseId !== undefined
      ? { parentToolCallId: task.toolUseId }
      : {}),
  };
}

function buildClaudeTaskProgressEvent(
  task: ClaudeTrackedTask,
  threadId: string,
): ThreadEvent {
  return {
    type: "item/backgroundTask/progress",
    threadId,
    providerThreadId: "",
    scope: threadScope(),
    item: buildClaudeTaskItem(task),
  };
}

function buildClaudeTaskCompletedEvent(
  task: ClaudeTrackedTask,
  threadId: string,
): ThreadEvent {
  return {
    type: "item/backgroundTask/completed",
    threadId,
    providerThreadId: "",
    scope: threadScope(),
    item: buildClaudeTaskItem(task),
  };
}

/**
 * Task types bb materializes as background-task timeline rows: dynamic
 * workflows and backgrounded shell commands. Other task types (subagents,
 * monitors) share the event family but stay on their own render paths.
 */
function isMaterializedTaskType(taskType: string): boolean {
  return (
    taskType === LOCAL_WORKFLOW_TASK_TYPE || taskType === LOCAL_BASH_TASK_TYPE
  );
}

/**
 * Translates the SDK task event family (task_started / task_progress /
 * task_updated / task_notification). Returns null when the message is not a
 * task message; returns [] for task messages that are intentionally not
 * materialized (subagent/monitor task types — foreground subagents already
 * render via delegation rows — and events for unknown/settled tasks).
 */
export function translateClaudeTaskMessage(
  args: TranslateClaudeTaskMessageArgs,
): ThreadEvent[] | null {
  const started = claudeTaskStartedMessageSchema.safeParse(args.event);
  if (started.success) {
    const message = started.data;
    const taskType = message.task_type ?? "unknown";
    if (!isMaterializedTaskType(taskType)) {
      return [];
    }
    const existing = args.tasks.get(message.task_id);
    if (existing && !existing.terminal) {
      // Duplicate started for an open task — nothing new to materialize.
      return [];
    }
    const generation = existing ? existing.generation + 1 : 1;
    const turnId = args.ensureTurnStarted();
    const task: ClaudeTrackedTask = {
      taskId: message.task_id,
      itemId: buildClaudeTaskItemId(message.task_id, generation),
      turnId,
      toolUseId: message.tool_use_id,
      taskType,
      generation,
      workflowName: message.workflow_name,
      description: message.description,
      taskStatus: "running",
      skipTranscript: message.skip_transcript ?? false,
      phasesByIndex: new Map(),
      agentsByIndex: new Map(),
      usage: undefined,
      summary: undefined,
      error: undefined,
      outputFile: undefined,
      lastProgressEmittedAt: args.now,
      terminal: false,
    };
    args.tasks.set(message.task_id, task);
    return [
      {
        type: "item/started",
        threadId: args.threadId,
        providerThreadId: "",
        scope: turnScope(turnId),
        item: buildClaudeTaskItem(task),
      },
    ];
  }

  const progress = claudeTaskProgressMessageSchema.safeParse(args.event);
  if (progress.success) {
    const message = progress.data;
    const task = args.tasks.get(message.task_id);
    if (!task || task.terminal) {
      return [];
    }
    if (message.workflow_progress) {
      foldWorkflowProgressRecords(task, message.workflow_progress);
    }
    task.usage = toBackgroundTaskUsage(message.usage);
    if (
      args.now - task.lastProgressEmittedAt <
      CLAUDE_TASK_PROGRESS_THROTTLE_MS
    ) {
      return [];
    }
    task.lastProgressEmittedAt = args.now;
    return [buildClaudeTaskProgressEvent(task, args.threadId)];
  }

  const updated = claudeTaskUpdatedMessageSchema.safeParse(args.event);
  if (updated.success) {
    const message = updated.data;
    const task = args.tasks.get(message.task_id);
    if (!task || task.terminal) {
      return [];
    }
    const patch = message.patch;
    let statusChanged = false;
    if (patch.status !== undefined && patch.status !== task.taskStatus) {
      task.taskStatus = patch.status;
      statusChanged = true;
    }
    if (patch.description !== undefined) {
      task.description = patch.description;
    }
    if (patch.error !== undefined) {
      task.error = patch.error;
    }
    // end_time / total_paused_ms / is_backgrounded are ignored by design for
    // workflow tasks: duration comes from usage.duration_ms and workflows are
    // always backgrounded. Revisit when non-workflow tasks materialize.
    if (
      !statusChanged &&
      args.now - task.lastProgressEmittedAt < CLAUDE_TASK_PROGRESS_THROTTLE_MS
    ) {
      return [];
    }
    task.lastProgressEmittedAt = args.now;
    return [buildClaudeTaskProgressEvent(task, args.threadId)];
  }

  const notification = claudeTaskNotificationMessageSchema.safeParse(
    args.event,
  );
  if (notification.success) {
    const message = notification.data;
    const task = args.tasks.get(message.task_id);
    if (!task || task.terminal) {
      return [];
    }
    task.taskStatus = message.status;
    task.summary = message.summary;
    if (message.output_file.length > 0) {
      task.outputFile = message.output_file;
    }
    if (message.usage) {
      task.usage = toBackgroundTaskUsage(message.usage);
    }
    task.terminal = true;
    return [buildClaudeTaskCompletedEvent(task, args.threadId)];
  }

  return null;
}

/**
 * Settles every open task. Used when the CLI session backing the tasks is
 * gone: thread/resume restarts the session (settings change, reconnect
 * re-resume) and provider process exit kills it outright. Tasks whose latest
 * patch already reported a finished status (completed/failed/killed) keep it —
 * only the terminal task_notification is lost, not the outcome — while
 * genuinely open tasks settle as interrupted ("stopped"). The daemon-crash
 * case — where this in-memory state is lost entirely — is reconciled
 * server-side on daemon session re-registration.
 */
export function buildInterruptedClaudeTaskEvents(args: {
  tasks: ClaudeTaskMap;
  threadId: string;
}): ThreadEvent[] {
  const events: ThreadEvent[] = [];
  for (const task of args.tasks.values()) {
    if (task.terminal) {
      continue;
    }
    if (!isSettledBackgroundTaskStatus(task.taskStatus)) {
      task.taskStatus = "stopped";
    }
    task.terminal = true;
    events.push(buildClaudeTaskCompletedEvent(task, args.threadId));
  }
  return events;
}
