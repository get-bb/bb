import {
  closeAutomationRun,
  getThread,
  listEnvironments,
  setAutomationRunThread,
  type AutomationRow,
  type AutomationRunRow,
} from "@bb/db";
import type { AutomationExecution, EnvironmentArgs } from "@bb/server-contract";
import { renderTemplate } from "@bb/templates";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { createThreadFromRequest } from "../threads/thread-create.js";
import { requireThreadCommandEnvironment } from "../threads/thread-command-environment.js";
import { sendThreadMessage } from "../threads/thread-send.js";
import { requireConnectedPrimaryHostId } from "../hosts/primary-host.js";
import {
  runLiveHostCommand,
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
} from "../hosts/live-command.js";
import { workspaceContextFromPath } from "../environments/workspace-command-target.js";
import {
  resolveAutomationScriptPath,
  resolveDefaultInterpreter,
  resolveInterpreterCommand,
} from "./automation-scripts.js";

export type AutomationRunDeps = LoggedPendingInteractionWorkSessionDeps;

const SCRIPT_RPC_TIMEOUT_BUFFER_MS = 30_000;

/** Caller-supplied handling for a spawn/RPC failure before a result is produced. */
export type RunFailureHandler = (error: unknown) => void;

function notifyRuns(deps: AutomationRunDeps, projectId: string): void {
  deps.hub.notifyProject(projectId, [
    "automations-changed",
    "automation-runs-changed",
  ]);
}

function resolveAutomationHostId(
  deps: AutomationRunDeps,
  environment: EnvironmentArgs,
): string {
  if (environment.type === "host" && environment.hostId !== undefined) {
    return environment.hostId;
  }
  // Personal workspaces store no hostId; fall back to the primary host.
  return requireConnectedPrimaryHostId(deps);
}

/**
 * The last non-empty stdout line `{"wakeAgent": false}` silences a successful
 * script run (the cheap-monitor gate). Mirrors Hermes `_parse_wake_gate`.
 */
export function isWakeAgentSuppressed(output: string): boolean {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines[lines.length - 1];
  if (last === undefined) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(last);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "wakeAgent" in parsed &&
      (parsed as { wakeAgent: unknown }).wakeAgent === false
    );
  } catch {
    return false;
  }
}

interface ScriptRunOutcome {
  status: "succeeded" | "failed";
  output: string | null;
  exitCode: number | null;
  error: string | null;
}

export function mapScriptResultToRun(result: {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}): ScriptRunOutcome {
  if (result.timedOut) {
    return {
      status: "failed",
      output: result.output.length > 0 ? result.output : null,
      exitCode: null,
      error: "Script timed out",
    };
  }
  if (result.exitCode !== 0) {
    return {
      status: "failed",
      output: result.output.length > 0 ? result.output : null,
      exitCode: result.exitCode,
      error: `Script exited with code ${result.exitCode}`,
    };
  }
  if (
    result.output.trim().length === 0 ||
    isWakeAgentSuppressed(result.output)
  ) {
    return { status: "succeeded", output: null, exitCode: 0, error: null };
  }
  return { status: "succeeded", output: result.output, exitCode: 0, error: null };
}

/** Thread states that can accept a re-prompt turn from an automation. */
function isThreadReusable(thread: {
  deletedAt: number | null;
  archivedAt: number | null;
  status: string;
}): boolean {
  return (
    thread.deletedAt === null &&
    thread.archivedAt === null &&
    (thread.status === "idle" || thread.status === "active")
  );
}

/**
 * Run an agent automation by either reusing a configured target thread (submit a
 * system-initiated turn into it) or spawning a new thread. In both cases the run
 * row is linked to the thread and closed later by the turn-complete hook.
 *
 * On failure invoke `onFailure` (the sweep rolls back the schedule; run-now
 * marks the run failed). A missing/deleted/not-writable target thread is a clear
 * failure — we never silently spawn a new thread in its place.
 */
export async function executeAgentRun(
  deps: AutomationRunDeps,
  args: {
    automation: AutomationRow;
    run: AutomationRunRow;
    execution: Extract<AutomationExecution, { mode: "agent" }>;
    environment: EnvironmentArgs;
    onFailure: RunFailureHandler;
  },
): Promise<void> {
  if (args.automation.targetThreadId !== null) {
    await reuseTargetThreadForRun(deps, args);
    return;
  }
  try {
    const thread = await createThreadFromRequest(deps, {
      projectId: args.automation.projectId,
      environment: args.environment,
      input: [{ type: "text", text: args.execution.prompt, mentions: [] }],
      providerId: args.execution.providerId,
      model: args.execution.model,
      permissionMode: args.execution.permissionMode,
      origin: "automation",
      startedOnBehalfOf: null,
    });
    setAutomationRunThread(deps.db, { runId: args.run.id, threadId: thread.id });
    notifyRuns(deps, args.automation.projectId);
  } catch (error) {
    args.onFailure(error);
    notifyRuns(deps, args.automation.projectId);
    deps.logger.error(
      { automationId: args.automation.id, err: error },
      "Failed to spawn thread for automation run",
    );
  }
}

/**
 * Re-prompt an existing target thread with the automation's prompt wrapped in the
 * `systemMessageAutomationDue` template, as a `system`-initiated turn. Links the
 * run to that thread first so the turn-complete hook closes it.
 */
