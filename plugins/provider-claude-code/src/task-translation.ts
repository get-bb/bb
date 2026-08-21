import {
  type BackgroundTaskStatus,
  type BackgroundTaskUsage,
  type DeltaBackgroundTaskShape,
  type ThreadDelta,
  type WorkflowAgentSnapshot,
  type WorkflowAgentState,
  type WorkflowPhaseSnapshot,
  type WorkflowProgressSnapshot,
  LOCAL_BASH_TASK_TYPE,
  LOCAL_WORKFLOW_TASK_TYPE,
  backgroundTaskItemStatus,
  isBackgroundAgentTaskType,
  isSettledBackgroundTaskStatus,
} from "@get-bb/plugin-sdk/provider-bridge";
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
import { backgroundTaskPresentation } from "./presentation.js";

/**
 * Claude background-task dialect state → narrow-grammar deltas.
 *
 * The per-index workflow snapshot fold across delta batches, opaque-task
 * tracking, and generation counting are claude dialect knowledge and stay
 * bridge-side; the emitted deltas carry the full re-embedded snapshot per
 * event. Progress-event throttling is NOT here anymore — it is the runtime
 * delta assembler's central policy (500ms per item key, status transitions
 * ride `flush: true`).
 */

/**
 * Thread-lifetime state for one provider background task. Lives outside any
 * turn state (tasks outlive turns by design); the assembler's eviction guard
 * pins the thread while the materialized item is open.
 */
interface ClaudeTrackedTask {
  taskId: string;
  /**
   * Provider item key for the assembler's id maps. A restarted settled task is
   * a NEW provider item key (`task:<taskId>#<generation>`; generation is a
   * bridge counter), so it mints a fresh timeline item.
   */
  providerItemKey: string;
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
  terminal: boolean;
}

export type ClaudeTaskMap = Map<string, ClaudeTrackedTask>;

interface TranslateClaudeTaskMessageArgs {
  event: unknown;
  tasks: ClaudeTaskMap;
  /**
   * The caller's late-drain suppression (#1623): while true, a `task_started`
   * may not materialize a new task, because its `turn.open` would manufacture
   * an unaccepted provider-only turn. Updates for already-tracked tasks still
   * translate — they ride the thread-attached item, not a turn.
   */
  turnStartSuppressed: boolean;
}

/**
 * Whether Claude still has bounded agent work that will reinvoke the parent
 * model when it settles. A successful SDK result while one of these tasks is
 * open ends only the current SDK loop segment, not the logical bb turn.
 *
 * Backgrounded shell commands are deliberately excluded: they are detached
 * work and may be long-lived (for example, a dev server). Ambient tasks are
 * excluded for the same reason.
 *
 * Workflows are excluded too, even though they do reinvoke the parent model.
 * They routinely run for many minutes, and holding the turn open kept the
 * thread `active` for their whole duration, which made the composer queue
 * follow-ups instead of sending them. A workflow therefore lets the turn
 * complete and the thread go idle; its progress stays visible through the
 * thread's background-task activity rather than through turn status.
 */
export function hasCompletionBlockingClaudeTasks(
  tasks: ClaudeTaskMap,
): boolean {
  for (const task of tasks.values()) {
    if (
      !task.terminal &&
      !task.skipTranscript &&
      isBackgroundAgentTaskType(task.taskType)
    ) {
      return true;
    }
  }
  return false;
}

