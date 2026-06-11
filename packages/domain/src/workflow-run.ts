import { z } from "zod";
import { jsonValueSchema } from "./json-value.js";

/**
 * Workflow run status — strictly the run's CURRENT state, never intent or
 * queue position (requested/queued work lives on workflow_run_operations).
 * `interrupted` is the resumable post-crash state; the terminal trio is
 * immutable forever. The allowed moves between these values are encoded in
 * `ALLOWED_WORKFLOW_RUN_STATUS_TRANSITIONS` (packages/db), which only the
 * server lifecycle module drives.
 */
export const workflowRunStatusValues = [
  "created",
  "starting",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;
export const workflowRunStatusSchema = z.enum(workflowRunStatusValues);
export type WorkflowRunStatus = z.infer<typeof workflowRunStatusSchema>;

/**
 * The immutable terminal statuses. `interrupted` is deliberately absent: an
 * interrupted run is resumable and may be revived or superseded by a late
 * real outcome.
 */
export const workflowRunTerminalStatusValues = [
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly WorkflowRunStatus[];
export const workflowRunTerminalStatusSchema = z.enum(
  workflowRunTerminalStatusValues,
);
export type WorkflowRunTerminalStatus = z.infer<
  typeof workflowRunTerminalStatusSchema
>;

const workflowRunTerminalStatusSet: ReadonlySet<WorkflowRunStatus> = new Set(
  workflowRunTerminalStatusValues,
);

/**
 * The one terminality predicate (derived from the terminal trio above, which
 * the transition table in @bb/db maps to empty target lists) — every
 * "completed | failed | cancelled" check goes through here so a future status
 * change has a single place to land.
 */
export function isTerminalWorkflowRunStatus(
  status: WorkflowRunStatus,
): status is WorkflowRunTerminalStatus {
  return workflowRunTerminalStatusSet.has(status);
}

/**
 * Durable manager-notification intent for thread-anchored runs — internal
 * lifecycle state on `workflow_runs`, never exposed on the public
 * WorkflowRunResponse. `paused` = the interruption informational message is
 * owed while the run is still `interrupted`; `settled` = the single terminal
 * notification for a server-settled cancel is owed. The server's delivery
 * sweep consumes the intent once the manager's host is reachable, so the
 * message survives the daemon socket-detach window every real interruption
 * trigger fires in.
 */
export const workflowRunPendingManagerNotificationValues = [
  "paused",
  "settled",
] as const;
export const workflowRunPendingManagerNotificationSchema = z.enum(
  workflowRunPendingManagerNotificationValues,
);
export type WorkflowRunPendingManagerNotification = z.infer<
  typeof workflowRunPendingManagerNotificationSchema
>;

/** Where the run's script snapshot was resolved from at launch. */
export const workflowRunSourceTierValues = [
  "project",
  "user",
  "builtin",
  "inline",
] as const;
export const workflowRunSourceTierSchema = z.enum(workflowRunSourceTierValues);
export type WorkflowRunSourceTier = z.infer<typeof workflowRunSourceTierSchema>;

/**
 * Journal retention state: `live` runs keep full event payloads (resume must
 * never silently re-bill); the retention sweep archives terminal runs, after
 * which journal payloads become prunable and resumability is lost.
 */
export const workflowRunRetentionValues = ["live", "archived"] as const;
export const workflowRunRetentionSchema = z.enum(workflowRunRetentionValues);
export type WorkflowRunRetention = z.infer<typeof workflowRunRetentionSchema>;

/**
 * Workflow-facing sandbox levels, as authored in workflow files and resolved
 * onto `workflow_runs` columns. Canonical source of truth — the runtime's
 * sandbox→permission-mode mapping lives in @bb/workflow-runtime, which should
 * consume this enum rather than redeclare it.
 */
export const workflowSandboxValues = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;
export const workflowSandboxSchema = z.enum(workflowSandboxValues);
export type WorkflowSandbox = z.infer<typeof workflowSandboxSchema>;

/**
 * Sandbox levels are ordered by privilege (the `workflowSandboxValues` array
 * order); a sandbox is allowed when it does not exceed the ceiling. The one
 * comparison shared by the server launch gate (resolved run default vs the
 * project's sandbox ceiling) and the daemon executor's per-call enforcement
 * (`agent({sandbox})` vs the ceiling snapshotted on the run).
 */
export function isWorkflowSandboxAllowedByCeiling(args: {
  ceiling: WorkflowSandbox;
  sandbox: WorkflowSandbox;
}): boolean {
  return (
    workflowSandboxValues.indexOf(args.sandbox) <=
    workflowSandboxValues.indexOf(args.ceiling)
  );
}

/**
 * The stricter of `sandbox` and `ceiling` (min by the privilege order above).
 * Used at `workflow.start` command-queue time to clamp a run's snapshotted
 * ceiling to the project's CURRENT effective ceiling: revoking a grant must
 * reach still-`created` and `interrupted` runs (their next start/resume runs
 * under the lowered ceiling), while a later RAISE never loosens an existing
 * run (the snapshot stays the upper bound).
 */
export function clampWorkflowSandboxToCeiling(args: {
  ceiling: WorkflowSandbox;
  sandbox: WorkflowSandbox;
}): WorkflowSandbox {
  return isWorkflowSandboxAllowedByCeiling(args) ? args.sandbox : args.ceiling;
}

/**
 * How a single agent() call settled — the `status` of a journal entry. Not to
 * be confused with `WorkflowAgentState` (background-task.ts), the live
 * per-agent snapshot state machine used for rendering.
 */
export const workflowAgentStatusValues = [
  "completed",
  "failed",
  "interrupted",
] as const;
export const workflowAgentStatusSchema = z.enum(workflowAgentStatusValues);
export type WorkflowAgentStatus = z.infer<typeof workflowAgentStatusSchema>;

/** Token usage attributed to one agent (accumulated across corrective retries). */
export const workflowAgentUsageSchema = z.strictObject({
  inputTokens: z.number(),
  outputTokens: z.number(),
});
export type WorkflowAgentUsage = z.infer<typeof workflowAgentUsageSchema>;

/**
 * The provider id on durable workflow payloads. Plain string by dependency
 * direction: @bb/agent-providers depends on @bb/domain, so the catalog-typed
 * id cannot be referenced here. The daemon re-parses to its catalog type at
 * the runner wire (@bb/workflow-runtime runner-protocol).
 */
const workflowProviderIdSchema = z.string().min(1);

/**
 * One settled agent() call — the payload carried by `agent/completed` and
 * `agent/failed` run events and the unit of resume replay. The durable twin of
 * @bb/workflow-runtime's WorkflowJournalEntry with the provider id widened to
 * a plain string. Entries with status `completed` replay instantly on resume;
 * failed/interrupted entries never replay but pin the agent's display index
 * and record the billed usage.
 */
export const workflowRunJournalEntrySchema = z.strictObject({
  /** The chained resume key (@bb/workflow-runtime keys.ts). */
  key: z.string(),
  /** Journal-stable display index — reused on resume so events keep pointing at the same logical agent. */
  agentIndex: z.number().int(),
  /** Lineage of the branch the agent ran in (diagnostics). */
  branchKey: z.string(),
  status: workflowAgentStatusSchema,
  /** Final assistant text ("" when the agent settled without producing any). */
  resultText: z.string(),
  /** Present only for schema'd calls: the validated structured value. */
  structured: jsonValueSchema.optional(),
  usage: workflowAgentUsageSchema,
  provider: workflowProviderIdSchema,
  /** The resolved model override, when the spec carried one. */
  model: z.string().optional(),
  /** Where preserved worktree edits live, when the agent ran in a worktree that changed. */
  worktreeBranch: z.string().optional(),
  durationMs: z.number(),
});
export type WorkflowRunJournalEntry = z.infer<
  typeof workflowRunJournalEntrySchema
>;

/** Display metadata shared by every agent-scoped run event. */
const workflowAgentEventMetaShape = {
  agentIndex: z.number().int(),
  label: z.string(),
  provider: workflowProviderIdSchema,
  model: z.string().optional(),
  phaseIndex: z.number().int().optional(),
  phaseTitle: z.string().optional(),
};

/**
 * The durable run-event union — the rows of `workflow_run_events` and the
 * payloads of the daemon's workflow event spool. Mirrors the runtime's
 * WorkflowRunEvent (@bb/workflow-runtime runtime.ts / runner-protocol.ts)
 * exactly, with provider ids widened to plain strings; the runtime type stays
 * assignable to this one. `agent/completed` AND `agent/failed` together ARE
 * the authoritative resume journal — failure entries never replay, but they
 * pin agent display indexes and billed usage, so a journal rebuilt from
 * events must include both (see WORKFLOW_RUN_JOURNAL_EVENT_TYPES).
 */
export const workflowRunEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("run/started"), runId: z.string() }),
  z.strictObject({
    type: z.literal("phase/started"),
    phaseIndex: z.number().int(),
    title: z.string(),
  }),
  z.strictObject({
    type: z.literal("agent/queued"),
    promptPreview: z.string(),
    ...workflowAgentEventMetaShape,
  }),
  z.strictObject({
    type: z.literal("agent/started"),
    ...workflowAgentEventMetaShape,
  }),
  z.strictObject({
    type: z.literal("agent/progress"),
    lastToolName: z.string().optional(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    ...workflowAgentEventMetaShape,
  }),
  z.strictObject({
    type: z.literal("agent/completed"),
    cached: z.boolean(),
    entry: workflowRunJournalEntrySchema,
    ...workflowAgentEventMetaShape,
  }),
  z.strictObject({
    type: z.literal("agent/failed"),
    error: z.string(),
    /** The journaled failure record (status failed/interrupted, billed usage). */
    entry: workflowRunJournalEntrySchema,
    ...workflowAgentEventMetaShape,
  }),
  z.strictObject({ type: z.literal("log"), message: z.string() }),
  z.strictObject({
    type: z.literal("run/completed"),
    result: jsonValueSchema,
    usage: workflowAgentUsageSchema,
  }),
  z.strictObject({
    type: z.literal("run/failed"),
    error: z.string(),
    usage: workflowAgentUsageSchema,
  }),
  z.strictObject({
    type: z.literal("run/cancelled"),
    usage: workflowAgentUsageSchema,
  }),
]);
export type WorkflowRunEvent = z.infer<typeof workflowRunEventSchema>;
export type WorkflowRunEventType = WorkflowRunEvent["type"];

