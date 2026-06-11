import {
  isSettledWorkflowAgentState,
  type WorkflowAgentSnapshot,
  type WorkflowProgressSnapshot,
  type WorkflowRunStatus,
} from "@bb/domain";
import type { WorkflowRunResponse } from "@bb/server-contract";
import type { BbSdk } from "@bb/sdk/node";
import { BbHttpError } from "@bb/sdk/node";
import { assertNever } from "@bb/core-ui";
import {
  deriveWorkflowAgentDisplayState,
  type WorkflowAgentDisplayState,
  type WorkflowRunDisplayState,
} from "@bb/thread-view";
import { CliExitError } from "../../action.js";
import { outputJson, type JsonOutputOptions } from "../helpers.js";

export const WORKFLOW_WAIT_EXIT_CODE_TIMEOUT = 2;
export const WORKFLOW_WAIT_EXIT_CODE_INVALID_REQUEST = 3;
export const WORKFLOW_WAIT_EXIT_CODE_UNREACHABLE = 4;
/**
 * Workflow runs are long-lived fan-outs, so the default deadline is generous
 * compared to `bb thread wait`'s 30s; each long-poll round stays capped at
 * 30s (under the SDK's 75s fetch timeout) and the loop owns the deadline.
 */
export const DEFAULT_WORKFLOW_WAIT_TIMEOUT_SECONDS = 600;
export const DEFAULT_WORKFLOW_WAIT_POLL_INTERVAL_MS = 250;
const WORKFLOW_WAIT_MAX_ROUND_MS = 30_000;

const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate a positional workflow run id. Rejects `wfa_*` agent-session ids
 * with targeted guidance (they are run-scoped provider sessions, never
 * addressable entities) and anything else that is not a `wfr_*` id.
 */
export function requireWorkflowRunId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("wfa_")) {
    throw new Error(
      `"${trimmed}" is a workflow agent session id, not a workflow run id. ` +
        "Agent sessions are inspected through their run: pass the wfr_* run id " +
        "(see 'bb workflow runs').",
    );
  }
  if (!trimmed.startsWith("wfr_") || !VALID_ID_PATTERN.test(trimmed)) {
    throw new Error(
      `Invalid workflow run ID "${trimmed}". Expected a wfr_* id (see 'bb workflow runs').`,
    );
  }
  return trimmed;
}

/** SPA run-page deep link (`/workflows/runs/:id`), served same-origin by the server. */
export function workflowRunDeepLink(serverUrl: string, runId: string): string {
  return `${serverUrl.replace(/\/+$/, "")}/workflows/runs/${runId}`;
}

/**
 * Human status with a gloss for the pre-running states, which otherwise read
 * as a hang: `created` runs are queued for host admission (the over-cap hold
 * is deliberately invisible in `status` — operation state is internal), and
 * `starting` runs have their start command in flight to the host.
 */
export function formatWorkflowRunStatus(status: WorkflowRunStatus): string {
  switch (status) {
    case "created":
      return "created (queued — starts when the host has capacity)";
    case "starting":
      return "starting (start command in flight to the host)";
    default:
      return status;
  }
}

export function parseWorkflowWaitTimeoutSeconds(
  value: string | undefined,
): number {
  if (value === undefined) return DEFAULT_WORKFLOW_WAIT_TIMEOUT_SECONDS;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CliExitError(
      "Timeout must be a non-negative number of seconds.",
      WORKFLOW_WAIT_EXIT_CODE_INVALID_REQUEST,
    );
  }
  return parsed;
}

export function parseWorkflowWaitPollIntervalMs(
  value: string | undefined,
): number {
  if (value === undefined) return DEFAULT_WORKFLOW_WAIT_POLL_INTERVAL_MS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new CliExitError(
      "Poll interval must be a positive integer number of milliseconds.",
      WORKFLOW_WAIT_EXIT_CODE_INVALID_REQUEST,
    );
  }
  return parsed;
}

export interface WaitForSettledWorkflowRunArgs {
  sdk: BbSdk;
  runId: string;
  timeoutSeconds: number;
  pollIntervalMs: number;
}

/**
 * Long-poll `/workflow-runs/:id/wait` until the run reaches a terminal status
 * (`completed|failed|cancelled`). Exits 4 when the run is `interrupted`
 * (waiting alone never settles it — it needs `bb workflow resume` or a daemon
 * reconnect revival) and 2 on deadline.
 */
