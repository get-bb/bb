import {
  experimental_BbHttpError,
  type BbPluginApi,
  type PluginThreadSettledEvent,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  closeAutomationRun,
  disableAutomationsForTargetThread,
  getAutomation,
  listRunningAutomationRuns,
  listRunningAutomationRunsByThread,
  setAutomationEnabled,
  setAutomationRunThread,
  type AutomationRow,
  type AutomationRunRow,
  type Db,
} from "./data.js";
import { publishAutomationChange } from "./realtime.js";
import {
  executeStoredScript,
  mapScriptResultToRun,
  type ScriptRunScope,
} from "./script-runner.js";
import type { AutomationExecution } from "./rpc-types.js";
import type {
  ProjectsSdk,
  ScriptWorkingDirectoryResolver,
} from "./working-directory.js";

type RunFailureHandler = (error: unknown) => void;
type AgentThreadsSdk = {
  get(
    args: Parameters<BbPluginApi["sdk"]["threads"]["get"]>[0],
  ): Promise<unknown>;
  send(
    args: Parameters<BbPluginApi["sdk"]["threads"]["send"]>[0],
  ): Promise<unknown>;
  spawn(
    args: Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0],
  ): Promise<unknown>;
};
export type AgentRunApi = Pick<BbPluginApi, "realtime" | "log"> & {
  sdk: { threads: AgentThreadsSdk };
};
export type ReconcileApi = Pick<BbPluginApi, "realtime" | "log"> & {
  sdk: {
    threads: AgentThreadsSdk & {
      queue: {
        list(
          args: Parameters<BbPluginApi["sdk"]["threads"]["queue"]["list"]>[0],
        ): Promise<unknown[]>;
      };
    };
  };
};
export type ScriptRunApi = Pick<BbPluginApi, "realtime" | "log"> & {
  sdk: { projects: ProjectsSdk };
  server: Pick<
    BbPluginApi["server"],
    "loopbackBaseUrl" | "experimental_dataDir"
  >;
};

const sdkThreadSchema = z
  .object({
    id: z.string(),
    archivedAt: z.number().nullable(),
    deletedAt: z.number().nullable(),
    status: z.enum([
      "pending",
      "idle",
      "active",
      "starting",
      "stopping",
      "error",
    ]),
  })
  .passthrough();
type SdkThread = z.infer<typeof sdkThreadSchema>;