function buildClaudeTaskItemKey(taskId: string, generation: number): string {
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

/** The full snapshot re-embedded on every task delta. */
function buildClaudeTaskShape(
  task: ClaudeTrackedTask,
): DeltaBackgroundTaskShape {
  const workflow = buildWorkflowSnapshot(task);
  return {
    type: "backgroundTask",
    familyId: task.taskId,
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
  };
}

function taskKey(task: ClaudeTrackedTask): {
  providerItemId: string;
  parentRef?: string;
} {
  return {
    providerItemId: task.providerItemKey,
    ...(task.toolUseId !== undefined ? { parentRef: task.toolUseId } : {}),
  };
}

function buildClaudeTaskProgressDelta(
  task: ClaudeTrackedTask,
  flush: boolean,
): ThreadDelta {
  return {
    kind: "item.progress",
    key: taskKey(task),
    snapshot: buildClaudeTaskShape(task),
    ...(flush ? { flush: true } : {}),
  };
}

/** The row presentation of a task; the description can change by patch. */
function claudeTaskPresentation(task: ClaudeTrackedTask) {
  return backgroundTaskPresentation({
    taskType: task.taskType,
    description: task.description,
    workflowName: task.workflowName,
  });
}

function buildClaudeTaskCloseDelta(task: ClaudeTrackedTask): ThreadDelta {
  const shape = buildClaudeTaskShape(task);
  return {
    kind: "item.close",
    key: taskKey(task),
    status: shape.status,
    item: shape,
    presentation: claudeTaskPresentation(task),
  };
}

/**
 * Task types bb materializes as background-task timeline rows: dynamic
 * workflows, backgrounded shell commands, and backgrounded agents. Other task
 * types such as monitors share the event family but stay on their own render
 * paths.
 */
function isMaterializedTaskType(taskType: string): boolean {
  return (
    taskType === LOCAL_WORKFLOW_TASK_TYPE ||
    taskType === LOCAL_BASH_TASK_TYPE ||
    isBackgroundAgentTaskType(taskType)
  );
}

/**
 * Translates the SDK task event family (task_started / task_progress /
 * task_updated / task_notification) into deltas. Returns null when the
 * message is not a task message; returns [] for task messages that are
 * intentionally not materialized (monitor/unknown task types and events for
 * unknown/settled tasks).
 *
 * A `task_started` for a materialized type opens the item in the spawning
 * turn: the returned deltas begin with `turn.open` exactly where the old
 * translator called ensureTurnStarted.
 */
export function translateClaudeTaskMessage(
  args: TranslateClaudeTaskMessageArgs,
): ThreadDelta[] | null {
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
    if (args.turnStartSuppressed) {
      return [];
    }
    const task: ClaudeTrackedTask = {
      taskId: message.task_id,
      providerItemKey: buildClaudeTaskItemKey(message.task_id, generation),
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
      terminal: false,
    };
    args.tasks.set(message.task_id, task);
    return [
      { kind: "turn.open" },
      {
        kind: "item.open",
        key: taskKey(task),
        item: buildClaudeTaskShape(task),
        presentation: claudeTaskPresentation(task),
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
    return [buildClaudeTaskProgressDelta(task, false)];
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
    // Status transitions must land immediately: flush bypasses the assembler's
    // central progress throttle.
    return [buildClaudeTaskProgressDelta(task, statusChanged)];
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
    return [buildClaudeTaskCloseDelta(task)];
  }

  return null;
}

/**
 * Settles every open task as explicit `item.close` deltas. Used when the CLI
 * session backing the tasks is gone: thread/resume restarts the session
 * (settings change, reconnect re-resume), thread/stop interrupts it, and
 * provider process exit kills it outright. Tasks whose latest patch already
 * reported a finished status (completed/failed/killed) keep it — only the
 * terminal task_notification is lost, not the outcome — while genuinely open
 * tasks settle as interrupted ("stopped"). The daemon-crash case — where this
 * in-memory state is lost entirely — is reconciled server-side on daemon
 * session re-registration.
 */
export function buildInterruptedClaudeTaskDeltas(args: {
  tasks: ClaudeTaskMap;
}): ThreadDelta[] {
  const deltas: ThreadDelta[] = [];
  for (const task of args.tasks.values()) {
    if (task.terminal) {
      continue;
    }
    if (!isSettledBackgroundTaskStatus(task.taskStatus)) {
      task.taskStatus = "stopped";
    }
    task.terminal = true;
    deltas.push(buildClaudeTaskCloseDelta(task));
  }
  return deltas;
}