export async function waitForSettledWorkflowRun(
  args: WaitForSettledWorkflowRunArgs,
): Promise<WorkflowRunResponse> {
  const deadline = Date.now() + args.timeoutSeconds * 1000;

  // Pre-check so an already-interrupted run fails fast with the resume hint
  // instead of burning a full long-poll round first (interrupted is not
  // terminal, so /wait would block the whole round on it).
  throwIfWorkflowRunInterrupted(
    await args.sdk.workflows.get({ runId: args.runId }),
  );

  while (true) {
    const remainingMs = Math.max(0, deadline - Date.now());
    const waitMs = Math.floor(Math.min(remainingMs, WORKFLOW_WAIT_MAX_ROUND_MS));
    const run = await args.sdk.workflows.wait({
      runId: args.runId,
      waitMs: String(waitMs),
    });
    if (run !== null) {
      return run;
    }

    const current = await args.sdk.workflows.get({ runId: args.runId });
    throwIfWorkflowRunInterrupted(current);

    if (Date.now() >= deadline) {
      throw new CliExitError(
        `Timed out waiting for workflow run ${args.runId} to settle (status: ${formatWorkflowRunStatus(current.status)}).`,
        WORKFLOW_WAIT_EXIT_CODE_TIMEOUT,
      );
    }
    await sleep(args.pollIntervalMs);
  }
}

function throwIfWorkflowRunInterrupted(run: WorkflowRunResponse): void {
  if (run.status !== "interrupted") return;
  throw new CliExitError(
    `Workflow run ${run.id} is interrupted and will not settle by waiting alone. ` +
      `Resume it with 'bb workflow resume ${run.id}' (the completed prefix replays free), then wait again.`,
    WORKFLOW_WAIT_EXIT_CODE_UNREACHABLE,
  );
}

/**
 * Print a settled run (`--json`: the raw run response; human: status line +
 * resultJson) and make the exit code reflect the terminal status — 0 only for
 * `completed`.
 */
export function reportSettledWorkflowRun(
  opts: JsonOutputOptions,
  run: WorkflowRunResponse,
): void {
  if (!outputJson(opts, run) && run.status === "completed") {
    const duration =
      run.startedAt !== null && run.settledAt !== null
        ? ` in ${formatDurationMs(run.settledAt - run.startedAt)}`
        : "";
    console.log(`Workflow run ${run.id} completed${duration}.`);
    if (run.resultJson !== null) {
      console.log(run.resultJson);
    } else {
      console.log("(no result)");
    }
  }

  if (run.status === "failed") {
    throw new CliExitError(
      `Workflow run ${run.id} failed${run.failureReason ? `: ${run.failureReason}` : ""}. Inspect it with 'bb workflow show ${run.id}'.`,
      1,
    );
  }
  if (run.status === "cancelled") {
    throw new CliExitError(
      `Workflow run ${run.id} was cancelled. Inspect it with 'bb workflow show ${run.id}'.`,
      1,
    );
  }
}

/**
 * Remap lifecycle 409 codes from cancel/resume into actionable messages; any
 * other error passes through untouched.
 */
export function mapWorkflowLifecycleError(err: unknown, runId: string): unknown {
  if (!(err instanceof BbHttpError)) return err;
  switch (err.code) {
    case "workflow_run_archived":
      return new Error(
        `Workflow run ${runId} is archived. Archived runs keep their results but lose resumability and cannot be cancelled.`,
      );
    case "workflow_run_not_resumable":
      return new Error(
        `Workflow run ${runId} is not interrupted — only interrupted runs can be resumed. Check it with 'bb workflow show ${runId}'.`,
      );
    default:
      return err;
  }
}

