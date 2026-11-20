import {
  PoolAffinityStore,
  QuotaStore,
} from "../../../../plugins/account-pool/src/store.js";
import {
  claimAutomationScheduledRun,
  closeAutomationRun,
  createAutomation,
  createManualRun,
  deleteAutomation,
  disableAutomationsForTargetThread,
  getAutomation,
  getAutomationForProject,
  getRunningAutomationRun,
  listAllAutomations,
  listAutomationRuns,
  listAutomationsForProject,
  listAutomationsTargetingThread,
  listDueAutomations,
  listRunningAutomationRuns,
  listRunningAutomationRunsByThread,
  setAutomationEnabled,
  setAutomationRunThread,
  updateAutomation,
} from "../../../../plugins/automations/src/data.js";
import {
  abandonOriginNotifications,
  activeChildThreadsForRun,
  attachCallThread,
  beginNotificationAttempt,
  cancelRun,
  claimQueuedRun,
  countCallsForRun,
  createRun,
  deleteTerminalRuns,
  getCall,
  getCallByChildThread,
  getLatestRunForOriginThread,
  getRun,
  getRunRequired,
  hasWorker,
  incrementRepairAttempts,
  isWorkerRetired,
  listActiveRunsForOriginThread,
  listCallsForRun,
  listCallsForRunPage,
  listExpiredTerminalRuns,
  listPendingNotificationRuns,
  listRunningCalls,
  listRuns,
  listTimedOutRuns,
  markCallReplayedSameRun,
  markNotificationSent,
  nextMaintenanceDueAt,
  ownWorker,
  queueCallProviderRetry,
  recordNotificationFailure,
  recordWorkerCleanup,
  recoverInterruptedRuns,
  reopenFailedCallOnWorker,
  retiredWorkers,
  settleCall,
  settleNotificationUndeliverable,
  settleRun,
  startCall,
  storeStructuredResult,
  updateRunPhase,
  workerOrigins,
} from "../../../../plugins/workflows/src/data.js";
import { registerCostGroup, type QueryCostCase } from "./case.js";
import {
  POOL_AFFINITY_BINDINGS,
  POOL_AFFINITY_IDLE_TTL_MS,
  seedAccountPool,
  seedAutomations,
  seedWorkflows,
  type AccountPoolSeed,
  type AutomationsSeed,
  type WorkflowsSeed,
} from "./plugin-databases-seed.js";

const ACCOUNT_POOL = "plugins/account-pool/src/store.ts";
const AUTOMATIONS = "plugins/automations/src/data.ts";
const WORKFLOWS = "plugins/workflows/src/data.ts";
const RETENTION_SWEEP_REASON =
  "Known linear cost: the retention sweep walks every retained run (3,000 at full scale) to keep resumed chains whole, once an expired run exists";

let expiredRunIds: string[] = [];
const AUTOMATION_RUNS_PAGE = 50;
const DUE_AUTOMATION_BATCH = 25;
const WORKFLOW_RUNS_PAGE = 50;
const WORKFLOW_CALLS_PAGE = 50;
const WORKFLOW_RETENTION_SWEEP_RUNS = 20;
const WORKFLOW_SWEEP_LIMIT = 100;

