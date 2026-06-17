import {
  closeAutomationRun,
  listEnvironments,
  setAutomationRunThread,
  type AutomationRow,
  type AutomationRunRow,
} from "@bb/db";
import type { AutomationExecution, EnvironmentArgs } from "@bb/server-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { createThreadFromRequest } from "../threads/thread-create.js";
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

/**
 * Spawn the agent thread for a run and link it to the run row. On spawn failure,
 * invoke `onFailure` (the sweep rolls back the schedule; run-now marks failed).
 * The run row is closed later by the turn-complete hook when the turn settles.
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
  try {
    const thread = await createThreadFromRequest(deps, {
      projectId: args.automation.projectId,
      environment: args.environment,
      input: [{ type: "text", text: args.execution.prompt, mentions: [] }],
      providerId: args.execution.providerId,
      model: args.execution.model,
      permissionMode: args.execution.permissionMode,
      origin: "automation",
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
          BB_AUTOMATION_ID: args.automation.id,
          BB_AUTOMATION_RUN_ID: args.run.id,
          BB_PROJECT_ID: args.automation.projectId,
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
