// Handlers for the workflow.* durable commands and registry RPCs (plan §8).
//
// workflow.start is acceptance-only and idempotent against durable redelivery:
// an already-active run acks via the manager's live-handle/in-flight-promise
// check, and a run whose segment already settled here acks via the run dir's
// terminal record — for resumes, scoped by the command's per-operation nonce
// against the run dir's resume marker, so a redelivered resume never re-runs
// a settled segment while a FRESH resume can still clear a stale record.
// Neither path re-spawns (a re-spawn would re-run and re-bill the workflow).
// Typed failures (`workflowStartErrorCodeValues`) travel as the generic
// {ok:false, errorCode} report via ExpectedCommandDispatchError.

import { jsonValueSchema, type JsonValue } from "@bb/domain";
import type {
  HostDaemonCommandResult,
  HostDaemonOnlineRpcResult,
} from "@bb/host-daemon-contract";
import {
  KEY_VERSION,
  runDefaultsSchema,
  type RunDefaults,
  type WorkflowJournalEntry,
} from "@bb/workflow-runtime";
import {
  CommandDispatchError,
  ExpectedCommandDispatchError,
  type CommandDispatchOptions,
  type CommandOf,
} from "../command-dispatch-support.js";
import {
  clearWorkflowRunTerminalRecord,
  readWorkflowRunResumeMarker,
  readWorkflowRunTerminalRecord,
  workflowRunDirPath,
  writeWorkflowRunResumeMarker,
} from "../workflow-run-dir.js";
import {
  listWorkflowRegistry,
  resolveWorkflowRegistryName,
} from "../workflow-registry.js";

type WorkflowStartCommand = CommandOf<"workflow.start">;

function requireWorkflowRunManager(
  options: CommandDispatchOptions,
): NonNullable<CommandDispatchOptions["workflowRunManager"]> {
  const manager = options.workflowRunManager;
  if (!manager) {
    throw new CommandDispatchError(
      "workflow_runs_unavailable",
      "This daemon embedding has no workflow run manager",
    );
  }
  return manager;
}

