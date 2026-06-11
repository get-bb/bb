import {
  isSettledWorkflowAgentState,
  type WorkflowAgentState,
  type WorkflowRunStatus,
} from "@bb/domain";
import { assertNever } from "./assert-never.js";

/**
 * Render-time lifecycle of the run that owns a progress snapshot. It only
 * shapes how non-settled agents display:
 * - `running`: agents render their snapshot state as-is.
 * - `paused`: the run is interrupted but resumable — running agents render
 *   paused (they will resume), queued agents stay queued.
 * - `settled`: the run is terminal — leftover queued/running agents render as
 *   stopped (the derived "interrupted" display state; never persisted).
 *
 * This is the single canonical semantics for every snapshot renderer (SPA
 * agent tree, run page, CLI text tree) — do not re-derive it locally.
 */
export type WorkflowRunDisplayState = "running" | "paused" | "settled";

/**
 * Per-agent display state: the persisted snapshot state plus the two derived
 * render-only states (`paused` for resumable runs, `interrupted` for leftover
 * non-settled agents of a terminal run — displayed as "stopped").
 */
export type WorkflowAgentDisplayState =
  | WorkflowAgentState
  | "interrupted"
  | "paused";

/** Canonical run status → display run-state mapping shared by all renderers. */
export function workflowRunDisplayState(
  status: WorkflowRunStatus,
): WorkflowRunDisplayState {
  switch (status) {
    case "created":
    case "starting":
    case "running":
      return "running";
    case "interrupted":
      return "paused";
    case "completed":
    case "failed":
    case "cancelled":
      return "settled";
    default:
      return assertNever(status);
  }
}

export function deriveWorkflowAgentDisplayState(
  agentState: WorkflowAgentState,
  runState: WorkflowRunDisplayState,
): WorkflowAgentDisplayState {
  if (isSettledWorkflowAgentState(agentState)) {
    return agentState;
  }
  switch (runState) {
    case "running":
      return agentState;
    case "paused":
      return agentState === "running" ? "paused" : agentState;
    case "settled":
      return "interrupted";
    default:
      return assertNever(runState);
  }
}