const ACCOUNT_POOL_CASES: readonly QueryCostCase<AccountPoolSeed>[] = [
  {
    name: `${ACCOUNT_POOL}#QuotaStore.get`,
    run: (db, _fixture, seed) => new QuotaStore(db.$client).get(seed.accountId),
  },
  {
    name: `${ACCOUNT_POOL}#QuotaStore.get`,
    variant: "unknown account",
    run: (db, _fixture, seed) =>
      new QuotaStore(db.$client).get(seed.missingAccountId),
  },
  {
    name: `${ACCOUNT_POOL}#QuotaStore.put`,
    run: (db, _fixture, seed) => {
      const store = new QuotaStore(db.$client);
      store.put({ ...store.get(seed.accountId), heldUntil: seed.now + 60_000 });
    },
  },
  {
    name: `${ACCOUNT_POOL}#QuotaStore.remove`,
    run: (db, _fixture, seed) =>
      new QuotaStore(db.$client).remove(seed.accountId),
  },
  {
    name: `${ACCOUNT_POOL}#PoolAffinityStore.loadBindings`,
    growsWith: {
      history: `Loads every binding younger than the idle TTL, capped at ${POOL_AFFINITY_BINDINGS} by the hub, and the seed grows the bindings up to that cap`,
    },
    run: (db, _fixture, seed) =>
      new PoolAffinityStore(db.$client).loadBindings(
        seed.now - POOL_AFFINITY_IDLE_TTL_MS,
        POOL_AFFINITY_BINDINGS,
      ),
  },
  {
    name: `${ACCOUNT_POOL}#PoolAffinityStore.loadActiveAccounts`,
    run: (db) => new PoolAffinityStore(db.$client).loadActiveAccounts(),
  },
  {
    name: `${ACCOUNT_POOL}#PoolAffinityStore.putBinding`,
    run: (db, _fixture, seed) =>
      new PoolAffinityStore(db.$client).putBinding(seed.bindingKey, {
        accountId: seed.accountId,
        lastUsedAt: seed.now,
      }),
  },
  {
    name: `${ACCOUNT_POOL}#PoolAffinityStore.removeBinding`,
    run: (db, _fixture, seed) =>
      new PoolAffinityStore(db.$client).removeBinding(seed.bindingKey),
  },
  {
    name: `${ACCOUNT_POOL}#PoolAffinityStore.putActiveAccount`,
    run: (db, _fixture, seed) =>
      new PoolAffinityStore(db.$client).putActiveAccount(
        "claude",
        seed.accountId,
      ),
  },
];

