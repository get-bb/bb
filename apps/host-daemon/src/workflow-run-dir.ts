// Run-dir layout and liveness primitives for workflow runs (plan §3): each run
// owns `<dataDir>/workflow-runs/<runId>/` holding the runner's `.heartbeat`
// deadman file, the `runner.pid` record, the `journal.jsonl` hot cache, the
// `terminal.json` settle record, and the executor-owned `agents/` /
// `worktrees/` / `agent-storage/` subtrees. The workflow-run-manager composes
// these; heartbeat freshness is what makes active-run reporting trustworthy
// across daemon restarts.

import fs from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { WORKFLOW_RUN_TERMINAL_EVENT_TYPES } from "@bb/domain";

const RUNNER_PID_FILE_NAME = "runner.pid";
const HEARTBEAT_FILE_NAME = ".heartbeat";
const JOURNAL_FILE_NAME = "journal.jsonl";
const TERMINAL_RECORD_FILE_NAME = "terminal.json";
const RESUME_MARKER_FILE_NAME = "resume-marker.json";

export function workflowRunsRootPath(dataDir: string): string {
  return join(dataDir, "workflow-runs");
}

export function workflowRunDirPath(dataDir: string, runId: string): string {
  return join(workflowRunsRootPath(dataDir), runId);
}

export function workflowRunHeartbeatPath(runDir: string): string {
  return join(runDir, HEARTBEAT_FILE_NAME);
}

export function workflowRunJournalPath(runDir: string): string {
  return join(runDir, JOURNAL_FILE_NAME);
}

function workflowRunnerPidPath(runDir: string): string {
  return join(runDir, RUNNER_PID_FILE_NAME);
}

const runnerPidFileSchema = z.strictObject({
  pid: z.number().int().positive(),
});

export async function writeWorkflowRunnerPidFile(
  runDir: string,
  pid: number,
): Promise<void> {
  await fs.writeFile(workflowRunnerPidPath(runDir), JSON.stringify({ pid }));
}

/** The recorded runner pid, or null when the file is missing or malformed. */
export async function readWorkflowRunnerPidFile(
  runDir: string,
): Promise<number | null> {
  let raw: string;
  try {
    raw = await fs.readFile(workflowRunnerPidPath(runDir), "utf8");
  } catch {
    return null;
  }
  try {
    return runnerPidFileSchema.parse(JSON.parse(raw)).pid;
  } catch {
    return null;
  }
}

export async function clearWorkflowRunnerPidFile(runDir: string): Promise<void> {
  await fs.rm(workflowRunnerPidPath(runDir), { force: true });
}

/**
 * Remove a settled run's heartbeat so a recently-dead runner is never reported
 * active for the residual freshness window.
 */
export async function removeWorkflowRunHeartbeat(runDir: string): Promise<void> {
  await fs.rm(workflowRunHeartbeatPath(runDir), { force: true });
}

function workflowRunTerminalRecordPath(runDir: string): string {
  return join(runDir, TERMINAL_RECORD_FILE_NAME);
}

const workflowRunTerminalRecordSchema = z.strictObject({
  /** The terminal run event that settled this run segment. */
  eventType: z.enum(WORKFLOW_RUN_TERMINAL_EVENT_TYPES),
  settledAtMs: z.number().int().nonnegative(),
});
export type WorkflowRunTerminalRecord = z.infer<
  typeof workflowRunTerminalRecordSchema
>;

/**
 * Record that a terminal run event was emitted for this run dir. The
 * workflow.start handler uses it to absorb durable redelivery after the run
 * settled (the live-handle check only covers runs that have not been cleaned
 * up yet): a fresh start for a terminal run dir acks without a re-spawn that
 * would re-run — and re-bill — the whole workflow.
 */
export async function writeWorkflowRunTerminalRecord(
  runDir: string,
  record: WorkflowRunTerminalRecord,
): Promise<void> {
  await fs.writeFile(
    workflowRunTerminalRecordPath(runDir),
    JSON.stringify(record),
  );
}

/** The recorded terminal settle, or null when the segment never settled here. */
export async function readWorkflowRunTerminalRecord(
  runDir: string,
): Promise<WorkflowRunTerminalRecord | null> {
  let raw: string;
  try {
    raw = await fs.readFile(workflowRunTerminalRecordPath(runDir), "utf8");
  } catch {
    return null;
  }
  try {
    return workflowRunTerminalRecordSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Resume starts a new run segment: the previous settle no longer applies. */
export async function clearWorkflowRunTerminalRecord(
  runDir: string,
): Promise<void> {
  await fs.rm(workflowRunTerminalRecordPath(runDir), { force: true });
}

function workflowRunResumeMarkerPath(runDir: string): string {
  return join(runDir, RESUME_MARKER_FILE_NAME);
}

const workflowRunResumeMarkerSchema = z.strictObject({
  /** The per-operation nonce of the last resume delivery processed here. */
  nonce: z.string().min(1),
});

/**
 * Records which resume delivery last cleared this run dir's terminal record
 * and (re)started a segment. The workflow.start handler compares it against
 * an incoming resume command's nonce: terminal record present + matching
 * nonce means THIS delivery's segment already ran to settle here, so a
 * durable redelivery acks without re-running (re-billing) the suffix —
 * while a fresh resume operation (new nonce) legitimately clears the record.
 */
export async function writeWorkflowRunResumeMarker(
  runDir: string,
  nonce: string,
): Promise<void> {
  // The marker is written before the manager spawns (and mkdirs): a resume
  // landing on a host with no run dir yet (server-journal resume after data
  // loss or host replacement) must not fail on the missing directory.
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    workflowRunResumeMarkerPath(runDir),
    JSON.stringify({ nonce }),
  );
}

/** The recorded resume nonce, or null when no resume was ever processed here. */
export async function readWorkflowRunResumeMarker(
  runDir: string,
): Promise<string | null> {
  let raw: string;
  try {
    raw = await fs.readFile(workflowRunResumeMarkerPath(runDir), "utf8");
  } catch {
    return null;
  }
  try {
    return workflowRunResumeMarkerSchema.parse(JSON.parse(raw)).nonce;
  } catch {
    return null;
  }
}

/**
 * Whether the run's heartbeat file was touched within `staleMs` of `nowMs`.
 * Missing file = not fresh: a runner that never started (or whose settled run
 * was cleaned up) is dead by definition.
 */
export async function isWorkflowRunHeartbeatFresh(args: {
  runDir: string;
  staleMs: number;
  nowMs: number;
}): Promise<boolean> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(workflowRunHeartbeatPath(args.runDir));
  } catch {
    return false;
  }
  return args.nowMs - stat.mtimeMs < args.staleMs;
}

/** Run ids with a run dir on disk (empty when no run ever started on this host). */
export async function listWorkflowRunIds(dataDir: string): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof readRootEntries>>;
  try {
    entries = await readRootEntries(dataDir);
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function readRootEntries(dataDir: string) {
  return fs.readdir(workflowRunsRootPath(dataDir), { withFileTypes: true });
}

/**
 * Best-effort process liveness: signal 0 probes without delivering. EPERM
 * means the pid exists but belongs to another user — alive. Pid-file liveness
 * is inherently subject to pid reuse; the run dir is daemon-owned, so this is
 * the standard pidfile trade-off.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return getErrorCode(error) === "EPERM";
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}
