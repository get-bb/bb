/**
 * Realtime channel the workflow service publishes on when the set of runs
 * for an origin thread changes (start, claim, settle, cancel). Payload:
 * `{ threadId }` (the origin thread). Kept free of other imports so the app
 * bundle can share the constant without pulling the server-side contract.
 */
export const WORKFLOW_RUNS_REALTIME_CHANNEL = "workflow-runs";

/** Narrow a `useRealtime` payload to the origin thread it names, or null. */
export function workflowRunsSignalThreadId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const threadId = (payload as { threadId?: unknown }).threadId;
  return typeof threadId === "string" ? threadId : null;
}
