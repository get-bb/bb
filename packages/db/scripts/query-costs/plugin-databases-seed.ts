import type Database from "better-sqlite3";
import {
  createAutomation,
  migrations as AUTOMATIONS_MIGRATIONS,
} from "../../../../plugins/automations/src/data.js";
import {
  EMPTY_FAMILY_WEEKLY,
  providerSchema,
} from "../../../../plugins/account-pool/src/contracts.js";
import {
  PoolAffinityStore,
  QUOTA_MIGRATIONS,
  QuotaStore,
} from "../../../../plugins/account-pool/src/store.js";
import { migrations as WORKFLOWS_MIGRATIONS } from "../../../../plugins/workflows/src/data.js";
import type { DbConnection } from "../../src/connection.js";
import { scaled } from "./case.js";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

const POOL_ACCOUNTS = 20;
export const POOL_AFFINITY_BINDINGS = 4_096;
export const POOL_AFFINITY_IDLE_TTL_MS = 65 * MINUTE_MS;

const AUTOMATIONS = 20;
const AUTOMATION_RUNS = 13_000;
const AUTOMATION_PROJECTS = 4;

const WORKFLOW_PROJECTS = 8;
const WORKFLOW_RETAINED_RUNS = 3_000;
const WORKFLOW_RUNS_PER_ORIGIN_THREAD = 10;
const WORKFLOW_CALLS_PER_RUN = 20;
const WORKFLOW_LARGEST_RUN_CALLS = 100;
const WORKFLOW_RUNNING_RUNS = 4;
const WORKFLOW_RUNNING_CALLS_PER_RUN = 8;
const WORKFLOW_QUEUED_RUNS = 6;
const WORKFLOW_EXPIRED_RUNS = 40;
const WORKFLOW_PENDING_NOTIFICATION_RUNS = 6;
const WORKFLOW_UNARCHIVED_RETIRED_RUNS = 5;
const WORKFLOW_RETENTION_DAYS = 30;
const WORKFLOW_SOURCE = `export const meta = { name: "review", description: "Review the change" };\n${"const step = await agent(`Review the diff and report findings`, { label: 'review' });\n".repeat(16)}`;

export interface AccountPoolSeed {
  accountId: string;
  missingAccountId: string;
  bindingKey: string;
  now: number;
}

export interface AutomationsSeed {
  projectId: string;
  automationId: string;
  idleAutomation: { id: string; projectId: string; nextRunAt: number };
  runningRunId: string;
  runningRunThreadId: string;
  targetThreadId: string;
  idempotency: { automationId: string; key: string };
  cursor: { startedAt: number; id: string };
  now: number;
}

export interface WorkflowsSeed {
  projectId: string;
  originThreadId: string;
  runningRunId: string;
  largestRunId: string;
  runningCallId: string;
  runningChildThreadId: string;
  queuedCallId: string;
  failedCallId: string;
  nextCallIndex: number;
  pendingNotificationRunId: string;
  terminalRunId: string;
  retiredWorkerThreadId: string;
  archivedWorkerThreadId: string;
  now: number;
}

function migrateStatements(
  client: Database.Database,
  statements: readonly string[],
): void {
  for (const statement of statements) client.exec(statement);
}

function accountId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

export function seedAccountPool(
  db: DbConnection,
  scale: number,
): AccountPoolSeed {
  const client = db.$client;
  migrateStatements(client, QUOTA_MIGRATIONS);
  const now = Date.now();
  const accounts = scaled(POOL_ACCOUNTS, scale);
  const quotas = new QuotaStore(client);
  const affinity = new PoolAffinityStore(client);
  const bindings = scaled(POOL_AFFINITY_BINDINGS, scale);
  const insertBinding = client.prepare(
    "INSERT INTO pool_affinity (affinity_key, account_id, last_used_at) VALUES (?, ?, ?)",
  );
  client.transaction(() => {
    for (let index = 0; index < accounts; index += 1) {
      quotas.put({
        accountId: accountId(index),
        usageRestriction: null,
        extraUsage: null,
        representativeClaim: index % 2 === 0 ? "five_hour" : null,
        familyWeekly: EMPTY_FAMILY_WEEKLY,
        limitWindows: [
          {
            slot: "primary",
            windowMinutes: 300,
            utilization: (index % 10) / 10,
            resetAt: now + 3_600_000,
            status: "allowed",
            observedAt: now,
            source: "header",
          },
          {
            slot: "secondary",
            windowMinutes: 10_080,
            utilization: (index % 7) / 7,
            resetAt: now + 5 * DAY_MS,
            status: "allowed",
            observedAt: now,
            source: "header",
          },
        ],
        observedAt: now,
        heldUntil: null,
        error: null,
      });
    }
    for (let index = 0; index < bindings; index += 1) {
      insertBinding.run(
        `conversation-${index}`,
        accountId(index % accounts),
        now - Math.floor((index / bindings) * POOL_AFFINITY_IDLE_TTL_MS * 0.9),
      );
    }
    affinity.putActiveAccount("claude", accountId(0));
    affinity.putActiveAccount(providerSchema.options[1], accountId(accounts - 1));
  })();
  return {
    accountId: accountId(0),
    missingAccountId: accountId(accounts + 1),
    bindingKey: `conversation-${bindings - 1}`,
    now,
  };
}