async function reuseTargetThreadForRun(
  deps: AutomationRunDeps,
  args: {
    automation: AutomationRow;
    run: AutomationRunRow;
    execution: Extract<AutomationExecution, { mode: "agent" }>;
    onFailure: RunFailureHandler;
  },
): Promise<void> {
  const targetThreadId = args.automation.targetThreadId;
  if (targetThreadId === null) {
    return;
  }
  const thread = getThread(deps.db, targetThreadId);
  if (!thread || !isThreadReusable(thread)) {
    args.onFailure(
      new Error(
        `Target thread ${targetThreadId} is unavailable (missing, deleted, archived, or not runnable)`,
      ),
    );
    notifyRuns(deps, args.automation.projectId);
    return;
  }

  try {
    const environment = await requireThreadCommandEnvironment(deps, { thread });
    // Link the run BEFORE dispatch so the turn-complete hook can close it.
    setAutomationRunThread(deps.db, {
      runId: args.run.id,
      threadId: thread.id,
    });
    const text = renderTemplate("systemMessageAutomationDue", {
      automationId: args.automation.id,
      prompt: args.execution.prompt,
    });
    await sendThreadMessage(deps, {
      environment,
      thread,
      trigger: "auto-dispatch",
      payload: {
        input: [{ type: "text", text, mentions: [] }],
        mode: "steer-if-active",
        permissionMode: args.execution.permissionMode,
      },
    });
    notifyRuns(deps, args.automation.projectId);
  } catch (error) {
    args.onFailure(error);
    notifyRuns(deps, args.automation.projectId);
    deps.logger.error(
      { automationId: args.automation.id, threadId: targetThreadId, err: error },
      "Failed to re-prompt target thread for automation run",
    );
  }
}

/**
 * Run the stored script for a run and close the run row synchronously. On an RPC
 * failure (host down) before a result, invoke `onFailure` (rollback/retry path).
 */
export async function executeScriptRun(
  deps: AutomationRunDeps,
  args: {
    automation: AutomationRow;
    run: AutomationRunRow;
    execution: Extract<AutomationExecution, { mode: "script" }>;
    environment: EnvironmentArgs;
    onFailure: RunFailureHandler;
    now: number;
  },
): Promise<void> {
  const scriptFile = args.execution.scriptFile;
  if (scriptFile === undefined) {
    closeAutomationRun(deps.db, {
      runId: args.run.id,
      status: "failed",
      error: "Script automation is missing a stored script file",
      now: args.now,
    });
    notifyRuns(deps, args.automation.projectId);
    return;
  }

  let hostId: string;
  try {
    hostId = resolveAutomationHostId(deps, args.environment);
  } catch (error) {
    args.onFailure(error);
    notifyRuns(deps, args.automation.projectId);
    return;
  }

  const readyEnvironment = listEnvironments(
    deps.db,
    args.automation.projectId,
  ).find(
    (env) => env.hostId === hostId && env.status === "ready" && env.path,
  );
  if (!readyEnvironment || !readyEnvironment.path) {
    closeAutomationRun(deps.db, {
      runId: args.run.id,
      status: "failed",
      error: "No ready workspace is available for the script automation",
      now: args.now,
    });
    notifyRuns(deps, args.automation.projectId);
    return;
  }

  let scriptPath: string;
  try {
    scriptPath = await resolveAutomationScriptPath({
      dataDir: deps.config.dataDir,
      automationId: args.automation.id,
      scriptFile,
    });
  } catch (error) {
    closeAutomationRun(deps.db, {
      runId: args.run.id,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      now: args.now,
    });
    notifyRuns(deps, args.automation.projectId);
    return;
  }

  const interpreter =
    args.execution.interpreter ?? resolveDefaultInterpreter(scriptFile);
  try {
    const result = await runLiveHostCommand(deps, {
      hostId,
      timeoutMs: Math.min(
        args.execution.timeoutMs + SCRIPT_RPC_TIMEOUT_BUFFER_MS,
        LIVE_DAEMON_COMMAND_TIMEOUT_MS,
      ),
      command: {
        type: "host.run_script",
        environmentId: readyEnvironment.id,
        workspaceContext: workspaceContextFromPath({
          path: readyEnvironment.path,
          workspaceProvisionType: readyEnvironment.workspaceProvisionType,
        }),
        command: resolveInterpreterCommand(interpreter),
        args: [scriptPath],
        cwd: readyEnvironment.path,
        env: {
          ...(args.execution.env ?? {}),
          // Inject the bb environment so a script can call back into `bb`
          // without manual exports (the daemon also inherits PATH for `bb`).
          BB_SERVER_URL: `http://127.0.0.1:${deps.config.serverPort}`,
          BB_HOST_DAEMON_PORT: String(deps.config.hostDaemonPort),
          BB_PROJECT_ID: args.automation.projectId,
          BB_ENVIRONMENT_ID: readyEnvironment.id,
          BB_AUTOMATION_ID: args.automation.id,
          BB_AUTOMATION_RUN_ID: args.run.id,
        },
        timeoutMs: args.execution.timeoutMs,
      },
    });
    const mapped = mapScriptResultToRun(result);
    closeAutomationRun(deps.db, {
      runId: args.run.id,
      status: mapped.status,
      output: mapped.output,
      exitCode: mapped.exitCode,
      error: mapped.error,
      now: args.now,
    });
    notifyRuns(deps, args.automation.projectId);
  } catch (error) {
    args.onFailure(error);
    notifyRuns(deps, args.automation.projectId);
    deps.logger.error(
      { automationId: args.automation.id, err: error },
      "Failed to run script for automation run",
    );
  }
}
