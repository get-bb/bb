import type { BbPluginApi } from "@bb/plugin-sdk";
import {
  closeAutomationRun,
  disableAutomationsForDeletedThread,
  getAutomation,
  getRunningAutomationRunByThread,
  markAutomationThread,
  setAutomationRunThread,
  type AutomationRow,
  type AutomationRunRow,
  type Db,
} from "./data.js";
import { publishAutomationChange } from "./realtime.js";
import { executeStoredScript, mapScriptResultToRun } from "./script-runner.js";
import type { AutomationExecution } from "./rpc-types.js";

export type RunFailureHandler = (error: unknown) => void;

interface ThreadLike {
  id: string;
  projectId?: string;
  status?: string;
  archivedAt?: number | null;
  deletedAt?: number | null;
}

function threadIdFromResult(result: unknown): string {
  const direct = (result as { id?: unknown }).id;
  if (typeof direct === "string") return direct;
  const nested = (result as { thread?: { id?: unknown } }).thread?.id;
  if (typeof nested === "string") return nested;
  throw new Error("Thread spawn response did not include a thread id");
}

function renderAutomationDueMessage(args: {
  automationId: string;
  prompt: string;
}): string {
  return `[bb automation due:${args.automationId}]\n\n${args.prompt}`;
}

function isThreadReusable(thread: ThreadLike): boolean {
  return (
    thread.deletedAt === null &&
    thread.archivedAt === null &&
    (thread.status === "idle" || thread.status === "active")
  );
}

export async function executeAgentRun(
  bb: Pick<BbPluginApi, "sdk" | "realtime" | "log">,
  db: Db,
  args: {
    automation: AutomationRow;
    run: AutomationRunRow;
    execution: Extract<AutomationExecution, { mode: "agent" }>;
    onFailure: RunFailureHandler;
  },
): Promise<void> {
  if (args.automation.targetThreadId !== null) {
    await reuseTargetThreadForRun(bb, db, args);
    return;
  }
  try {
    const thread = await bb.sdk.threads.spawn({
      projectId: args.automation.projectId,
      environment: args.execution.environment,
      prompt: args.execution.prompt,
      title: args.automation.name,
      providerId: args.execution.providerId,
      model: args.execution.model,
      permissionMode: args.execution.permissionMode,
    });
    const threadId = threadIdFromResult(thread);
    setAutomationRunThread(db, { runId: args.run.id, threadId });
    markAutomationThread(db, {
      automationId: args.automation.id,
      runId: args.run.id,
      threadId,
      now: Date.now(),
    });
    publishAutomationChange(bb, args.automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
  } catch (error) {
    args.onFailure(error);
    publishAutomationChange(bb, args.automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
    bb.log.error(
      `Failed to spawn thread for automation ${args.automation.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function reuseTargetThreadForRun(
  bb: Pick<BbPluginApi, "sdk" | "realtime" | "log">,
  db: Db,
  args: {
    automation: AutomationRow;
    run: AutomationRunRow;
    execution: Extract<AutomationExecution, { mode: "agent" }>;
    onFailure: RunFailureHandler;
  },
): Promise<void> {
  const targetThreadId = args.automation.targetThreadId;
  if (targetThreadId === null) return;

  let thread: ThreadLike;
  try {
    thread = (await bb.sdk.threads.get({ threadId: targetThreadId })) as ThreadLike;
  } catch (error) {
    disableAutomationsForDeletedThread(db, {
      threadId: targetThreadId,
      now: Date.now(),
    });
    args.onFailure(
      new Error(
        `Target thread ${targetThreadId} is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );
    publishAutomationChange(bb, args.automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
    return;
  }

  if (!isThreadReusable(thread)) {
    disableAutomationsForDeletedThread(db, {
      threadId: targetThreadId,
      now: Date.now(),
    });
    args.onFailure(
      new Error(
        `Target thread ${targetThreadId} is unavailable (missing, deleted, archived, or not runnable)`,
      ),
    );
    publishAutomationChange(bb, args.automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
    return;
  }

  try {
    setAutomationRunThread(db, {
      runId: args.run.id,
      threadId: targetThreadId,
    });
    markAutomationThread(db, {
      automationId: args.automation.id,
      runId: args.run.id,
      threadId: targetThreadId,
      now: Date.now(),
    });
    await bb.sdk.threads.send({
      threadId: targetThreadId,
      mode: "steer-if-active",
      input: [
        {
          type: "text",
          text: renderAutomationDueMessage({
            automationId: args.automation.id,
            prompt: args.execution.prompt,
          }),
          mentions: [],
        },
      ],
      permissionMode: args.execution.permissionMode,
    });
    publishAutomationChange(bb, args.automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
  } catch (error) {
    args.onFailure(error);
    publishAutomationChange(bb, args.automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
    bb.log.error(
      `Failed to re-prompt target thread ${targetThreadId} for automation ${
        args.automation.id
      }: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function executeScriptRun(
  bb: Pick<BbPluginApi, "realtime" | "log">,
  db: Db,
  args: {
    pluginDataDir: string;
    automation: AutomationRow;
    run: AutomationRunRow;
    execution: Extract<AutomationExecution, { mode: "script" }>;
    onFailure: RunFailureHandler;
    now: number;
    serverUrl: string;
  },
): Promise<void> {
  const scriptFile = args.execution.scriptFile;
  if (scriptFile === undefined) {
    closeAutomationRun(db, {
      runId: args.run.id,
      status: "failed",
      error: "Script automation is missing a stored script file",
      now: args.now,
    });
    publishAutomationChange(bb, args.automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
    return;
  }

  try {
    const result = await executeStoredScript({
      pluginDataDir: args.pluginDataDir,
      automationId: args.automation.id,
      runId: args.run.id,
      projectId: args.automation.projectId,
      scriptFile,
      interpreter: args.execution.interpreter,
      timeoutMs: args.execution.timeoutMs,
      env: args.execution.env,
      serverUrl: args.serverUrl,
    });
    const mapped = mapScriptResultToRun(result);
    closeAutomationRun(db, {
      runId: args.run.id,
      status: mapped.status,
      skipReason: mapped.skipReason,
      output: mapped.output,
      exitCode: mapped.exitCode,
      error: mapped.error,
      now: args.now,
    });
    publishAutomationChange(bb, args.automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
  } catch (error) {
    args.onFailure(error);
    publishAutomationChange(bb, args.automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
    bb.log.error(
      `Failed to run script for automation ${args.automation.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function closeAutomationRunForSettledThread(
  bb: Pick<BbPluginApi, "realtime">,
  db: Db,
  args: { threadId: string; status: "idle" | "failed"; error?: string | null },
): void {
  const run = getRunningAutomationRunByThread(db, args.threadId);
  if (!run) return;
  const closed = closeAutomationRun(db, {
    runId: run.id,
    status: args.status === "idle" ? "succeeded" : "failed",
    error: args.status === "idle" ? null : (args.error ?? "Turn failed"),
    threadId: args.threadId,
    now: Date.now(),
  });
  if (!closed) return;
  const automation = getAutomation(db, closed.automationId);
  if (automation) {
    publishAutomationChange(bb, automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
  }
}

export function disableAutomationsForDeletedThreadEvent(
  bb: Pick<BbPluginApi, "realtime">,
  db: Db,
  threadId: string,
): void {
  const disabled = disableAutomationsForDeletedThread(db, {
    threadId,
    now: Date.now(),
  });
  for (const automation of disabled) {
    publishAutomationChange(bb, automation.projectId, "automations-changed");
  }
}