function automationProjectId(index: number): string {
  return `proj_automation_${index % AUTOMATION_PROJECTS}`;
}

export function seedAutomations(
  db: DbConnection,
  scale: number,
): AutomationsSeed {
  const client = db.$client;
  migrateStatements(client, AUTOMATIONS_MIGRATIONS);
  const now = Date.now();
  const automationCount = scaled(AUTOMATIONS, scale);
  const runCount = scaled(AUTOMATION_RUNS, scale);
  const runsPerAutomation = Math.max(1, Math.floor(runCount / automationCount));
  const automationIds: string[] = [];
  const insertRun = client.prepare(
    `INSERT INTO automation_runs (
       id, automation_id, run_mode, thread_id, status, trigger, skip_reason,
       error, output, exit_code, idempotency_key, scheduled_for, started_at,
       finished_at
     ) VALUES (
       @id, @automationId, @runMode, @threadId, @status, @trigger, @skipReason,
       @error, @output, @exitCode, @idempotencyKey, @scheduledFor, @startedAt,
       @finishedAt
     )`,
  );
  let runningRunId = "";
  let runningRunThreadId = "";
  let cursor = { startedAt: 0, id: "" };
  client.transaction(() => {
    for (let index = 0; index < automationCount; index += 1) {
      const script = index % 4 === 3;
      const once = index % 5 === 4;
      const id = `auto_${index.toString().padStart(6, "0")}`;
      automationIds.push(id);
      createAutomation(client, {
        id,
        projectId: automationProjectId(index),
        name: `Nightly ${index}`,
        enabled: index % 6 !== 5,
        trigger: once
          ? { triggerType: "once", runAt: now + (index - 2) * MINUTE_MS }
          : { triggerType: "schedule", cron: "0 * * * *", timezone: "UTC" },
        runMode: script ? "script" : "agent",
        execution: script
          ? {
              mode: "script",
              script: "pnpm test --filter=@bb/db",
              timeoutMs: 600_000,
              workingDirectory: { type: "automation-storage" },
            }
          : {
              mode: "agent",
              prompt:
                "Review yesterday's merged pull requests and report regressions.",
              providerId: "provider-a",
              model: "gpt-5",
              reasoningLevel: "medium",
              permissionMode: "accept-edits",
              environment: { type: "project-default" },
              targetThreadId: `thr_automation_target_${Math.floor(index / 2)}`,
            },
        origin: index % 3 === 0 ? "agent" : "human",
        createdByThreadId: index % 3 === 0 ? `thr_creator_${index}` : null,
        nextRunAt:
          now + (index % 3 === 0 ? -MINUTE_MS : (index + 1) * MINUTE_MS),
      });
      for (let run = 0; run < runsPerAutomation; run += 1) {
        const runIndex = index * runsPerAutomation + run;
        const newest = run === runsPerAutomation - 1;
        const running = newest && index % 2 === 0;
        const startedAt = now - (runsPerAutomation - run) * 3_600_000;
        const status = running
          ? "running"
          : run % 11 === 0
            ? "failed"
            : run % 7 === 0
              ? "skipped"
              : "succeeded";
        const runId = `arun_${runIndex.toString().padStart(8, "0")}`;
        const threadId = script ? null : `thr_automation_run_${runIndex}`;
        const manual = run % 10 === 0;
        insertRun.run({
          id: runId,
          automationId: id,
          runMode: script ? "script" : "agent",
          threadId,
          status,
          trigger: manual ? "manual" : "schedule",
          skipReason:
            status === "skipped" ? "previous run still running" : null,
          error: status === "failed" ? "Provider overloaded" : null,
          output: script ? "All 412 tests passed.\n".repeat(8) : null,
          exitCode: script && status !== "running" ? 0 : null,
          idempotencyKey: manual ? `manual-${runIndex}` : null,
          scheduledFor: startedAt,
          startedAt,
          finishedAt: running ? null : startedAt + 120_000,
        });
        if (running && runningRunId === "" && threadId !== null) {
          runningRunId = runId;
          runningRunThreadId = threadId;
        }
        if (index === 0 && run === Math.floor(runsPerAutomation / 2)) {
          cursor = { startedAt, id: runId };
        }
      }
    }
  })();
  const automationId = automationIds[0];
  const idleIndex = automationIds.findIndex(
    (_id, index) => index % 2 === 1 && index % 3 === 0 && index % 5 !== 4,
  );
  const idleId =
    idleIndex >= 0
      ? automationIds[idleIndex]
      : automationIds[automationCount - 1];
  if (automationId === undefined || idleId === undefined) {
    throw new Error("Expected seeded automations");
  }
  const idle = client
    .prepare(
      "SELECT project_id AS projectId, next_run_at AS nextRunAt FROM automations WHERE id = ?",
    )
    .get(idleId) as { projectId: string; nextRunAt: number };
  client
    .prepare(
      "UPDATE automation_runs SET status = 'succeeded', finished_at = started_at + 1 WHERE automation_id = ? AND status = 'running'",
    )
    .run(idleId);
  client
    .prepare(
      "UPDATE automations SET enabled = 1, trigger_type = 'schedule', trigger_config = ? WHERE id = ?",
    )
    .run(
      JSON.stringify({
        triggerType: "schedule",
        cron: "0 * * * *",
        timezone: "UTC",
      }),
      idleId,
    );
  if (runningRunId === "") {
    runningRunId = `arun_running_${automationId}`;
    runningRunThreadId = `thr_automation_running_${automationId}`;
    insertRun.run({
      id: runningRunId,
      automationId,
      runMode: "agent",
      threadId: runningRunThreadId,
      status: "running",
      trigger: "schedule",
      skipReason: null,
      error: null,
      output: null,
      exitCode: null,
      idempotencyKey: null,
      scheduledFor: now,
      startedAt: now,
      finishedAt: null,
    });
  }
  return {
    projectId: automationProjectId(0),
    automationId,
    idleAutomation: {
      id: idleId,
      projectId: idle.projectId,
      nextRunAt: idle.nextRunAt,
    },
    runningRunId,
    runningRunThreadId,
    targetThreadId: "thr_automation_target_0",
    idempotency: { automationId, key: "manual-new" },
    cursor,
    now,
  };
}