function isThreadGoneError(error: unknown): boolean {
  return error instanceof experimental_BbHttpError && error.status === 404;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isProjectGoneError(error: unknown): boolean {
  return (
    error instanceof experimental_BbHttpError &&
    error.status === 404 &&
    (error.code === "project_not_found" || error.code === "project_unavailable")
  );
}

function renderAutomationDueMessage(args: {
  automationId: string;
  prompt: string;
}): string {
  return `[bb automation due:${args.automationId}]\n\n${args.prompt}`;
}

function unusableThreadReason(thread: SdkThread): string | null {
  if (thread.deletedAt !== null) return "was deleted";
  if (thread.archivedAt !== null) return "was archived";
  switch (thread.status) {
    case "idle":
    case "active":
    case "error":
      return null;
    case "pending":
    case "starting":
    case "stopping":
      return `is ${thread.status}`;
  }
}

interface AgentRunArgs {
  automation: AutomationRow;
  run: AutomationRunRow;
  execution: Extract<AutomationExecution, { mode: "agent" }>;
  onFailure: RunFailureHandler;
}

export async function executeAgentRun(
  bb: AgentRunApi,
  db: Db,
  args: AgentRunArgs,
): Promise<void> {
  try {
    if (args.automation.targetThreadId !== null) {
      await reuseTargetThreadForRun(bb, db, {
        ...args,
        targetThreadId: args.automation.targetThreadId,
      });
      return;
    }
    const thread = sdkThreadSchema.parse(
      await bb.sdk.threads.spawn({
        projectId: args.automation.projectId,
        environment: args.execution.environment,
        prompt: renderAutomationDueMessage({
          automationId: args.automation.id,
          prompt: args.execution.prompt,
        }),
        title: args.automation.name,
        providerId: args.execution.providerId,
        model: args.execution.model,
        reasoningLevel: args.execution.reasoningLevel,
        ...(args.execution.serviceTier === undefined
          ? {}
          : { serviceTier: args.execution.serviceTier }),
        permissionMode: args.execution.permissionMode,
      }),
    );
    setAutomationRunThread(db, { runId: args.run.id, threadId: thread.id });
  } catch (error) {
    settleDispatchFailure(bb, db, args, error);
  } finally {
    publishAutomationChange(bb, args.automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
  }
}

function settleDispatchFailure(
  bb: Pick<BbPluginApi, "log">,
  db: Db,
  args: AgentRunArgs,
  error: unknown,
): void {
  const message = errorMessage(error);
  if (isProjectGoneError(error)) {
    setAutomationEnabled(db, {
      projectId: args.automation.projectId,
      automationId: args.automation.id,
      enabled: false,
      nextRunAt: null,
      lastError: message,
    });
    closeAutomationRun(db, {
      runId: args.run.id,
      status: "failed",
      error: message,
      now: Date.now(),
    });
  } else {
    args.onFailure(error);
  }
  bb.log.error(
    `Failed to dispatch automation ${args.automation.id}: ${message}`,
  );
}

async function reuseTargetThreadForRun(
  bb: AgentRunApi,
  db: Db,
  args: AgentRunArgs & { targetThreadId: string },
): Promise<void> {
  let thread: SdkThread;
  try {
    thread = sdkThreadSchema.parse(
      await bb.sdk.threads.get({ threadId: args.targetThreadId }),
    );
  } catch (error) {
    if (!isThreadGoneError(error)) throw error;
    closeRunForUnusableTargetThread(bb, db, {
      ...args,
      reason: "no longer exists",
    });
    return;
  }

  const unusableReason = unusableThreadReason(thread);
  if (unusableReason !== null) {
    closeRunForUnusableTargetThread(bb, db, {
      ...args,
      reason: unusableReason,
    });
    return;
  }

  setAutomationRunThread(db, {
    runId: args.run.id,
    threadId: args.targetThreadId,
  });
  await bb.sdk.threads.send({
    threadId: args.targetThreadId,
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
}

function closeRunForUnusableTargetThread(
  bb: Pick<BbPluginApi, "log">,
  db: Db,
  args: AgentRunArgs & { targetThreadId: string; reason: string },
): void {
  const now = Date.now();
  const error = `Target thread ${args.targetThreadId} ${args.reason}`;
  disableAutomationsForTargetThread(db, {
    threadId: args.targetThreadId,
    error,
    now,
  });
  closeAutomationRun(db, {
    runId: args.run.id,
    status: "failed",
    error,
    now,
  });
  bb.log.error(`Automation ${args.automation.id} paused: ${error}`);
}

interface ScriptRunArgs {
  pluginDataDir: string;
  automation: AutomationRow;
  run: AutomationRunRow;
  execution: Extract<AutomationExecution, { mode: "script" }>;
  onFailure: RunFailureHandler;
  resolveWorkingDirectory: ScriptWorkingDirectoryResolver;
  scriptRuns: ScriptRunScope;
}

export function executeScriptRun(
  bb: ScriptRunApi,
  db: Db,
  args: ScriptRunArgs,
): Promise<void> {
  return args.scriptRuns.track(runScript(bb, db, args));
}

async function runScript(
  bb: ScriptRunApi,
  db: Db,
  args: ScriptRunArgs,
): Promise<void> {
  try {
    const scriptFile = args.execution.scriptFile;
    if (scriptFile === undefined) {
      closeAutomationRun(db, {
        runId: args.run.id,
        status: "failed",
        error: "Script automation is missing a stored script file",
        now: Date.now(),
      });
      return;
    }
    const workingDir = await args.resolveWorkingDirectory(
      args.automation.projectId,
      args.execution.workingDirectory,
    );
    if (workingDir === null) {
      throw new Error(
        `Project ${args.automation.projectId} has no source on the bb server host`,
      );
    }
    const result = await executeStoredScript({
      pluginDataDir: args.pluginDataDir,
      automationId: args.automation.id,
      runId: args.run.id,
      projectId: args.automation.projectId,
      scriptFile,
      interpreter: args.execution.interpreter,
      timeoutMs: args.execution.timeoutMs,
      env: args.execution.env,
      serverUrl: bb.server.loopbackBaseUrl,
      serverDataDir: bb.server.experimental_dataDir,
      workingDir,
      signal: args.scriptRuns.signal,
    });
    const mapped = mapScriptResultToRun(result);
    closeAutomationRun(db, {
      runId: args.run.id,
      status: mapped.status,
      skipReason: mapped.skipReason,
      output: mapped.output,
      exitCode: mapped.exitCode,
      error: mapped.error,
      now: Date.now(),
    });
  } catch (error) {
    args.onFailure(error);
    bb.log.error(
      `Failed to run script for automation ${args.automation.id}: ${errorMessage(error)}`,
    );
  } finally {
    publishAutomationChange(bb, args.automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
  }
}

function settledRunOutcome(
  pluginId: string,
  event: PluginThreadSettledEvent,
): ReconcileOutcome | null {
  const threadId = event.thread.id;
  switch (event.outcome) {
    case "completed":
      return { status: "succeeded" };
    case "failed":
      return { status: "failed", error: event.error ?? "Turn failed" };
    case "cancelled":
      return event.entry.originPluginId === pluginId
        ? {
            status: "skipped",
            skipReason: "cancelled: its message was deleted before it ran",
          }
        : null;
    case "archived":
      return {
        status: "skipped",
        skipReason: `interrupted: thread ${threadId} was archived`,
      };
    case "deleted":
      return {
        status: "skipped",
        skipReason: `interrupted: thread ${threadId} was deleted`,
      };
  }
}

export function settleAutomationRunsForThread(
  bb: Pick<BbPluginApi, "realtime" | "pluginId">,
  db: Db,
  event: PluginThreadSettledEvent,
): void {
  if (event.outcome === "deleted") {
    disableAutomationsForDeletedThreadEvent(bb, db, event.thread.id);
  }
  const outcome = settledRunOutcome(bb.pluginId, event);
  if (outcome === null) return;
  const threadId = event.thread.id;
  const runs = listRunningAutomationRunsByThread(db, threadId);
  const now = Date.now();
  const changedProjects = new Set<string>();
  for (const run of runs) {
    const closed = closeAutomationRun(db, {
      runId: run.id,
      ...outcome,
      threadId,
      now,
    });
    if (!closed) continue;
    const automation = getAutomation(db, closed.automationId);
    if (automation) changedProjects.add(automation.projectId);
  }
  for (const projectId of changedProjects) {
    publishAutomationChange(bb, projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
  }
}

type ReconcileOutcome =
  | { status: "succeeded" }
  | { status: "failed"; error: string }
  | { status: "skipped"; skipReason: string };

export async function reconcileRunningAutomationRuns(
  bb: ReconcileApi,
  db: Db,
  runIds: ReadonlySet<string>,
): Promise<Set<string>> {
  const changedProjects = new Set<string>();
  const unchecked = new Set<string>();
  for (const run of listRunningAutomationRuns(db)) {
    if (!runIds.has(run.id)) continue;
    const outcome = await reconcileOutcome(bb, run);
    if (outcome === "unchecked") {
      unchecked.add(run.id);
      continue;
    }
    if (outcome === null) continue;
    const closed = closeAutomationRun(db, {
      runId: run.id,
      ...outcome,
      now: Date.now(),
    });
    if (!closed) continue;
    const automation = getAutomation(db, closed.automationId);
    if (automation) changedProjects.add(automation.projectId);
    bb.log.info(
      `Automation run ${run.id} settled as ${outcome.status} on startup: ${
        outcome.status === "succeeded"
          ? "its thread is idle"
          : outcome.status === "failed"
            ? outcome.error
            : outcome.skipReason
      }`,
    );
  }
  for (const projectId of changedProjects) {
    publishAutomationChange(bb, projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
  }
  return unchecked;
}

async function reconcileOutcome(
  bb: ReconcileApi,
  run: AutomationRunRow,
): Promise<ReconcileOutcome | "unchecked" | null> {
  if (run.runMode === "script") {
    return {
      status: "skipped",
      skipReason:
        "interrupted: the server restarted while the script was running",
    };
  }
  if (run.threadId === null) {
    return {
      status: "skipped",
      skipReason:
        "interrupted: the server restarted before a thread was attached",
    };
  }
  let thread: SdkThread;
  try {
    thread = sdkThreadSchema.parse(
      await bb.sdk.threads.get({ threadId: run.threadId }),
    );
  } catch (error) {
    if (isThreadGoneError(error)) {
      return {
        status: "skipped",
        skipReason: `interrupted: thread ${run.threadId} no longer exists`,
      };
    }
    bb.log.warn(
      `Could not check thread ${run.threadId} for running automation run ${run.id}; checking again on the next sweep: ${errorMessage(error)}`,
    );
    return "unchecked";
  }
  if (thread.deletedAt !== null || thread.archivedAt !== null) {
    return {
      status: "skipped",
      skipReason: `interrupted: thread ${run.threadId} was ${
        thread.deletedAt !== null ? "deleted" : "archived"
      }`,
    };
  }
  switch (thread.status) {
    case "idle":
      return { status: "succeeded" };
    case "error":
      return {
        status: "failed",
        error: "Turn failed while the automations plugin was not running",
      };
    case "pending":
      return pendingThreadOutcome(bb, run, run.threadId);
    case "starting":
    case "active":
    case "stopping":
      return null;
  }
}

async function pendingThreadOutcome(
  bb: ReconcileApi,
  run: AutomationRunRow,
  threadId: string,
): Promise<ReconcileOutcome | "unchecked" | null> {
  let queued: unknown[];
  try {
    queued = await bb.sdk.threads.queue.list({ threadId });
  } catch (error) {
    bb.log.warn(
      `Could not list queued messages of thread ${threadId} for running automation run ${run.id}; checking again on the next sweep: ${errorMessage(error)}`,
    );
    return "unchecked";
  }
  if (queued.length > 0) return null;
  return {
    status: "skipped",
    skipReason: `cancelled: thread ${threadId} has no message left to run`,
  };
}

export function disableAutomationsForDeletedThreadEvent(
  bb: Pick<BbPluginApi, "realtime">,
  db: Db,
  threadId: string,
): void {
  const disabled = disableAutomationsForTargetThread(db, {
    threadId,
    error: `Target thread ${threadId} was deleted`,
    now: Date.now(),
  });
  for (const automation of disabled) {
    publishAutomationChange(bb, automation.projectId, "automations-changed");
  }
}
