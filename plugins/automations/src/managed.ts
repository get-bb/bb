import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  closeAutomationRun,
  getAutomation,
  getAutomationRun,
  getRunningAutomationRun,
  listRunningAutomationRuns,
  parseAutomationExecution,
  toAutomationRunResponse,
  type AutomationRunRow,
  type Db,
} from "./data.js";
import {
  managedWorkflowSchema,
  type ManagedCheckpointInput,
  type ManagedWorkflow,
} from "./managed-types.js";
import { publishAutomationChange } from "./realtime.js";

export const managedDispatches = new Set<string>();

export type ManagedApi = Pick<BbPluginApi, "realtime" | "log"> & {
  sdk: {
    threads: {
      get(
        args: Parameters<BbPluginApi["sdk"]["threads"]["get"]>[0],
      ): Promise<unknown>;
      send(
        args: Parameters<BbPluginApi["sdk"]["threads"]["send"]>[0],
      ): Promise<unknown>;
      interactions: { list(args: { threadId: string }): Promise<unknown> };
    };
  };
};
const threadSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    parentThreadId: z.string().nullable(),
    status: z.string(),
    archivedAt: z.number().nullable(),
    deletedAt: z.number().nullable(),
    queuedMessageCount: z.number(),
    activeBackgroundAgentCount: z.number(),
  })
  .passthrough();
const interactionsSchema = z.array(
  z.object({ state: z.string() }).passthrough(),
);