const AUTOMATIONS_CASES: readonly QueryCostCase<AutomationsSeed>[] = [
  {
    name: `${AUTOMATIONS}#createAutomation`,
    run: (db, _fixture, seed) =>
      createAutomation(db.$client, {
        projectId: seed.projectId,
        name: "Weekly dependency review",
        enabled: true,
        trigger: {
          triggerType: "schedule",
          cron: "0 9 * * 1",
          timezone: "UTC",
        },
        runMode: "agent",
        execution: {
          mode: "agent",
          prompt: "Review dependency updates.",
          providerId: "provider-a",
          model: "gpt-5",
          reasoningLevel: "medium",
          permissionMode: "accept-edits",
          environment: { type: "project-default" },
        },
        origin: "human",
        createdByThreadId: null,
        nextRunAt: seed.now + 86_400_000,
      }),
  },
  {
    name: `${AUTOMATIONS}#getAutomation`,
    run: (db, _fixture, seed) => getAutomation(db.$client, seed.automationId),
  },
  {
    name: `${AUTOMATIONS}#getAutomationForProject`,
    run: (db, _fixture, seed) =>
      getAutomationForProject(db.$client, {
        projectId: seed.projectId,
        automationId: seed.automationId,
      }),
  },
  {
    name: `${AUTOMATIONS}#listAutomationsForProject`,
    growsWith: {
      history:
        "Returns every automation in the project by design, and the seed grows the automation count",
    },
    run: (db, _fixture, seed) =>
      listAutomationsForProject(db.$client, seed.projectId),
  },
  {
    name: `${AUTOMATIONS}#listAutomationsTargetingThread`,
    run: (db, _fixture, seed) =>
      listAutomationsTargetingThread(db.$client, seed.targetThreadId),
  },
  {
    name: `${AUTOMATIONS}#listAllAutomations`,
    growsWith: {
      history:
        "Returns every automation by design, and the seed grows the automation count",
    },
    run: (db) => listAllAutomations(db.$client),
  },
  {
    name: `${AUTOMATIONS}#updateAutomation`,
    run: (db, _fixture, seed) =>
      updateAutomation(db.$client, {
        projectId: seed.projectId,
        automationId: seed.automationId,
        patch: { name: "Renamed automation" },
      }),
  },
  {
    name: `${AUTOMATIONS}#setAutomationEnabled`,
    run: (db, _fixture, seed) =>
      setAutomationEnabled(db.$client, {
        projectId: seed.projectId,
        automationId: seed.automationId,
        enabled: false,
        nextRunAt: null,
      }),
  },
  {
    name: `${AUTOMATIONS}#deleteAutomation`,
    run: (db, _fixture, seed) =>
      deleteAutomation(db.$client, {
        projectId: seed.projectId,
        automationId: seed.automationId,
      }),
  },
  {
    name: `${AUTOMATIONS}#listDueAutomations`,
    run: (db, _fixture, seed) =>
      listDueAutomations(db.$client, {
        now: seed.now,
        limit: DUE_AUTOMATION_BATCH,
      }),
  },
  {
    name: `${AUTOMATIONS}#getRunningAutomationRun`,
    run: (db, _fixture, seed) =>
      getRunningAutomationRun(db.$client, seed.automationId),
  },
  {
    name: `${AUTOMATIONS}#claimAutomationScheduledRun`,
    run: (db, _fixture, seed) =>
      claimAutomationScheduledRun(db.$client, {
        automationId: seed.idleAutomation.id,
        expectedNextRunAt: seed.idleAutomation.nextRunAt,
        newNextRunAt: seed.idleAutomation.nextRunAt + 3_600_000,
        now: seed.now,
      }),
  },
  {
    name: `${AUTOMATIONS}#closeAutomationRun`,
    run: (db, _fixture, seed) =>
      closeAutomationRun(db.$client, {
        runId: seed.runningRunId,
        status: "failed",
        error: "Provider overloaded",
        now: seed.now,
      }),
  },
  {
    name: `${AUTOMATIONS}#createManualRun`,
    run: (db, _fixture, seed) =>
      createManualRun(db.$client, {
        automationId: seed.idleAutomation.id,
        runMode: "agent",
        idempotencyKey: seed.idempotency.key,
        now: seed.now,
      }),
  },
  {
    name: `${AUTOMATIONS}#setAutomationRunThread`,
    run: (db, _fixture, seed) =>
      setAutomationRunThread(db.$client, {
        runId: seed.runningRunId,
        threadId: seed.runningRunThreadId,
      }),
  },
  {
    name: `${AUTOMATIONS}#listRunningAutomationRuns`,
    run: (db) => listRunningAutomationRuns(db.$client),
  },
  {
    name: `${AUTOMATIONS}#listRunningAutomationRunsByThread`,
    run: (db, _fixture, seed) =>
      listRunningAutomationRunsByThread(db.$client, seed.runningRunThreadId),
  },
  {
    name: `${AUTOMATIONS}#listAutomationRuns`,
    run: (db, _fixture, seed) =>
      listAutomationRuns(db.$client, {
        automationId: seed.automationId,
        limit: AUTOMATION_RUNS_PAGE,
      }),
  },
  {
    name: `${AUTOMATIONS}#listAutomationRuns`,
    variant: "after a cursor",
    run: (db, _fixture, seed) =>
      listAutomationRuns(db.$client, {
        automationId: seed.automationId,
        limit: AUTOMATION_RUNS_PAGE,
        cursor: seed.cursor,
      }),
  },
  {
    name: `${AUTOMATIONS}#disableAutomationsForTargetThread`,
    run: (db, _fixture, seed) =>
      disableAutomationsForTargetThread(db.$client, {
        threadId: seed.targetThreadId,
        error: "Target thread was archived",
        now: seed.now,
      }),
  },
];