function parseLaunchArgs(argsJson: string | null): JsonValue | undefined {
  if (argsJson === null) {
    return undefined;
  }
  try {
    return jsonValueSchema.parse(JSON.parse(argsJson));
  } catch (error) {
    throw new CommandDispatchError(
      "invalid_args",
      `workflow.start argsJson is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Map the contract's explicit run-defaults columns onto the runner's
 * RunDefaults: providerId → catalog-parsed provider, workspacePath → cwd,
 * model null → omitted (no run-level override).
 */
function toRunnerDefaults(command: WorkflowStartCommand): RunDefaults {
  return runDefaultsSchema.parse({
    provider: command.defaults.providerId,
    ...(command.defaults.model !== null
      ? { model: command.defaults.model }
      : {}),
    effort: command.defaults.effort,
    sandbox: command.defaults.sandbox,
    cwd: command.workspacePath,
    concurrency: command.defaults.concurrency,
    maxAgents: command.defaults.maxAgents,
    maxFanout: command.defaults.maxFanout,
    budgetOutputTokens: command.defaults.budgetOutputTokens,
  });
}

async function fetchResumeJournal(
  command: WorkflowStartCommand,
  options: CommandDispatchOptions,
): Promise<WorkflowJournalEntry[]> {
  const fetchJournal = options.fetchWorkflowRunJournal;
  if (!fetchJournal) {
    throw new CommandDispatchError(
      "workflow_runs_unavailable",
      "This daemon embedding has no workflow run journal fetcher",
    );
  }
  try {
    return await fetchJournal({ runId: command.runId });
  } catch (error) {
    // Typed and retryable server-side: the resume op fails, the run stays
    // interrupted, and a later resume retries — never half-resumed.
    throw new ExpectedCommandDispatchError(
      "journal_fetch_failed",
      `Failed to fetch the resume journal for run ${command.runId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function startWorkflowRun(
  command: WorkflowStartCommand,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"workflow.start">> {
  const manager = requireWorkflowRunManager(options);
  const runDir = workflowRunDirPath(options.dataDir, command.runId);

  let journal: readonly WorkflowJournalEntry[] = [];
  if (command.resume !== null) {
    if (command.keyVersion !== KEY_VERSION) {
      throw new ExpectedCommandDispatchError(
        "resume_preconditions_failed",
        `Run ${command.runId} was journaled under key scheme "${command.keyVersion}" but this daemon resumes under "${KEY_VERSION}"`,
      );
    }
    if ((await readWorkflowRunTerminalRecord(runDir)) !== null) {
      if ((await readWorkflowRunResumeMarker(runDir)) === command.resume.nonce) {
        // Durable redelivery of a resume whose segment already ran to settle
        // here (the marker records which delivery cleared the record and
        // spawned) — ack without re-running, which would re-bill the suffix.
        return { accepted: true };
      }
      // A stale settle record from a PREVIOUS segment. The server gates
      // resume to `interrupted` runs only (recorded M3 divergence — never
      // failed/cancelled), but an interrupted-but-resumable run can still
      // carry a daemon-side record: a history-only run/cancelled the
      // server's transition table refused, or a synthetic runner_exited
      // settle whose finalize a revival raced. Cleared below so it cannot
      // absorb the new segment's redelivery checks.
    }
    // Fetch BEFORE any side effect so a journal failure leaves nothing behind
    // (no cleared terminal record, no spawned child).
    journal = await fetchResumeJournal(command, options);
    // A resume starts a new run segment: clear the previous segment's settle
    // record, then scope the redelivery check to THIS delivery's nonce.
    await clearWorkflowRunTerminalRecord(runDir);
    await writeWorkflowRunResumeMarker(runDir, command.resume.nonce);
  } else if ((await readWorkflowRunTerminalRecord(runDir)) !== null) {
    // Durable redelivery after the run settled here — ack without re-running.
    return { accepted: true };
  }

  const result = await manager.startRun({
    runId: command.runId,
    projectId: command.projectId,
    source: command.script.content,
    filename: `${command.script.name}.workflow.js`,
    args: parseLaunchArgs(command.argsJson),
    seed: command.seed,
    baseTimeMs: command.baseTimeMs,
    defaults: toRunnerDefaults(command),
    sandboxCeiling: command.sandboxCeiling,
    journal,
    execTimeoutMs: command.execTimeoutMs,
  });
  if (!result.accepted) {
    throw new ExpectedCommandDispatchError(result.code, result.message);
  }
  return { accepted: true };
}

export async function cancelWorkflowRun(
  command: CommandOf<"workflow.cancel">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"workflow.cancel">> {
  const manager = requireWorkflowRunManager(options);
  // false = no live run for this id (already settled or never started here):
  // a redelivery-safe no-op the server settle treats as success.
  return { accepted: manager.cancelRun(command.runId) };
}

/**
 * Run-dir prune for an archived run (retention sweep RPC). The manager
 * refuses while the run is demonstrably alive here; `pruned: false` tells the
 * sweep to retry on a later pass. Idempotent for a missing run dir.
 */
export async function pruneWorkflowRun(
  command: CommandOf<"workflow.prune">,
  options: CommandDispatchOptions,
): Promise<HostDaemonOnlineRpcResult<"workflow.prune">> {
  const manager = requireWorkflowRunManager(options);
  return manager.pruneRunDir(command.runId);
}

export async function listWorkflows(
  command: CommandOf<"workflow.list">,
  options: CommandDispatchOptions,
): Promise<HostDaemonOnlineRpcResult<"workflow.list">> {
  return {
    workflows: await listWorkflowRegistry({
      rootPath: command.rootPath,
      dataDir: options.dataDir,
    }),
  };
}

export async function resolveWorkflow(
  command: CommandOf<"workflow.resolve">,
  options: CommandDispatchOptions,
): Promise<HostDaemonOnlineRpcResult<"workflow.resolve">> {
  const resolved = await resolveWorkflowRegistryName({
    rootPath: command.rootPath,
    dataDir: options.dataDir,
    name: command.name,
  });
  if (!resolved) {
    throw new ExpectedCommandDispatchError(
      "workflow_not_found",
      `No workflow named "${command.name}" is visible from ${command.rootPath}`,
    );
  }
  return resolved;
}
