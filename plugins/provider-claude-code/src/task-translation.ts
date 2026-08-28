import {
  type BackgroundTaskStatus,
  type BackgroundTaskUsage,
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

interface ClaudeTrackedTask {
  taskId: string;
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

type DeltaItem = Extract<
  ThreadDelta,
  { kind: "item.open" | "item.close" }
>["item"];
type DeltaBackgroundTaskItem = Extract<DeltaItem, { type: "backgroundTask" }>;

interface ClaudeTaskKey {
  providerItemId: string;
  parentRef?: string;
}

type ClaudeTaskProgressDelta = Extract<ThreadDelta, { kind: "item.progress" }>;

interface TranslateClaudeTaskMessageArgs {
  event: unknown;
  tasks: ClaudeTaskMap;
  turnStartSuppressed: boolean;
  hasForwardedToolUse: (toolUseId: string) => boolean;
}

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
  const snapshot: WorkflowAgentSnapshot = {
    index: record.index,
    label: record.label,
    state: deriveWorkflowAgentState(record),
    model: record.model ?? "unknown",
    attempt,
    cached: record.cached ?? false,
    lastProgressAt:
      record.lastProgressAt ?? record.startedAt ?? record.queuedAt ?? 0,
  };
  if (isPositiveInt(record.phaseIndex)) snapshot.phaseIndex = record.phaseIndex;
  if (record.phaseTitle !== undefined) snapshot.phaseTitle = record.phaseTitle;
  if (record.agentType !== undefined) snapshot.agentType = record.agentType;
  if (record.isolation !== undefined) snapshot.isolation = record.isolation;
  if (record.queuedAt !== undefined) snapshot.queuedAt = record.queuedAt;
  if (record.startedAt !== undefined) snapshot.startedAt = record.startedAt;
  if (record.lastToolName !== undefined) {
    snapshot.lastToolName = record.lastToolName;
  }
  if (record.lastToolSummary !== undefined) {
    snapshot.lastToolSummary = record.lastToolSummary;
  }
  if (record.promptPreview !== undefined) {
    snapshot.promptPreview = record.promptPreview;
  }
  if (record.resultPreview !== undefined) {
    snapshot.resultPreview = record.resultPreview;
  }
  if (record.error !== undefined) snapshot.error = record.error;
  if (record.tokens !== undefined) snapshot.tokens = record.tokens;
  if (record.toolCalls !== undefined) snapshot.toolCalls = record.toolCalls;
  if (record.durationMs !== undefined) snapshot.durationMs = record.durationMs;
  return snapshot;
}

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
      const phase: WorkflowPhaseSnapshot = {
        index: phaseRecord.data.index,
        title: phaseRecord.data.title,
      };
      if (phaseRecord.data.kind !== undefined) {
        phase.kind = phaseRecord.data.kind;
      }
      task.phasesByIndex.set(phaseRecord.data.index, phase);
    }
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

function buildClaudeTaskItem(task: ClaudeTrackedTask): DeltaBackgroundTaskItem {
  const workflow = buildWorkflowSnapshot(task);
  const item: DeltaBackgroundTaskItem = {
    type: "backgroundTask",
    familyId: task.taskId,
    taskType: task.taskType,
    description: task.description,
    status: backgroundTaskItemStatus(task.taskStatus),
    taskStatus: task.taskStatus,
    skipTranscript: task.skipTranscript,
  };
  if (task.workflowName !== undefined) item.workflowName = task.workflowName;
  if (workflow !== undefined) item.workflow = workflow;
  if (task.usage !== undefined) item.usage = task.usage;
  if (task.summary !== undefined) item.summary = task.summary;
  if (task.error !== undefined) item.error = task.error;
  if (task.outputFile !== undefined) item.outputFile = task.outputFile;
  return item;
}

function taskKey(task: ClaudeTrackedTask): ClaudeTaskKey {
  const key: ClaudeTaskKey = {
    providerItemId: task.providerItemKey,
  };
  if (task.toolUseId !== undefined) key.parentRef = task.toolUseId;
  return key;
}

function buildClaudeTaskProgressDelta(
  task: ClaudeTrackedTask,
  flush: boolean,
): ThreadDelta {
  const delta: ClaudeTaskProgressDelta = {
    kind: "item.progress",
    key: taskKey(task),
    snapshot: buildClaudeTaskItem(task),
  };
  if (flush) delta.flush = true;
  return delta;
}

function claudeTaskPresentation(task: ClaudeTrackedTask) {
  return backgroundTaskPresentation({
    taskType: task.taskType,
    description: task.description,
    workflowName: task.workflowName,
  });
}

function buildClaudeTaskCloseDelta(task: ClaudeTrackedTask): ThreadDelta {
  const item = buildClaudeTaskItem(task);
  return {
    kind: "item.close",
    key: taskKey(task),
    status: item.status,
    item,
    presentation: claudeTaskPresentation(task),
  };
}

function isMaterializedTaskType(taskType: string): boolean {
  return (
    taskType === LOCAL_WORKFLOW_TASK_TYPE ||
    taskType === LOCAL_BASH_TASK_TYPE ||
    isBackgroundAgentTaskType(taskType)
  );
}

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
      return [];
    }
    if (
      existing === undefined &&
      message.tool_use_id !== undefined &&
      !args.hasForwardedToolUse(message.tool_use_id)
    ) {
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
        item: buildClaudeTaskItem(task),
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