/**
 * The event types whose payloads rebuild the resume journal. Both members are
 * required: rebuilding from `agent/completed` alone would shift display
 * indexes and under-bill on resume (failed entries pin agentIndex and billed
 * usage).
 */
export const WORKFLOW_RUN_JOURNAL_EVENT_TYPES = [
  "agent/completed",
  "agent/failed",
] as const satisfies readonly WorkflowRunEventType[];

/**
 * The run-terminal event types. Run completion always arrives as one of these
 * events (never as a command result); they drive lifecycle finalize on the
 * server and immediate spool flush on the daemon.
 */
export const WORKFLOW_RUN_TERMINAL_EVENT_TYPES = [
  "run/completed",
  "run/failed",
  "run/cancelled",
] as const satisfies readonly WorkflowRunEventType[];

/**
 * The journal-relevant display agent index of a run event, when the event is
 * agent-scoped — the value persisted on `workflow_run_events.agent_index` for
 * per-agent drill-in queries.
 */
export function getWorkflowRunEventAgentIndex(
  event: WorkflowRunEvent,
): number | null {
  switch (event.type) {
    case "agent/queued":
    case "agent/started":
    case "agent/progress":
    case "agent/completed":
    case "agent/failed":
      return event.agentIndex;
    case "run/started":
    case "phase/started":
    case "log":
    case "run/completed":
    case "run/failed":
    case "run/cancelled":
      return null;
  }
}
