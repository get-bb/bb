import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachCallThread,
  isWorkerRetired,
  retiredWorkers,
  recordWorkerCleanup,
  workerOrigins,
  ownWorker,
  cancelRun,
  countCallsForRun,
  createRun,
  deleteTerminalRuns,
  getCall,
  getRunRequired,
  incrementRepairAttempts,
  listCallsForRunPage,
  listExpiredTerminalRuns,
  migrations,
  queueCallProviderRetry,
  recoverInterruptedRuns,
  settleCall,
  settleRun,
  startCall,
  storeStructuredResult,
} from "./data.js";

describe("workflow durable data", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(migrations.join("\n"));
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  function sweepExpired(now: number, limit: number): number {
    return deleteTerminalRuns(
      db,
      listExpiredTerminalRuns(db, now, limit).runIds,
    );
  }

  function newRun() {
    return createRun(db, {
      projectId: "project-1",
      originThreadId: "thread-1",
      environmentId: "environment-1",
      originProvider: "codex",
      originModel: "gpt-test",
      originReasoningLevel: "medium",
      originPermissionMode: "full",
      name: "test-workflow",
      source: "return null",
      sourceHash: "hash",
      argsJson: "null",
      settingsJson:
        '{"maxActiveRuns":4,"maxConcurrentAgents":8,"maxAgentCalls":100,"totalRunTimeoutMs":86400000,"retentionDays":30,"maxNotificationBytes":16384}',
      resumedFromRunId: null,
    });
  }

  function markRunning(runId: string): void {
    db.prepare(`UPDATE workflow_runs SET status = 'running' WHERE id = ?`).run(
      runId,
    );
  }

  const resolvedSelection = {
    providerId: "codex",
    model: "gpt-test",
    reasoningLevel: "medium",
    permissionMode: "full",
  } as const;

  it("persists failed cleanup deadlines and caps retry delays", () => {
    ownWorker(db, "worker", "missing-run", "missing-call", "origin");
    const clock = vi.spyOn(Date, "now").mockReturnValue(10_000);
    expect(retiredWorkers(db, 10_000)).toHaveLength(1);
    recordWorkerCleanup(db, "worker", false);
    expect(retiredWorkers(db, 10_999)).toEqual([]);
    expect(workerOrigins(db, 10_999)).toEqual([]);
    expect(retiredWorkers(db, 11_000)).toHaveLength(1);
    clock.mockReturnValue(11_000);
    recordWorkerCleanup(db, "worker", false);
    expect(retiredWorkers(db, 12_999)).toEqual([]);
    expect(retiredWorkers(db, 13_000)).toHaveLength(1);
    for (let attempt = 0; attempt < 20; attempt++)
      recordWorkerCleanup(db, "worker", false);
    expect(retiredWorkers(db, 70_999)).toEqual([]);
    expect(retiredWorkers(db, 71_000)).toHaveLength(1);
    recordWorkerCleanup(db, "worker", true);
    expect(retiredWorkers(db, 1_000_000)).toEqual([]);
  });

  it("monitors active origins but leaves backed-off completed notifications alone", () => {
    const run = newRun();
    expect(workerOrigins(db, 1_000)).toEqual([run.originThreadId]);
    db.prepare(
      "UPDATE workflow_runs SET status = 'succeeded', notification_next_attempt_at = 999999 WHERE id = ?",
    ).run(run.id);
    expect(workerOrigins(db, 1_000)).toEqual([]);
  });

  it("backfills worker ownership from the pre-upgrade call pointers", () => {
    db.close();
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(migrations.slice(0, -2).join("\n"));
    const run = newRun();
    markRunning(run.id);
    const call = startCall(db, {
      runId: run.id,
      callIndex: 0,
      cacheKey: "migration",
      prompt: "work",
      options: {
        title: null,
        phase: null,
        outputSchema: null,
        selection: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    db.prepare(
      `UPDATE workflow_calls SET child_thread_id = 'legacy-worker', status = 'failed' WHERE id = ?`,
    ).run(call.id);
    db.exec(migrations.slice(-2).join("\n"));
    expect(retiredWorkers(db, Date.now())).toEqual([
      { threadId: "legacy-worker", callId: call.id },
    ]);
    expect(
      db.prepare(`SELECT run_id, origin_thread_id FROM workflow_workers`).get(),
    ).toEqual({ run_id: run.id, origin_thread_id: run.originThreadId });
  });

  it("staggers backfilled cleanup deadlines into one batch per maintenance tick", () => {
    db.close();
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(migrations.slice(0, -2).join("\n"));
    const run = newRun();
    const insertCall = db.prepare(
      `INSERT INTO workflow_calls(id, run_id, call_index, cache_key, prompt,
         options_json, resolved_provider, resolved_model, resolved_reasoning_level,
         resolved_permission_mode, status, child_thread_id, created_at)
       VALUES (?, ?, ?, 'key', 'work', '{}', 'codex', 'gpt-test', 'medium', 'full',
         'failed', ?, 0)`,
    );
    for (let index = 0; index < 250; index++)
      insertCall.run(
        `call-${String(index).padStart(3, "0")}`,
        run.id,
        index,
        `worker-${String(index).padStart(3, "0")}`,
      );
    const migratedAt = Date.now();
    db.exec(migrations.slice(-2).join("\n"));

    const buckets = db
      .prepare(
        `SELECT next_cleanup_at AS at, COUNT(*) AS size FROM workflow_workers
         GROUP BY next_cleanup_at ORDER BY at`,
      )
      .all() as Array<{ at: number; size: number }>;
    expect(buckets.map((bucket) => bucket.size)).toEqual([100, 100, 50]);
    expect(buckets.map((bucket) => bucket.at - buckets[0].at)).toEqual([
      0, 1_000, 2_000,
    ]);
    expect(buckets[0].at).toBeGreaterThan(migratedAt - 2_000);
    expect(buckets[0].at).toBeLessThanOrEqual(Date.now());

    expect(retiredWorkers(db, buckets[0].at)).toHaveLength(100);
    expect(retiredWorkers(db, buckets[0].at + 999)).toHaveLength(100);
    expect(retiredWorkers(db, buckets[2].at)).toHaveLength(100);
    expect(retiredWorkers(db, buckets[0].at).at(0)?.threadId).toBe(
      "worker-000",
    );
  });

  it("retains unattached workers when attachment loses a cancellation race", () => {
    const run = newRun();
    markRunning(run.id);
    const call = startCall(db, {
      runId: run.id,
      callIndex: 0,
      cacheKey: "cancel",
      prompt: "work",
      options: {
        title: null,
        phase: null,
        outputSchema: null,
        selection: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    cancelRun(db, run.id);
    expect(attachCallThread(db, call.id, "unattached-worker")).toBe(false);
    expect(retiredWorkers(db, Date.now())).toEqual([
      { threadId: "unattached-worker", callId: call.id },
    ]);
  });

  it("rechecks one worker's retirement against its current call and run", () => {
    const expectRetired = (threadId: string, retired: boolean) => {
      expect(isWorkerRetired(db, threadId)).toBe(retired);
      expect(
        retiredWorkers(db, Number.MAX_SAFE_INTEGER).some(
          (worker) => worker.threadId === threadId,
        ),
      ).toBe(retired);
    };
    const run = newRun();
    markRunning(run.id);
    const startWork = (cacheKey: string, callIndex: number) =>
      startCall(db, {
        runId: run.id,
        callIndex,
        cacheKey,
        prompt: "work",
        options: {
          title: null,
          phase: null,
          outputSchema: null,
          selection: null,
        },
        selection: resolvedSelection,
        replay: null,
      });

    const live = startWork("live", 0);
    ownWorker(db, "live-worker", run.id, live.id, run.originThreadId);
    expectRetired("live-worker", true);
    expect(attachCallThread(db, live.id, "live-worker")).toBe(true);
    expectRetired("live-worker", false);

    const retried = startWork("retried", 1);
    ownWorker(db, "first-attempt", run.id, retried.id, run.originThreadId);
    expect(attachCallThread(db, retried.id, "first-attempt")).toBe(true);
    db.prepare(
      `UPDATE workflow_calls SET child_thread_id = 'second-attempt' WHERE id = ?`,
    ).run(retried.id);
    expectRetired("first-attempt", true);

    settleCall(db, {
      id: live.id,
      status: "succeeded",
      result: null,
      error: null,
    });
    expectRetired("live-worker", true);
    recordWorkerCleanup(db, "live-worker", true);
    expectRetired("live-worker", false);

    const cancelled = startWork("cancelled", 2);
    ownWorker(db, "cancelled-worker", run.id, cancelled.id, run.originThreadId);
    expect(attachCallThread(db, cancelled.id, "cancelled-worker")).toBe(true);
    expectRetired("cancelled-worker", false);
    cancelRun(db, run.id);
    expectRetired("cancelled-worker", true);

    expectRetired("unknown-worker", false);
  });

  it("records replay safety without a concurrency barrier", () => {
    const run = newRun();
    expect(getRunRequired(db, run.id)).toMatchObject({
      replaySafetyVersion: 1,
      replayBarrierIndex: null,
    });

    markRunning(run.id);
    expect(recoverInterruptedRuns(db)).toEqual([]);
    expect(getRunRequired(db, run.id)).toMatchObject({
      status: "queued",
      replaySafetyVersion: 1,
      replayBarrierIndex: null,
    });

    db.prepare(
      `UPDATE workflow_runs SET replay_safety_version = 0,
       replay_barrier_index = NULL WHERE id = ?`,
    ).run(run.id);
    expect(getRunRequired(db, run.id)).toMatchObject({
      replaySafetyVersion: 0,
      replayBarrierIndex: null,
    });
  });

  it("stores successful calls for deterministic replay", () => {
    const run = newRun();
    markRunning(run.id);
    const call = startCall(db, {
      runId: run.id,
      callIndex: 0,
      cacheKey: "cache",
      prompt: "inspect",
      options: {
        selection: null,
        outputSchema: null,
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    settleCall(db, {
      id: call.id,
      status: "succeeded",
      result: { answer: 42 },
      error: null,
    });

    expect(getCall(db, run.id, 0)).toMatchObject({
      cacheKey: "cache",
      optionsJson:
        '{"selection":null,"outputSchema":null,"title":null,"phase":null}',
      resolvedProvider: "codex",
      resolvedModel: "gpt-test",
      resolvedReasoningLevel: "medium",
      resolvedPermissionMode: "full",
      status: "succeeded",
      resultJson: '{"answer":42}',
      replaySource: null,
    });
  });

  it("persists provider retry attempts across worker replacements", () => {
    const run = newRun();
    markRunning(run.id);
    const call = startCall(db, {
      runId: run.id,
      callIndex: 0,
      cacheKey: "retry",
      prompt: "inspect",
      options: {
        selection: null,
        outputSchema: null,
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    expect(attachCallThread(db, call.id, "child-1")).toBe(true);
    settleCall(db, {
      id: call.id,
      status: "failed",
      result: null,
      error: "provider overloaded",
    });

    expect(
      queueCallProviderRetry(db, call.id, "provider overloaded"),
    ).toMatchObject({
      status: "queued",
      childThreadId: null,
      providerRetryAttempts: 1,
      error: "provider overloaded",
    });
    expect(attachCallThread(db, call.id, "child-2")).toBe(true);
    expect(getCall(db, run.id, 0)).toMatchObject({
      status: "running",
      childThreadId: "child-2",
      providerRetryAttempts: 1,
      error: null,
    });
  });

  it("pages calls by stable index and counts statuses without loading history", () => {
    const run = newRun();
    markRunning(run.id);
    const calls = [0, 1, 2].map((callIndex) =>
      startCall(db, {
        runId: run.id,
        callIndex,
        cacheKey: `cache-${callIndex}`,
        prompt: `inspect ${callIndex}`,
        options: {
          selection: null,
          outputSchema: null,
          title: null,
          phase: null,
        },
        selection: resolvedSelection,
        replay: null,
      }),
    );
    settleCall(db, {
      id: calls[0]!.id,
      status: "succeeded",
      result: "done",
      error: null,
    });
    settleCall(db, {
      id: calls[1]!.id,
      status: "failed",
      result: null,
      error: "failed",
    });
    expect(attachCallThread(db, calls[2]!.id, "child-2")).toBe(true);

    expect(
      listCallsForRunPage(db, {
        runId: run.id,
        afterCallIndex: -1,
        limit: 2,
      }).map((call) => call.callIndex),
    ).toEqual([0, 1]);
    expect(
      listCallsForRunPage(db, {
        runId: run.id,
        afterCallIndex: 1,
        limit: 2,
      }).map((call) => call.callIndex),
    ).toEqual([2]);
    expect(countCallsForRun(db, run.id)).toEqual({
      total: 3,
      queued: 0,
      running: 1,
      succeeded: 1,
      failed: 1,
      cancelled: 0,
    });
  });

  it("requeues interrupted runs and records orphan workers", () => {
    const run = newRun();
    markRunning(run.id);
    const call = startCall(db, {
      runId: run.id,
      callIndex: 0,
      cacheKey: "cache",
      prompt: "inspect",
      options: {
        selection: null,
        outputSchema: null,
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    db.prepare(
      `UPDATE workflow_calls SET status = 'running', child_thread_id = 'child-1' WHERE id = ?`,
    ).run(call.id);

    expect(recoverInterruptedRuns(db)).toEqual(["child-1"]);
    expect(getRunRequired(db, run.id).status).toBe("queued");
    expect(getCall(db, run.id, 0)).toMatchObject({
      status: "cancelled",
      error: "Plugin restarted",
    });
  });

  it("persists JSON null but requires it to rerun instead of replaying", () => {
    const first = newRun();
    markRunning(first.id);
    const original = startCall(db, {
      runId: first.id,
      callIndex: 0,
      cacheKey: "null-cache",
      prompt: "return null",
      options: {
        selection: null,
        outputSchema: null,
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    settleCall(db, {
      id: original.id,
      status: "succeeded",
      result: null,
      error: null,
    });
    expect(getCall(db, first.id, 0)?.resultJson).toBe("null");
    const second = createRun(db, {
      projectId: "project-1",
      originThreadId: "thread-1",
      environmentId: "environment-1",
      originProvider: "codex",
      originModel: "gpt-test",
      originReasoningLevel: "medium",
      originPermissionMode: "full",
      name: "test-workflow",
      source: "return null",
      sourceHash: "hash-2",
      argsJson: "null",
      settingsJson:
        '{"maxActiveRuns":4,"maxConcurrentAgents":8,"maxAgentCalls":100,"totalRunTimeoutMs":86400000,"retentionDays":30,"maxNotificationBytes":16384}',
      resumedFromRunId: first.id,
    });
    markRunning(second.id);
    startCall(db, {
      runId: second.id,
      callIndex: 0,
      cacheKey: "null-cache",
      prompt: "return null",
      options: {
        selection: null,
        outputSchema: null,
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });

    expect(getCall(db, second.id, 0)).toMatchObject({
      status: "queued",
      resultJson: null,
      replayedFromCallId: null,
    });
  });

  it("atomically preserves the first structured value", () => {
    const run = newRun();
    markRunning(run.id);
    const call = startCall(db, {
      runId: run.id,
      callIndex: 0,
      cacheKey: "structured",
      prompt: "answer",
      options: {
        selection: null,
        outputSchema: { type: "object" },
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    expect(attachCallThread(db, call.id, "child-structured")).toBe(true);

    expect(storeStructuredResult(db, call.id, { a: 1, b: 2 })).toBe("accepted");
    expect(storeStructuredResult(db, call.id, { b: 2, a: 1 })).toBe(
      "idempotent",
    );
    expect(storeStructuredResult(db, call.id, { a: 2, b: 1 })).toBe("conflict");
    expect(getCall(db, run.id, 0)?.resultJson).toBe('{"a":1,"b":2}');

    settleCall(db, {
      id: call.id,
      status: "succeeded",
      result: { a: 99 },
      error: null,
    });
    expect(storeStructuredResult(db, call.id, { b: 2, a: 1 })).toBe(
      "idempotent",
    );
    expect(storeStructuredResult(db, call.id, { a: 99 })).toBe("conflict");
  });

  it("uses one guarded repair counter and preserves accepted results on restart", () => {
    const run = newRun();
    markRunning(run.id);
    const call = startCall(db, {
      runId: run.id,
      callIndex: 0,
      cacheKey: "repair",
      prompt: "answer",
      options: {
        selection: null,
        outputSchema: { type: "number" },
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    attachCallThread(db, call.id, "child-repair");

    expect(incrementRepairAttempts(db, call.id)).toBe(1);
    expect(incrementRepairAttempts(db, call.id)).toBe(2);
    expect(storeStructuredResult(db, call.id, null)).toBe("accepted");
    expect(incrementRepairAttempts(db, call.id)).toBeNull();

    expect(recoverInterruptedRuns(db)).toEqual(["child-repair"]);
    expect(getRunRequired(db, run.id).status).toBe("queued");
    expect(getCall(db, run.id, 0)).toMatchObject({
      status: "succeeded",
      repairAttempts: 2,
      resultJson: "null",
      error: null,
    });
  });

  it("persists a successful run result of JSON null and keeps terminal transitions idempotent", () => {
    const run = newRun();
    expect(cancelRun(db, run.id)).toBe(true);
    expect(cancelRun(db, run.id)).toBe(false);
    expect(
      settleRun(db, {
        id: run.id,
        status: "succeeded",
        result: "too late",
        error: null,
      }),
    ).toEqual([]);
    expect(getRunRequired(db, run.id)).toMatchObject({
      status: "cancelled",
      resultJson: null,
    });

    const successful = newRun();
    markRunning(successful.id);
    settleRun(db, {
      id: successful.id,
      status: "succeeded",
      result: null,
      error: null,
    });
    expect(getRunRequired(db, successful.id)).toMatchObject({
      status: "succeeded",
      resultJson: "null",
    });
  });

  it("atomically cancels outstanding calls when a parent settles", () => {
    const run = newRun();
    markRunning(run.id);
    const call = startCall(db, {
      runId: run.id,
      callIndex: 0,
      cacheKey: "fire-and-forget",
      prompt: "slow",
      options: {
        selection: null,
        outputSchema: null,
        title: null,
        phase: null,
      },
      selection: resolvedSelection,
      replay: null,
    });
    db.prepare(
      `UPDATE workflow_calls SET status = 'running', child_thread_id = 'orphan' WHERE id = ?`,
    ).run(call.id);

    expect(
      settleRun(db, {
        id: run.id,
        status: "succeeded",
        result: "done",
        error: null,
      }),
    ).toMatchObject([{ id: call.id, childThreadId: "orphan" }]);
    expect(getRunRequired(db, run.id).status).toBe("succeeded");
    expect(getCall(db, run.id, 0)).toMatchObject({
      status: "cancelled",
      error: "Parent workflow finished before this call",
    });
  });

  it("allows call creation and attachment only while the parent is running", () => {
    const statuses = [
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
    ] as const;

    for (const status of statuses) {
      const creationRun = newRun();
      db.prepare(`UPDATE workflow_runs SET status = ? WHERE id = ?`).run(
        status,
        creationRun.id,
      );
      const create = () =>
        startCall(db, {
          runId: creationRun.id,
          callIndex: 0,
          cacheKey: `creation-${status}`,
          prompt: "state matrix",
          options: {
            selection: null,
            outputSchema: null,
            title: null,
            phase: null,
          },
          selection: resolvedSelection,
          replay: null,
        });
      if (status === "running") {
        expect(create).not.toThrow();
        expect(getCall(db, creationRun.id, 0)).toMatchObject({
          status: "queued",
        });
      } else {
        expect(create).toThrow("is not running");
        expect(getCall(db, creationRun.id, 0)).toBeNull();
      }

      const attachmentRun = newRun();
      markRunning(attachmentRun.id);
      const call = startCall(db, {
        runId: attachmentRun.id,
        callIndex: 0,
        cacheKey: `attachment-${status}`,
        prompt: "state matrix",
        options: {
          selection: null,
          outputSchema: null,
          title: null,
          phase: null,
        },
        selection: resolvedSelection,
        replay: null,
      });
      db.prepare(`UPDATE workflow_runs SET status = ? WHERE id = ?`).run(
        status,
        attachmentRun.id,
      );
      expect(attachCallThread(db, call.id, `matrix-child-${status}`)).toBe(
        status === "running",
      );
      expect(getCall(db, attachmentRun.id, 0)).toMatchObject({
        status: status === "running" ? "running" : "queued",
        childThreadId: status === "running" ? `matrix-child-${status}` : null,
      });
    }
  });

  it("retains active resume ancestry while deleting unrelated expired runs", () => {
    const parent = newRun();
    db.prepare(
      `UPDATE workflow_runs SET status = 'succeeded', notification_sent = 1,
       finished_at = ?, settings_json = json_set(settings_json, '$.retentionDays', 1)
       WHERE id = ?`,
    ).run(Date.now() - 3 * 86_400_000, parent.id);
    const retainedChild = createRun(db, {
      projectId: "project-1",
      originThreadId: "thread-1",
      environmentId: "environment-1",
      originProvider: "codex",
      originModel: "gpt-test",
      originReasoningLevel: "medium",
      originPermissionMode: "full",
      name: "retained-child",
      source: "return null",
      sourceHash: "child-hash",
      argsJson: "null",
      settingsJson:
        '{"maxActiveRuns":4,"maxConcurrentAgents":8,"maxAgentCalls":100,"totalRunTimeoutMs":86400000,"retentionDays":1,"maxNotificationBytes":16384}',
      resumedFromRunId: parent.id,
    });
    const expired = newRun();
    db.prepare(
      `UPDATE workflow_runs SET status = 'failed', notification_sent = 1,
       finished_at = ?, settings_json = json_set(settings_json, '$.retentionDays', 1)
       WHERE id = ?`,
    ).run(Date.now() - 3 * 86_400_000, expired.id);

    expect(sweepExpired(Date.now(), 100)).toBe(1);
    expect(getRunRequired(db, parent.id).id).toBe(parent.id);
    expect(getRunRequired(db, parent.id).replayBarrierIndex).toBeNull();
    expect(getRunRequired(db, retainedChild.id).status).toBe("queued");
    expect(() => getRunRequired(db, expired.id)).toThrow(
      "Unknown workflow run",
    );
  });

  it("deletes an entirely expired resume chain in one bounded sweep", () => {
    const parent = newRun();
    const child = createRun(db, {
      projectId: "project-1",
      originThreadId: "thread-1",
      environmentId: "environment-1",
      originProvider: "codex",
      originModel: "gpt-test",
      originReasoningLevel: "medium",
      originPermissionMode: "full",
      name: "expired-child",
      source: "return null",
      sourceHash: "expired-child-hash",
      argsJson: "null",
      settingsJson:
        '{"maxActiveRuns":4,"maxConcurrentAgents":8,"maxAgentCalls":100,"totalRunTimeoutMs":86400000,"retentionDays":1,"maxNotificationBytes":16384}',
      resumedFromRunId: parent.id,
    });
    db.prepare(
      `UPDATE workflow_runs SET status = 'succeeded', notification_sent = 1,
       finished_at = ?, settings_json = json_set(settings_json, '$.retentionDays', 1)
       WHERE id IN (?, ?)`,
    ).run(Date.now() - 3 * 86_400_000, parent.id, child.id);

    expect(sweepExpired(Date.now(), 100)).toBe(2);
    expect(() => getRunRequired(db, parent.id)).toThrow("Unknown workflow run");
    expect(() => getRunRequired(db, child.id)).toThrow("Unknown workflow run");
  });
});