/** "settled/total" agent progress from the durable snapshot, "-" before any progress. */
export function formatWorkflowAgentProgress(
  snapshot: WorkflowProgressSnapshot | null,
): string {
  if (snapshot === null || snapshot.agents.length === 0) return "-";
  const settled = snapshot.agents.filter((agent) =>
    isSettledWorkflowAgentState(agent.state),
  ).length;
  return `${settled}/${snapshot.agents.length}`;
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function workflowAgentGlyph(state: WorkflowAgentDisplayState): string {
  switch (state) {
    case "queued":
      return "·";
    case "running":
      return "▸";
    case "paused":
      return "‖";
    case "interrupted":
      return "▪";
    case "done":
      return "✓";
    case "failed":
      return "✗";
    case "skipped":
      return "⊘";
    default:
      return assertNever(state);
  }
}

/** Human label for a display state — "interrupted" reads as "stopped", matching the SPA. */
function workflowAgentDisplayStateLabel(
  state: WorkflowAgentDisplayState,
): string {
  return state === "interrupted" ? "stopped" : state;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

interface FormatAgentLineArgs {
  agent: WorkflowAgentSnapshot;
  indent: string;
  runState: WorkflowRunDisplayState;
}

function formatAgentLine({
  agent,
  indent,
  runState,
}: FormatAgentLineArgs): string {
  const displayState = deriveWorkflowAgentDisplayState(agent.state, runState);
  const flags: string[] = [
    workflowAgentDisplayStateLabel(displayState),
    ...(agent.cached ? ["cached"] : []),
    ...(agent.attempt > 1 ? [`attempt ${agent.attempt}`] : []),
  ];
  const metrics = [
    ...(agent.tokens !== undefined ? [`${agent.tokens} tok`] : []),
    ...(agent.durationMs !== undefined
      ? [formatDurationMs(agent.durationMs)]
      : []),
    ...(displayState === "running" && agent.lastToolName !== undefined
      ? [`tool: ${agent.lastToolName}`]
      : []),
  ];
  const label = agent.label.length > 0 ? agent.label : (agent.agentType ?? "agent");
  let line = `${indent}${workflowAgentGlyph(displayState)} ${agent.index}. ${label} [${flags.join(", ")}]`;
  if (metrics.length > 0) {
    line += ` ${metrics.join(" · ")}`;
  }
  if (displayState === "failed" && agent.error !== undefined) {
    line += ` — ${truncateText(agent.error, 100)}`;
  }
  return line;
}

export interface FormatWorkflowProgressTreeLinesArgs {
  indent: string;
  /**
   * Display run-state derived from the run status
   * (`workflowRunDisplayState`): a paused run renders its running agents
   * paused, a settled run renders leftovers stopped — the same canonical
   * semantics the SPA agent tree applies.
   */
  runState: WorkflowRunDisplayState;
  snapshot: WorkflowProgressSnapshot | null;
}

/**
 * Render the durable progress snapshot as a phase-grouped agent tree (the CLI
 * counterpart of the SPA workflow row). Agents without a phase render first;
 * phases render in index order with their agents nested.
 */
export function formatWorkflowProgressTreeLines({
  indent,
  runState,
  snapshot,
}: FormatWorkflowProgressTreeLinesArgs): string[] {
  if (
    snapshot === null ||
    (snapshot.phases.length === 0 && snapshot.agents.length === 0)
  ) {
    return [`${indent}(no progress reported yet)`];
  }

  const byPhase = new Map<number, WorkflowAgentSnapshot[]>();
  const phaseless: WorkflowAgentSnapshot[] = [];
  for (const agent of snapshot.agents) {
    if (agent.phaseIndex === undefined) {
      phaseless.push(agent);
      continue;
    }
    const group = byPhase.get(agent.phaseIndex) ?? [];
    group.push(agent);
    byPhase.set(agent.phaseIndex, group);
  }

  const lines: string[] = [];
  const byIndex = (a: WorkflowAgentSnapshot, b: WorkflowAgentSnapshot) =>
    a.index - b.index;
  for (const agent of phaseless.sort(byIndex)) {
    lines.push(formatAgentLine({ agent, indent, runState }));
  }
  const knownPhases = new Set<number>();
  for (const phase of [...snapshot.phases].sort((a, b) => a.index - b.index)) {
    knownPhases.add(phase.index);
    lines.push(`${indent}Phase ${phase.index} — ${phase.title}`);
    const agents = byPhase.get(phase.index) ?? [];
    for (const agent of agents.sort(byIndex)) {
      lines.push(formatAgentLine({ agent, indent: `${indent}  `, runState }));
    }
  }
  // Agents referencing a phase the snapshot has not seeded (defensive: the
  // fold seeds phases first, but a torn snapshot must still render).
  for (const [phaseIndex, agents] of [...byPhase.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    if (knownPhases.has(phaseIndex)) continue;
    lines.push(
      `${indent}Phase ${phaseIndex}${agents[0]?.phaseTitle ? ` — ${agents[0].phaseTitle}` : ""}`,
    );
    for (const agent of agents.sort(byIndex)) {
      lines.push(formatAgentLine({ agent, indent: `${indent}  `, runState }));
    }
  }
  return lines;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