const WORKFLOWS_CASES: readonly QueryCostCase<WorkflowsSeed>[] = [
  {
    name: `${WORKFLOWS}#createRun`,
    run: (db, _fixture, seed) =>
      createRun(db.$client, {
        projectId: seed.projectId,
        originThreadId: seed.originThreadId,
        environmentId: "env_workflow",
        originProvider: "provider-a",
        originModel: "gpt-5",
        originReasoningLevel: "high",
        originPermissionMode: "accept-edits",
        name: "review",
        source: "export const meta = { name: 'review' };",
        sourceHash: "hash-new",
        argsJson: "{}",
        settingsJson:
          '{"maxActiveRuns":4,"maxConcurrentAgents":8,"maxAgentCalls":100,"totalRunTimeoutMs":86400000,"retentionDays":30,"maxNotificationBytes":16384}',
        resumedFromRunId: null,
      }),
  },
  {
    name: `${WORKFLOWS}#getRun`,
    run: (db, _fixture, seed) => getRun(db.$client, seed.runningRunId),
  },
  {
    name: `${WORKFLOWS}#getRunRequired`,
    run: (db, _fixture, seed) => getRunRequired(db.$client, seed.terminalRunId),
  },
  {
    name: `${WORKFLOWS}#getLatestRunForOriginThread`,
    run: (db, _fixture, seed) =>
      getLatestRunForOriginThread(db.$client, seed.originThreadId),
  },
  {
    name: `${WORKFLOWS}#listActiveRunsForOriginThread`,
    run: (db, _fixture, seed) =>
      listActiveRunsForOriginThread(db.$client, seed.originThreadId),
  },
  {
    name: `${WORKFLOWS}#listRuns`,
    run: (db, _fixture, seed) =>
      listRuns(db.$client, {
        projectId: seed.projectId,
        limit: WORKFLOW_RUNS_PAGE,
      }),
  },
  {
    name: `${WORKFLOWS}#claimQueuedRun`,
    run: (db) => claimQueuedRun(db.$client, 8),
  },
  {
    name: `${WORKFLOWS}#settleRun`,
    run: (db, _fixture, seed) =>
      settleRun(db.$client, {
        id: seed.runningRunId,
        status: "failed",
        result: null,
        error: "Workflow threw",
      }),
  },
  {
    name: `${WORKFLOWS}#updateRunPhase`,
    run: (db, _fixture, seed) =>
      updateRunPhase(db.$client, seed.runningRunId, "Verify"),
  },
  {
    name: `${WORKFLOWS}#markNotificationSent`,
    run: (db, _fixture, seed) =>
      markNotificationSent(db.$client, seed.pendingNotificationRunId),
  },
  {
    name: `${WORKFLOWS}#settleNotificationUndeliverable`,
    run: (db, _fixture, seed) =>
      settleNotificationUndeliverable(
        db.$client,
        seed.pendingNotificationRunId,
        "Origin thread is gone",
      ),
  },
  {
    name: `${WORKFLOWS}#recordNotificationFailure`,
    run: (db, _fixture, seed) =>
      recordNotificationFailure(db.$client, {
        id: seed.pendingNotificationRunId,
        error: "Server busy",
        nextAttemptAt: seed.now + 30_000,
      }),
  },
  {
    name: `${WORKFLOWS}#beginNotificationAttempt`,
    run: (db, _fixture, seed) =>
      beginNotificationAttempt(db.$client, seed.pendingNotificationRunId),
  },
  {
    name: `${WORKFLOWS}#recoverInterruptedRuns`,
    run: (db) => recoverInterruptedRuns(db.$client),
  },
  {
    name: `${WORKFLOWS}#getCall`,
    run: (db, _fixture, seed) => getCall(db.$client, seed.runningRunId, 0),
  },
  {
    name: `${WORKFLOWS}#getCallByChildThread`,
    run: (db, _fixture, seed) =>
      getCallByChildThread(db.$client, seed.runningChildThreadId),
  },
  {
    name: `${WORKFLOWS}#listCallsForRun`,
    run: (db, _fixture, seed) => listCallsForRun(db.$client, seed.largestRunId),
  },
  {
    name: `${WORKFLOWS}#listCallsForRunPage`,
    run: (db, _fixture, seed) =>
      listCallsForRunPage(db.$client, {
        runId: seed.largestRunId,
        afterCallIndex: 10,
        limit: WORKFLOW_CALLS_PAGE,
      }),
  },
  {
    name: `${WORKFLOWS}#countCallsForRun`,
    run: (db, _fixture, seed) =>
      countCallsForRun(db.$client, seed.largestRunId),
  },
  {
    name: `${WORKFLOWS}#listRunningCalls`,
    run: (db) => listRunningCalls(db.$client),
  },
  {
    name: `${WORKFLOWS}#listTimedOutRuns`,
    run: (db, _fixture, seed) =>
      listTimedOutRuns(
        db.$client,
        seed.now + 2 * 86_400_000,
        WORKFLOW_SWEEP_LIMIT,
      ),
  },
  {
    name: `${WORKFLOWS}#startCall`,
    run: (db, _fixture, seed) =>
      startCall(db.$client, {
        runId: seed.runningRunId,
        callIndex: seed.nextCallIndex,
        cacheKey: "cache-new",
        prompt: "Review the remaining files.",
        options: {
          selection: null,
          outputSchema: null,
          title: null,
          phase: null,
        },
        selection: {
          providerId: "provider-a",
          model: "gpt-5",
          reasoningLevel: "high",
          permissionMode: "accept-edits",
        },
        replay: null,
      }),
  },
  {
    name: `${WORKFLOWS}#markCallReplayedSameRun`,
    run: (db, _fixture, seed) => {
      const call = getCall(db.$client, seed.largestRunId, 0);
      if (call === null) throw new Error("Expected a call");
      markCallReplayedSameRun(db.$client, call.id);
    },
  },
  {
    name: `${WORKFLOWS}#attachCallThread`,
    run: (db, _fixture, seed) =>
      attachCallThread(db.$client, seed.queuedCallId, "thr_workflow_call_new"),
  },
  {
    name: `${WORKFLOWS}#reopenFailedCallOnWorker`,
    run: (db, _fixture, seed) =>
      reopenFailedCallOnWorker(db.$client, seed.failedCallId),
  },
  {
    name: `${WORKFLOWS}#queueCallProviderRetry`,
    run: (db, _fixture, seed) =>
      queueCallProviderRetry(
        db.$client,
        seed.failedCallId,
        "Provider overloaded",
      ),
  },
  {
    name: `${WORKFLOWS}#storeStructuredResult`,
    run: (db, _fixture, seed) =>
      storeStructuredResult(db.$client, seed.runningCallId, { findings: [] }),
  },
  {
    name: `${WORKFLOWS}#incrementRepairAttempts`,
    run: (db, _fixture, seed) =>
      incrementRepairAttempts(db.$client, seed.runningCallId),
  },
  {
    name: `${WORKFLOWS}#settleCall`,
    run: (db, _fixture, seed) =>
      settleCall(db.$client, {
        id: seed.runningCallId,
        status: "succeeded",
        result: { findings: [] },
        error: null,
      }),
  },
  {
    name: `${WORKFLOWS}#cancelRun`,
    run: (db, _fixture, seed) => cancelRun(db.$client, seed.runningRunId),
  },
  {
    name: `${WORKFLOWS}#activeChildThreadsForRun`,
    run: (db, _fixture, seed) =>
      activeChildThreadsForRun(db.$client, seed.runningRunId),
  },
  {
    name: `${WORKFLOWS}#listPendingNotificationRuns`,
    run: (db, _fixture, seed) =>
      listPendingNotificationRuns(db.$client, seed.now, WORKFLOW_SWEEP_LIMIT),
  },
  {
    name: `${WORKFLOWS}#listExpiredTerminalRuns`,
    growsWith: { history: RETENTION_SWEEP_REASON },
    run: (db, _fixture, seed) =>
      listExpiredTerminalRuns(
        db.$client,
        seed.now,
        WORKFLOW_RETENTION_SWEEP_RUNS,
      ),
  },
  {
    name: `${WORKFLOWS}#deleteTerminalRuns`,
    prepare: (db, _fixture, seed) => {
      expiredRunIds = listExpiredTerminalRuns(
        db.$client,
        seed.now,
        WORKFLOW_RETENTION_SWEEP_RUNS,
      ).runIds;
    },
    run: (db) => deleteTerminalRuns(db.$client, expiredRunIds),
  },
  {
    name: `${WORKFLOWS}#ownWorker`,
    run: (db, _fixture, seed) =>
      ownWorker(
        db.$client,
        "thr_workflow_worker_new",
        seed.runningRunId,
        seed.runningCallId,
        seed.originThreadId,
      ),
  },
  {
    name: `${WORKFLOWS}#workerOrigins`,
    run: (db, _fixture, seed) => workerOrigins(db.$client, seed.now),
  },
  {
    name: `${WORKFLOWS}#retiredWorkers`,
    run: (db, _fixture, seed) => retiredWorkers(db.$client, seed.now),
  },
  {
    name: `${WORKFLOWS}#nextMaintenanceDueAt`,
    run: (db) => nextMaintenanceDueAt(db.$client),
  },
  {
    name: `${WORKFLOWS}#isWorkerRetired`,
    run: (db, _fixture, seed) =>
      isWorkerRetired(db.$client, seed.retiredWorkerThreadId),
  },
  {
    name: `${WORKFLOWS}#recordWorkerCleanup`,
    growsWith: {
      history:
        "Known linear cost: each worker cleanup also deletes archived workers whose run is gone, which scans every archived worker",
    },
    run: (db, _fixture, seed) =>
      recordWorkerCleanup(db.$client, seed.retiredWorkerThreadId, true),
  },
  {
    name: `${WORKFLOWS}#hasWorker`,
    run: (db, _fixture, seed) =>
      hasWorker(db.$client, seed.archivedWorkerThreadId),
  },
  {
    name: `${WORKFLOWS}#abandonOriginNotifications`,
    run: (db, _fixture, seed) =>
      abandonOriginNotifications(db.$client, seed.originThreadId),
  },
];

