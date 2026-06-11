import { z } from "zod";

/**
 * Raw SDK task-type discriminant for dynamic workflows. Other task types
 * (subagents, background shells, monitors) share the same event family but are
 * not materialized as backgroundTask items yet — foreground subagents are
 * already rendered via delegation rows.
 *
 * Deliberately kept alongside bb workflow runs (BB_WORKFLOW_TASK_TYPE): the
 * convergence decision (keep both paths) is recorded in
 * docs/workflows-local-workflow-convergence.md.
 */
export const LOCAL_WORKFLOW_TASK_TYPE = "local_workflow";

/**
 * Task-type discriminant for bb workflow runs anchored to a thread. The
 * anchor item's `id` is the `wfr_` run id (the run-page deep link rides the
 * existing id field). Items of this type are owned end-to-end by the server
 * workflow lifecycle module: generic settle backstops
 * (settleDanglingBackgroundTasks) must skip them, because a paused workflow
 * item is resumable (`isSettledBackgroundTaskStatus("paused")` is false) and a
 * completed row is terminal forever.
 *
 * Coexists with the provider-native LOCAL_WORKFLOW_TASK_TYPE path by decision:
 * see docs/workflows-local-workflow-convergence.md.
 */
export const BB_WORKFLOW_TASK_TYPE = "bb_workflow";

/**
 * Provider-reported task lifecycle status: the union of the SDK's
 * task_updated patch statuses (pending/running/completed/failed/killed/paused)
 * and task_notification terminal statuses (completed/failed/stopped).
 */
export const backgroundTaskStatusValues = [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "killed",
  "stopped",
] as const;
export const backgroundTaskStatusSchema = z.enum(backgroundTaskStatusValues);
export type BackgroundTaskStatus = z.infer<typeof backgroundTaskStatusSchema>;

/**
 * Normalized per-agent state persisted in workflow snapshots. Derived from the
 * provider's raw record state machine (start/progress/done/error + flags):
 * queued = started but no slot yet; skipped = user-skipped error. An
 * "interrupted" display state is derived at render time from a terminal task
 * with non-terminal agents — it is intentionally not persisted per agent.
 */
export const workflowAgentStateValues = [
  "queued",
  "running",
  "done",
  "failed",
  "skipped",
] as const;
export const workflowAgentStateSchema = z.enum(workflowAgentStateValues);
export type WorkflowAgentState = z.infer<typeof workflowAgentStateSchema>;

/**
 * Whether an agent has reached a terminal state. The single source of truth
 * for "n/m agents" progress counts and for deriving the render-time
 * "interrupted" display state (a settled workflow with unsettled agents).
 */
export function isSettledWorkflowAgentState(
  state: WorkflowAgentState,
): boolean {
  switch (state) {
    case "done":
    case "failed":
    case "skipped":
      return true;
    case "queued":
    case "running":
      return false;
  }
}

export const workflowAgentSnapshotSchema = z.object({
  /** 1-based agent counter; the stable identity for fold/replace semantics. */
  index: z.number().int().positive(),
  label: z.string(),
  state: workflowAgentStateSchema,
  model: z.string(),
  attempt: z.number().int().positive(),
  cached: z.boolean(),
  lastProgressAt: z.number(),
  phaseIndex: z.number().int().positive().optional(),
  phaseTitle: z.string().optional(),
  agentType: z.string().optional(),
  isolation: z.string().optional(),
  queuedAt: z.number().optional(),
  startedAt: z.number().optional(),
  lastToolName: z.string().optional(),
  lastToolSummary: z.string().optional(),
  promptPreview: z.string().optional(),
  resultPreview: z.string().optional(),
  error: z.string().optional(),
  tokens: z.number().optional(),
  toolCalls: z.number().optional(),
  durationMs: z.number().optional(),
});
export type WorkflowAgentSnapshot = z.infer<typeof workflowAgentSnapshotSchema>;

export const workflowPhaseSnapshotSchema = z.object({
  /** 1-based phase counter; meta.phases are seeded before any agent runs. */
  index: z.number().int().positive(),
  title: z.string(),
  /** "child" marks a nested workflow() sub-run group. */
  kind: z.string().optional(),
});
export type WorkflowPhaseSnapshot = z.infer<typeof workflowPhaseSnapshotSchema>;

/**
 * Full merged workflow state at a point in time. Providers emit progress as
 * delta batches; the adapter folds them by (record type, index) so every
 * persisted snapshot supersedes the previous one.
 */
export const workflowProgressSnapshotSchema = z.object({
  phases: z.array(workflowPhaseSnapshotSchema),
  agents: z.array(workflowAgentSnapshotSchema),
});
export type WorkflowProgressSnapshot = z.infer<
  typeof workflowProgressSnapshotSchema
>;

export const backgroundTaskUsageSchema = z.object({
  totalTokens: z.number(),
  toolUses: z.number(),
  durationMs: z.number(),
});
export type BackgroundTaskUsage = z.infer<typeof backgroundTaskUsageSchema>;

/**
 * Canonical derivation from the provider-reported task status to the shared
 * item-status machinery: paused stays pending because a paused workflow is
 * resumable; stopped maps to interrupted (user/system stop, not a failure).
 */
export function backgroundTaskItemStatus(
  taskStatus: BackgroundTaskStatus,
): "pending" | "completed" | "failed" | "interrupted" {
  switch (taskStatus) {
    case "pending":
    case "running":
    case "paused":
      return "pending";
    case "completed":
      return "completed";
    case "failed":
    case "killed":
      return "failed";
    case "stopped":
      return "interrupted";
  }
}

/**
 * Whether the provider-reported status already describes a finished task.
 * Settle backstops (thread restart, daemon crash, lease expiry) must preserve
 * these statuses instead of rewriting them to "stopped": a workflow whose
 * completion patch arrived before its terminal notification is completed, not
 * interrupted.
 */
export function isSettledBackgroundTaskStatus(
  taskStatus: BackgroundTaskStatus,
): boolean {
  return backgroundTaskItemStatus(taskStatus) !== "pending";
}