interface SeededRun {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  originThreadId: string;
  projectId: string;
  createdAt: number;
  finishedAt: number | null;
  notificationSent: boolean;
  resumedFromRunId: string | null;
  calls: number;
  workersArchived: boolean;
}

export function seedWorkflows(db: DbConnection, scale: number): WorkflowsSeed {
  const client = db.$client;
  migrateStatements(client, WORKFLOWS_MIGRATIONS);
  const now = Date.now();
  const retained = scaled(WORKFLOW_RETAINED_RUNS, scale);
  const originThreads = Math.max(
    1,
    Math.ceil(retained / WORKFLOW_RUNS_PER_ORIGIN_THREAD),
  );
  const runs: SeededRun[] = [];
  const originOf = (index: number) =>
    `thr_workflow_origin_${index % originThreads}`;
  const projectOf = (index: number) =>
    `proj_workflow_${index % WORKFLOW_PROJECTS}`;
  const retentionSpanMs = (WORKFLOW_RETENTION_DAYS - 1) * DAY_MS;
  for (let index = 0; index < retained; index += 1) {
    const finishedAt =
      now - retentionSpanMs + Math.floor((index / retained) * retentionSpanMs);
    const previous = runs[runs.length - 1];
    runs.push({
      id: `wfr_retained_${index.toString().padStart(6, "0")}`,
      status:
        index % 13 === 0
          ? "failed"
          : index % 17 === 0
            ? "cancelled"
            : "succeeded",
      originThreadId: originOf(index),
      projectId: projectOf(index),
      createdAt: finishedAt - 20 * MINUTE_MS,
      finishedAt,
      notificationSent: true,
      resumedFromRunId:
        index % 10 === 9 && previous !== undefined ? previous.id : null,
      calls: index === 0 ? WORKFLOW_LARGEST_RUN_CALLS : WORKFLOW_CALLS_PER_RUN,
      workersArchived: index < retained - WORKFLOW_UNARCHIVED_RETIRED_RUNS,
    });
  }
  for (let index = 0; index < WORKFLOW_EXPIRED_RUNS; index += 1) {
    const finishedAt =
      now - (WORKFLOW_RETENTION_DAYS + 1) * DAY_MS - index * MINUTE_MS;
    runs.push({
      id: `wfr_expired_${index.toString().padStart(6, "0")}`,
      status: "succeeded",
      originThreadId: originOf(index),
      projectId: projectOf(index),
      createdAt: finishedAt - 20 * MINUTE_MS,
      finishedAt,
      notificationSent: true,
      resumedFromRunId: null,
      calls: WORKFLOW_CALLS_PER_RUN,
      workersArchived: true,
    });
  }
  for (let index = 0; index < WORKFLOW_PENDING_NOTIFICATION_RUNS; index += 1) {
    runs.push({
      id: `wfr_pending_${index}`,
      status: "succeeded",
      originThreadId: originOf(index),
      projectId: projectOf(index),
      createdAt: now - 30 * MINUTE_MS,
      finishedAt: now - 5 * MINUTE_MS + index,
      notificationSent: false,
      resumedFromRunId: null,
      calls: WORKFLOW_CALLS_PER_RUN,
      workersArchived: false,
    });
  }
  for (let index = 0; index < WORKFLOW_RUNNING_RUNS; index += 1) {
    runs.push({
      id: `wfr_running_${index}`,
      status: "running",
      originThreadId: originOf(0),
      projectId: projectOf(0),
      createdAt: now - 10 * MINUTE_MS + index,
      finishedAt: null,
      notificationSent: false,
      resumedFromRunId: null,
      calls: WORKFLOW_CALLS_PER_RUN,
      workersArchived: false,
    });
  }
  for (let index = 0; index < WORKFLOW_QUEUED_RUNS; index += 1) {
    runs.push({
      id: `wfr_queued_${index}`,
      status: "queued",
      originThreadId: originOf(index + 1),
      projectId: projectOf(index + 1),
      createdAt: now - MINUTE_MS + index,
      finishedAt: null,
      notificationSent: false,
      resumedFromRunId: null,
      calls: 0,
      workersArchived: false,
    });
  }
  const insertRun = client.prepare(
    `INSERT INTO workflow_runs (
       id, project_id, origin_thread_id, environment_id, origin_provider,
       origin_model, origin_reasoning_level, origin_permission_mode, name,
       source, source_hash, args_json, status, resumed_from_run_id,
       result_json, error, phase, notification_sent, notification_outcome,
       replay_safety_version, created_at, started_at, finished_at
     ) VALUES (
       @id, @projectId, @originThreadId, 'env_workflow', 'provider-a', 'gpt-5',
       'high', 'accept-edits', 'review', @source, @sourceHash, '{"pr":42}',
       @status, @resumedFromRunId, @resultJson, @error, @phase,
       @notificationSent, @notificationOutcome, 1, @createdAt, @startedAt,
       @finishedAt
     )`,
  );
  const insertCall = client.prepare(
    `INSERT INTO workflow_calls (
       id, run_id, call_index, cache_key, prompt, options_json,
       resolved_provider, resolved_model, resolved_reasoning_level,
       resolved_permission_mode, status, child_thread_id, result_json, error,
       created_at, started_at, last_activity_at, finished_at
     ) VALUES (
       @id, @runId, @callIndex, @cacheKey, @prompt, @optionsJson, 'provider-a',
       'gpt-5', 'high', 'accept-edits', @status, @childThreadId, @resultJson,
       @error, @createdAt, @startedAt, @lastActivityAt, @finishedAt
     )`,
  );
  const insertWorker = client.prepare(
    `INSERT INTO workflow_workers (
       thread_id, run_id, call_id, origin_thread_id, archived_at, next_cleanup_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const prompt = `Review the files changed in pull request 42 for correctness bugs. ${"Report each finding with the file, line and a failing scenario. ".repeat(6)}`;
  const resultJson = JSON.stringify({
    findings: [{ file: "src/a.ts", line: 12, summary: "Stale cache read" }],
  });
  let callCounter = 0;
  let runningCallId = "";
  let runningChildThreadId = "";
  let queuedCallId = "";
  let failedCallId = "";
  let retiredWorkerThreadId = "";
  let archivedWorkerThreadId = "";
  client.transaction(() => {
    for (const run of runs) {
      const terminal = run.status !== "queued" && run.status !== "running";
      insertRun.run({
        id: run.id,
        projectId: run.projectId,
        originThreadId: run.originThreadId,
        source: WORKFLOW_SOURCE,
        sourceHash: `hash-${run.id}`,
        status: run.status,
        resumedFromRunId: run.resumedFromRunId,
        resultJson: run.status === "succeeded" ? resultJson : null,
        error: run.status === "failed" ? "Agent call failed" : null,
        phase: run.status === "running" ? "Review" : null,
        notificationSent: run.notificationSent ? 1 : 0,
        notificationOutcome: run.notificationSent ? "delivered" : "pending",
        createdAt: run.createdAt,
        startedAt: run.status === "queued" ? null : run.createdAt + 1_000,
        finishedAt: run.finishedAt,
      });
      for (let callIndex = 0; callIndex < run.calls; callIndex += 1) {
        callCounter += 1;
        const id = `wfc_${callCounter.toString().padStart(8, "0")}`;
        const running = run.status === "running";
        const status = running
          ? callIndex < WORKFLOW_RUNNING_CALLS_PER_RUN
            ? "running"
            : callIndex === WORKFLOW_RUNNING_CALLS_PER_RUN
              ? "failed"
              : callIndex < WORKFLOW_CALLS_PER_RUN - 2
                ? "succeeded"
                : "queued"
          : run.status === "cancelled" && callIndex > 10
            ? "cancelled"
            : "succeeded";
        const childThreadId =
          status === "queued" || status === "cancelled"
            ? null
            : `thr_workflow_call_${callCounter}`;
        const startedAt = run.createdAt + 2_000 + callIndex * 1_000;
        insertCall.run({
          id,
          runId: run.id,
          callIndex,
          cacheKey: `cache-${run.id}-${callIndex}`,
          prompt,
          optionsJson: JSON.stringify({
            selection: null,
            outputSchema: null,
            title: `Review shard ${callIndex}`,
            phase: "Review",
          }),
          status,
          childThreadId,
          resultJson: status === "succeeded" ? resultJson : null,
          error: status === "failed" ? "Provider overloaded" : null,
          createdAt: startedAt,
          startedAt: status === "queued" ? null : startedAt,
          lastActivityAt: status === "running" ? now - callIndex * 1_000 : null,
          finishedAt:
            status === "running" || status === "queued"
              ? null
              : (run.finishedAt ?? now) - 1_000,
        });
        if (childThreadId !== null) {
          const archivedAt =
            terminal && run.workersArchived
              ? (run.finishedAt ?? now) + MINUTE_MS
              : null;
          insertWorker.run(
            childThreadId,
            run.id,
            id,
            run.originThreadId,
            archivedAt,
            archivedAt === null && terminal ? now - 1_000 : now + DAY_MS,
          );
          if (archivedAt !== null && archivedWorkerThreadId === "") {
            archivedWorkerThreadId = childThreadId;
          }
          if (archivedAt === null && terminal && retiredWorkerThreadId === "") {
            retiredWorkerThreadId = childThreadId;
          }
        }
        if (run.id === "wfr_running_0") {
          if (status === "running" && runningCallId === "") {
            runningCallId = id;
            runningChildThreadId = childThreadId ?? "";
          }
          if (status === "queued" && queuedCallId === "") queuedCallId = id;
          if (status === "failed") failedCallId = id;
        }
      }
    }
  })();
  return {
    projectId: projectOf(0),
    originThreadId: originOf(0),
    runningRunId: "wfr_running_0",
    largestRunId: "wfr_retained_000000",
    runningCallId,
    runningChildThreadId,
    queuedCallId,
    failedCallId,
    nextCallIndex: WORKFLOW_CALLS_PER_RUN,
    pendingNotificationRunId: "wfr_pending_0",
    terminalRunId: `wfr_retained_${(retained - 1).toString().padStart(6, "0")}`,
    retiredWorkerThreadId,
    archivedWorkerThreadId,
    now,
  };
}