export const ACCOUNT_POOL_COST_GROUP = registerCostGroup({
  name: "account-pool",
  pluginDatabase: { auditedTables: [], allowedFindings: [] },
  seed: (db, _fixture, scale) => seedAccountPool(db, scale),
  cases: ACCOUNT_POOL_CASES,
});

export const AUTOMATIONS_COST_GROUP = registerCostGroup({
  name: "automations",
  pluginDatabase: {
    auditedTables: ["automation_runs"],
    allowedFindings: [
      {
        rule: "full-scan",
        table: "automation_runs",
        caller: `${AUTOMATIONS}#listRunningAutomationRuns`,
        reason:
          "Scans the partial single-flight index, which holds at most one running row per automation",
      },
    ],
  },
  seed: (db, _fixture, scale) => seedAutomations(db, scale),
  cases: AUTOMATIONS_CASES,
});

export const WORKFLOWS_COST_GROUP = registerCostGroup({
  name: "workflows",
  pluginDatabase: {
    auditedTables: ["workflow_runs", "workflow_calls", "workflow_workers"],
    allowedFindings: [
      ...(["full-scan", "correlated-subquery", "nested-loop"] as const).map(
        (rule) => ({
          rule,
          table: "workflow_runs",
          caller: `${WORKFLOWS}#listExpiredTerminalRuns`,
          reason: RETENTION_SWEEP_REASON,
        }),
      ),
      {
        rule: "full-scan",
        table: "workflow_workers",
        caller: `${WORKFLOWS}#recordWorkerCleanup`,
        reason:
          "Known linear cost: deleting archived workers whose run is gone scans every archived worker",
      },
    ],
  },
  seed: (db, _fixture, scale) => seedWorkflows(db, scale),
  cases: WORKFLOWS_CASES,
});