export function workflow(run: AutomationRunRow): ManagedWorkflow | null {
  return run.workflow
    ? managedWorkflowSchema.parse(JSON.parse(run.workflow))
    : null;
}
export function managedDefinition(db: Db, run: AutomationRunRow): boolean {
  const automation = getAutomation(db, run.automationId);
  if (!automation) return false;
  const execution = parseAutomationExecution(automation.execution);
  return execution.mode === "agent" && execution.workflow === "managed";
}
export function initializeManagedRun(db: Db, runId: string): void {
  const run = getAutomationRun(db, runId);
  if (!run || run.finishedAt !== null || run.workflow) return;
  if (!managedDefinition(db, run)) return;
  db.prepare(
    "UPDATE automation_runs SET workflow = ? WHERE id = ? AND workflow IS NULL",
  ).run(
    JSON.stringify({
      revision: 0,
      control: "running",
      waitFor: null,
      wakeAt: null,
      dispatch: null,
      failureObservedAt: null,
      updatedAt: Date.now(),
    } satisfies ManagedWorkflow),
    runId,
  );
}
function changed(
  bb: Pick<BbPluginApi, "realtime">,
  db: Db,
  run: AutomationRunRow,
) {
  const automation = getAutomation(db, run.automationId);
  if (automation)
    publishAutomationChange(bb, automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
}
function save(
  db: Db,
  run: AutomationRunRow,
  value: ManagedWorkflow,
  status: AutomationRunRow["status"],
  summary: string,
): void {
  db.transaction(() => {
    db.prepare(`UPDATE automation_runs SET workflow = ?, status = ?, output = ?
      WHERE id = ? AND finished_at IS NULL`).run(
      JSON.stringify(value),
      status,
      summary,
      run.id,
    );
    db.prepare(`UPDATE automations SET last_run_status = ?, last_error = ?, updated_at = ?
      WHERE id = ?`).run(
      status,
      status === "blocked" ? summary : null,
      Date.now(),
      run.automationId,
    );
  })();
}
export function managedRun(
  db: Db,
  input: { projectId: string; runId: string },
) {
  const run = getAutomationRun(db, input.runId);
  if (
    !run ||
    getAutomation(db, run.automationId)?.projectId !== input.projectId
  )
    throw new Error("Automation run not found in this project");
  return toAutomationRunResponse(run);
}
export async function checkpointManagedRun(
  bb: ManagedApi,
  db: Db,
  input: ManagedCheckpointInput,
) {
  const run = getAutomationRun(db, input.runId);
  if (
    !run ||
    getAutomation(db, run.automationId)?.projectId !== input.projectId
  )
    throw new Error("Automation run not found in this project");
  const current = workflow(run);
  if (!current || run.finishedAt !== null || run.threadId !== input.threadId)
    throw new Error(
      "Only the linked coordinator can checkpoint an unfinished managed run",
    );
  if (current.revision !== input.revision)
    throw new Error("Workflow changed; read the run again");
  if (input.state === "paused" && current.control !== "pause-requested")
    throw new Error(
      "A pause must be explicitly requested before checkpointing it",
    );
  if (
    input.state !== "running" &&
    (input.waitFor !== null || input.wakeAt !== null)
  )
    throw new Error(
      "Only a running checkpoint may wait for a child or deadline",
    );
  if (input.waitFor !== null) {
    const child = threadSchema.parse(
      await bb.sdk.threads.get({ threadId: input.waitFor }),
    );
    if (
      child.parentThreadId !== input.threadId ||
      child.projectId !== input.projectId ||
      child.archivedAt !== null ||
      child.deletedAt !== null
    )
      throw new Error(
        "The wait target must be a live direct child of this coordinator",
      );
  }
  if (
    ["paused", "succeeded", "failed", "skipped"].includes(input.state) &&
    current.waitFor !== null &&
    !(await settled(bb, current.waitFor))
  )
    throw new Error(
      "The current child must become quiescent before settling this run",
    );
  const fresh = getAutomationRun(db, input.runId);
  if (
    !fresh ||
    fresh.finishedAt !== null ||
    workflow(fresh)?.revision !== input.revision
  )
    throw new Error("Workflow changed while validating the checkpoint");
  const value: ManagedWorkflow = {
    ...current,
    revision: current.revision + 1,
    waitFor: input.waitFor,
    wakeAt: input.wakeAt,
    dispatch: null,
    failureObservedAt: null,
    updatedAt: Date.now(),
  };
  if (["succeeded", "failed", "skipped"].includes(input.state)) {
    const status = z
      .enum(["succeeded", "failed", "skipped"])
      .parse(input.state);
    save(db, fresh, value, fresh.status, input.summary);
    closeAutomationRun(db, {
      runId: run.id,
      status,
      output: input.summary,
      ...(status === "failed" ? { error: input.summary } : {}),
      ...(status === "skipped" ? { skipReason: input.summary } : {}),
      now: Date.now(),
    });
  } else {
    save(
      db,
      fresh,
      value,
      input.state === "running" && current.control === "pause-requested"
        ? "pausing"
        : input.state,
      input.summary,
    );
  }
  changed(bb, db, run);
  return managedRun(db, input);
}
export function controlManagedRun(
  bb: Pick<BbPluginApi, "realtime">,
  db: Db,
  automationId: string,
  action: "pause" | "resume",
) {
  const run = getRunningAutomationRun(db, automationId);
  if (!run) return;
  initializeManagedRun(db, run.id);
  const current = workflow(getAutomationRun(db, run.id)!);
  if (!current) return;
  if (action === "resume" && current.dispatch === "pending")
    throw new Error(
      "Continuation acknowledgement is uncertain; reconcile it before resume",
    );
  if (action === "pause" && current.control === "pause-requested") return;
  const value: ManagedWorkflow = {
    ...current,
    revision: current.revision + 1,
    control: action === "pause" ? "pause-requested" : "running",
    updatedAt: Date.now(),
  };
  if (action === "resume") {
    value.waitFor = null;
    value.wakeAt = Date.now();
    value.dispatch = null;
    value.failureObservedAt = null;
  } else if (value.waitFor === null && value.dispatch === null) {
    value.wakeAt = Date.now();
  }
  save(
    db,
    run,
    value,
    action === "pause" ? "pausing" : "recovering",
    action === "pause"
      ? "Pause requested; finishing the current work safely"
      : "Resume requested in the same daily coordinator",
  );
  changed(bb, db, run);
}
export function blockManagedRun(
  bb: Pick<BbPluginApi, "realtime">,
  db: Db,
  run: AutomationRunRow,
  summary: string,
): void {
  initializeManagedRun(db, run.id);
  const value = workflow(getAutomationRun(db, run.id)!);
  if (!value || run.finishedAt !== null) return;
  save(db, run, { ...value, updatedAt: Date.now() }, "blocked", summary);
  changed(bb, db, run);
}
class ManagedBlocker extends Error {}

async function settled(bb: ManagedApi, threadId: string) {
  const thread = threadSchema.parse(await bb.sdk.threads.get({ threadId }));
  if (thread.archivedAt !== null || thread.deletedAt !== null)
    throw new ManagedBlocker(
      `Thread ${threadId} is archived or deleted; recovery is required`,
    );
  if (
    thread.queuedMessageCount !== 0 ||
    thread.activeBackgroundAgentCount !== 0
  )
    return null;
  const interactions = interactionsSchema.parse(
    await bb.sdk.threads.interactions.list({ threadId }),
  );
  if (
    interactions.some(
      (i) => !["resolved", "completed", "cancelled"].includes(i.state),
    )
  )
    return null;
  return ["idle", "error"].includes(thread.status) ? thread : null;
}
export function createManagedSupervisor(bb: ManagedApi, db: Db) {
  const busy = new Set<string>();
  function allowFailureSettlement(
    run: AutomationRunRow,
    value: ManagedWorkflow,
  ) {
    if (value.failureObservedAt === null) {
      save(
        db,
        run,
        { ...value, failureObservedAt: Date.now() },
        "recovering",
        "Waiting for native provider retry reconciliation",
      );
      changed(bb, db, run);
      return false;
    }
    return Date.now() - value.failureObservedAt >= 10_000;
  }
  async function reconcile(runId: string) {
    if (busy.has(runId) || managedDispatches.has(runId)) return;
    busy.add(runId);
    try {
      let run = getAutomationRun(db, runId);
      if (!run || run.finishedAt !== null) return;
      initializeManagedRun(db, runId);
      run = getAutomationRun(db, runId)!;
      const value = workflow(run);
      if (!value || ["paused", "blocked"].includes(run.status)) return;
      if (run.threadId === null) {
        blockManagedRun(
          bb,
          db,
          run,
          "Coordinator launch acknowledgement is uncertain; reconcile the existing launch before continuing",
        );
        return;
      }
      const parent = await settled(bb, run.threadId);
      if (!parent) return;
      if (parent.status === "error") {
        if (!allowFailureSettlement(run, value)) return;
        blockManagedRun(
          bb,
          db,
          run,
          "Coordinator stopped without a queued native retry; explicit recovery is required",
        );
        return;
      }
      if (value.dispatch !== null) {
        blockManagedRun(
          bb,
          db,
          run,
          value.dispatch === "pending"
            ? "Continuation acknowledgement is uncertain; reconcile this coordinator before retrying"
            : "Coordinator stopped without a durable checkpoint; resume after inspecting its result",
        );
        return;
      }
      if (value.waitFor !== null) {
        const child = await settled(bb, value.waitFor);
        if (!child) return;
        if (child.status === "error" && !allowFailureSettlement(run, value))
          return;
      }
      if (
        value.waitFor === null &&
        (value.wakeAt === null || value.wakeAt > Date.now())
      ) {
        if (value.wakeAt === null)
          blockManagedRun(
            bb,
            db,
            run,
            "Coordinator finished without registering its next checkpoint",
          );
        return;
      }
      const fresh = getAutomationRun(db, runId);
      if (
        !fresh ||
        fresh.finishedAt !== null ||
        workflow(fresh)?.revision !== value.revision
      )
        return;
      const sending = {
        ...value,
        dispatch: "pending" as const,
        updatedAt: Date.now(),
      };
      save(
        db,
        fresh,
        sending,
        value.control === "pause-requested" ? "pausing" : "running",
        fresh.output ?? "Continuing daily coordinator",
      );
      changed(bb, db, fresh);
      try {
        const automation = getAutomation(db, run.automationId)!;
        const execution = parseAutomationExecution(automation.execution);
        if (execution.mode !== "agent")
          throw new Error("Managed execution configuration changed");
        await bb.sdk.threads.send({
          threadId: run.threadId,
          mode: "auto",
          model: execution.model,
          reasoningLevel: execution.reasoningLevel,
          permissionMode: execution.permissionMode,
          ...(execution.serviceTier
            ? { serviceTier: execution.serviceTier }
            : {}),
          input: [
            {
              type: "text",
              text: `[bb managed run:${run.id} revision:${value.revision}] Continue the saved workflow using its controller. Read the current run and checkpoint after advancing it. Preserve ownership and pause boundaries.`,
              mentions: [],
            },
          ],
        });
        const after = getAutomationRun(db, runId);
        if (
          after &&
          after.finishedAt === null &&
          workflow(after)?.revision === value.revision
        )
          save(
            db,
            after,
            { ...sending, dispatch: "accepted" },
            after.status,
            after.output ?? "Coordinator resumed",
          );
      } catch (error) {
        const after = getAutomationRun(db, runId);
        if (after && workflow(after)?.revision === value.revision)
          blockManagedRun(
            bb,
            db,
            after,
            `Continuation acknowledgement uncertain: ${String(error)}`,
          );
      }
    } catch (error) {
      const current = getAutomationRun(db, runId);
      if (current && current.finishedAt === null && workflow(current)) {
        if (error instanceof ManagedBlocker)
          blockManagedRun(bb, db, current, error.message);
        else {
          save(
            db,
            current,
            workflow(current)!,
            "recovering",
            `Waiting to reconcile BB state: ${String(error)}`,
          );
          changed(bb, db, current);
        }
      }
      bb.log.warn(
        `Managed run ${runId} reconciliation deferred: ${String(error)}`,
      );
    } finally {
      busy.delete(runId);
    }
  }
  return {
    async sweep() {
      for (const run of listRunningAutomationRuns(db))
        if (run.workflow || managedDefinition(db, run)) await reconcile(run.id);
    },
    async threadSettled(threadId: string) {
      for (const run of listRunningAutomationRuns(db))
        if (run.threadId === threadId || workflow(run)?.waitFor === threadId)
          await reconcile(run.id);
    },
  };
}
