import {
  archiveThread,
  claimNextThreadHandoffArchiveEffect,
  completeClaimedThreadHandoffArchiveEffect,
  createThreadHandoff as createThreadHandoffRow,
  createThreadHandoffArchiveEffects,
  getThread,
  getThreadHandoffByReplacementThreadId,
  listThreadHandoffArchiveEffects,
  markThreadHandoffStarted,
} from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import {
  settleThreadHandoffFailed,
  settleThreadHandoffStarted,
} from "../../src/services/threads/thread-handoff.js";
import { runThreadHandoffReconciliationSweep } from "../../src/services/system/periodic-sweeps.js";
import { setPluginThreadEventEmitter } from "../../src/services/plugins/plugin-thread-events.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedHandoff(
  harness: TestAppHarness,
  args: { archiveSource: boolean },
) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const source = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "idle",
  });
  const replacement = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "starting",
  });
  createThreadHandoffRow(harness.db, {
    archiveSource: args.archiveSource,
    environmentId: environment.id,
    idempotencyKey: `handoff-${replacement.id}`,
    model: "gpt-5.6-codex",
    permissionMode: "accept-edits",
    projectId: project.id,
    providerId: "codex",
    reasoningLevel: "high",
    replacementThreadId: replacement.id,
    serviceTier: null,
    sourceThreadId: source.id,
  });
  return { replacement, source };
}

describe("thread handoff lifecycle settlement", () => {
  it("keeps the source live until the replacement root turn is accepted as started", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });

      expect(
        getThreadHandoffByReplacementThreadId(harness.db, replacement.id),
      ).toMatchObject({ status: "provisioning" });
      expect(getThread(harness.db, source.id)?.archivedAt).toBeNull();
    });
  });

  it("atomically starts the handoff and archives its source, then runs archive side effects", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });
      const closeTerminals = vi.spyOn(
        harness.deps.terminalSessions,
        "closeArchivedThreadTerminals",
      );
      const notifyThread = vi.spyOn(harness.deps.hub, "notifyThread");

      const outcome = settleThreadHandoffStarted(harness.deps, replacement.id);

      expect(outcome).toMatchObject({ applied: true });
      expect(
        getThreadHandoffByReplacementThreadId(harness.db, replacement.id),
      ).toMatchObject({ status: "started", failureCode: null });
      expect(getThread(harness.db, source.id)?.archivedAt).toEqual(
        expect.any(Number),
      );
      expect(closeTerminals).toHaveBeenCalledWith({ threadId: source.id });
      expect(notifyThread).toHaveBeenCalledWith(
        source.id,
        ["archived-changed"],
        expect.objectContaining({ projectId: source.projectId }),
      );
    });
  });

  it("releases assigned children when takeover archives their source", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });
      const child = seedThread(harness.deps, {
        environmentId: source.environmentId,
        parentThreadId: source.id,
        projectId: source.projectId,
      });

      settleThreadHandoffStarted(harness.deps, replacement.id);

      expect(getThread(harness.db, source.id)?.archivedAt).toEqual(
        expect.any(Number),
      );
      expect(getThread(harness.db, child.id)?.parentThreadId).toBeNull();
    });
  });

  it("marks archiveSource=false started without archiving the source", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: false,
      });

      expect(
        settleThreadHandoffStarted(harness.deps, replacement.id),
      ).toMatchObject({ applied: true });
      expect(getThread(harness.db, source.id)?.archivedAt).toBeNull();
    });
  });

  it("treats a manually archived source as satisfying a started handoff", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });
      archiveThread(harness.db, harness.hub, source.id);
      const archivedAt = getThread(harness.db, source.id)?.archivedAt;
      const closeTerminals = vi.spyOn(
        harness.deps.terminalSessions,
        "closeArchivedThreadTerminals",
      );

      expect(
        settleThreadHandoffStarted(harness.deps, replacement.id),
      ).toMatchObject({ applied: true });
      expect(getThread(harness.db, source.id)?.archivedAt).toBe(archivedAt);
      expect(closeTerminals).not.toHaveBeenCalled();
    });
  });

  it("is idempotent after the first started settlement", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });
      const closeTerminals = vi.spyOn(
        harness.deps.terminalSessions,
        "closeArchivedThreadTerminals",
      );

      settleThreadHandoffStarted(harness.deps, replacement.id);
      const archivedAt = getThread(harness.db, source.id)?.archivedAt;
      const repeated = settleThreadHandoffStarted(harness.deps, replacement.id);

      expect(repeated).toMatchObject({
        applied: false,
        reason: "already-settled",
        handoff: { status: "started" },
      });
      expect(getThread(harness.db, source.id)?.archivedAt).toBe(archivedAt);
      expect(closeTerminals).toHaveBeenCalledTimes(1);
    });
  });

  it("records a structured terminal failure and leaves the source live", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });

      const outcome = settleThreadHandoffFailed(harness.deps, replacement.id, {
        code: "provider_start_failed",
        message: "Provider exited before the root turn started",
      });

      expect(outcome).toMatchObject({ applied: true });
      expect(
        getThreadHandoffByReplacementThreadId(harness.db, replacement.id),
      ).toMatchObject({
        status: "failed",
        failureCode: "provider_start_failed",
        failureMessage: "Provider exited before the root turn started",
      });
      expect(getThread(harness.db, source.id)?.archivedAt).toBeNull();
    });
  });

  it("contains an archive notification failure and replays incomplete effects", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });
      const notify = vi
        .spyOn(harness.deps.hub, "notifyThread")
        .mockImplementationOnce(() => {
          throw new Error("socket failed");
        });
      const closeTerminals = vi.spyOn(
        harness.deps.terminalSessions,
        "closeArchivedThreadTerminals",
      );

      settleThreadHandoffStarted(harness.deps, replacement.id);

      expect(closeTerminals).toHaveBeenCalledWith({ threadId: source.id });
      expect(
        listThreadHandoffArchiveEffects(
          harness.db,
          getThreadHandoffByReplacementThreadId(harness.db, replacement.id)!.id,
        ).some((effect) => effect.completedAt === null),
      ).toBe(true);
      notify.mockRestore();

      runThreadHandoffReconciliationSweep(harness.deps);

      expect(
        listThreadHandoffArchiveEffects(
          harness.db,
          getThreadHandoffByReplacementThreadId(harness.db, replacement.id)!.id,
        ).every((effect) => effect.completedAt !== null),
      ).toBe(true);
    });
  });

  it("retries a failed released-child notification without replaying successful sibling notifications", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });
      const child = seedThread(harness.deps, {
        environmentId: source.environmentId,
        parentThreadId: source.id,
        projectId: source.projectId,
      });
      let failedParentNotification = false;
      const notify = vi
        .spyOn(harness.deps.hub, "notifyThread")
        .mockImplementation((threadId, changes) => {
          if (
            threadId === child.id &&
            changes.includes("parent-changed") &&
            !failedParentNotification
          ) {
            failedParentNotification = true;
            throw new Error("child notification failed");
          }
        });

      settleThreadHandoffStarted(harness.deps, replacement.id);
      runThreadHandoffReconciliationSweep(harness.deps);

      const childParentChanges = notify.mock.calls.filter(
        ([threadId, changes]) =>
          threadId === child.id && changes.includes("parent-changed"),
      );
      const childEventChanges = notify.mock.calls.filter(
        ([threadId, changes]) =>
          threadId === child.id && changes.includes("events-appended"),
      );
      expect(childParentChanges).toHaveLength(2);
      expect(childEventChanges).toHaveLength(1);
    });
  });

  it("contains terminal cleanup failure, still runs plugin effects, and retries once", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });
      const emitThreadArchived = vi.fn();
      setPluginThreadEventEmitter({
        emitThreadActive: vi.fn(),
        emitThreadArchived,
        emitThreadCreated: vi.fn(),
        emitThreadDeleted: vi.fn(),
        emitThreadFailed: vi.fn(),
        emitThreadIdle: vi.fn(),
      });
      const closeTerminals = vi
        .spyOn(harness.deps.terminalSessions, "closeArchivedThreadTerminals")
        .mockImplementationOnce(() => {
          throw new Error("terminal cleanup failed");
        });
      try {
        settleThreadHandoffStarted(harness.deps, replacement.id);

        expect(emitThreadArchived).toHaveBeenCalledWith(
          expect.objectContaining({ id: source.id }),
        );
        const handoff = getThreadHandoffByReplacementThreadId(
          harness.db,
          replacement.id,
        )!;
        expect(
          listThreadHandoffArchiveEffects(harness.db, handoff.id).some(
            (effect) => effect.completedAt === null,
          ),
        ).toBe(true);
        closeTerminals.mockRestore();

        runThreadHandoffReconciliationSweep(harness.deps);
        expect(
          listThreadHandoffArchiveEffects(harness.db, handoff.id).every(
            (effect) => effect.completedAt !== null,
          ),
        ).toBe(true);
        expect(emitThreadArchived).toHaveBeenCalledTimes(1);
      } finally {
        setPluginThreadEventEmitter(undefined);
      }
    });
  });

  it("does not deliver one claimed effect twice when reconciliation overlaps", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });
      const notify = vi
        .spyOn(harness.deps.hub, "notifyThread")
        .mockImplementationOnce(() => {
          throw new Error("initial notification failed");
        });
      settleThreadHandoffStarted(harness.deps, replacement.id);
      notify.mockClear();
      let nestedSweepStarted = false;
      notify.mockImplementation((threadId, changes) => {
        if (
          threadId === source.id &&
          changes.includes("archived-changed") &&
          !nestedSweepStarted
        ) {
          nestedSweepStarted = true;
          runThreadHandoffReconciliationSweep(harness.deps);
        }
      });

      runThreadHandoffReconciliationSweep(harness.deps);

      expect(
        notify.mock.calls.filter(
          ([threadId, changes]) =>
            threadId === source.id && changes.includes("archived-changed"),
        ),
      ).toHaveLength(1);
    });
  });

  it("does not retry an at-most-once plugin archive event that throws after dispatch", async () => {
    await withTestHarness(async (harness) => {
      const { replacement } = seedHandoff(harness, {
        archiveSource: true,
      });
      const emitThreadArchived = vi.fn(() => {
        throw new Error("process stopped after plugin dispatch");
      });
      setPluginThreadEventEmitter({
        emitThreadActive: vi.fn(),
        emitThreadArchived,
        emitThreadCreated: vi.fn(),
        emitThreadDeleted: vi.fn(),
        emitThreadFailed: vi.fn(),
        emitThreadIdle: vi.fn(),
      });
      try {
        settleThreadHandoffStarted(harness.deps, replacement.id);
        runThreadHandoffReconciliationSweep(harness.deps);

        expect(emitThreadArchived).toHaveBeenCalledTimes(1);
      } finally {
        setPluginThreadEventEmitter(undefined);
      }
    });
  });

  it("accepts loss instead of duplication when a plugin effect is completed before a simulated crash", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });
      const handoffOutcome = markThreadHandoffStarted(harness.db, {
        replacementThreadId: replacement.id,
      });
      if (!handoffOutcome.applied) throw new Error("expected started handoff");
      archiveThread(harness.db, harness.hub, source.id);
      createThreadHandoffArchiveEffects(harness.db, {
        handoffId: handoffOutcome.handoff.id,
        effects: [
          {
            effectKey: "plugin:archived",
            effectType: "plugin-archived",
            payload: JSON.stringify({
              environmentId: source.environmentId,
              threadId: source.id,
            }),
          },
        ],
      });
      const claimed = claimNextThreadHandoffArchiveEffect(harness.db, {
        handoffId: handoffOutcome.handoff.id,
        leaseMs: 30_000,
      });
      if (!claimed?.claimToken) throw new Error("expected plugin effect claim");
      completeClaimedThreadHandoffArchiveEffect(harness.db, {
        claimToken: claimed.claimToken,
        effectKey: claimed.effectKey,
        handoffId: claimed.handoffId,
      });
      const emitThreadArchived = vi.fn();
      setPluginThreadEventEmitter({
        emitThreadActive: vi.fn(),
        emitThreadArchived,
        emitThreadCreated: vi.fn(),
        emitThreadDeleted: vi.fn(),
        emitThreadFailed: vi.fn(),
        emitThreadIdle: vi.fn(),
      });
      try {
        runThreadHandoffReconciliationSweep(harness.deps);
        expect(emitThreadArchived).not.toHaveBeenCalled();
      } finally {
        setPluginThreadEventEmitter(undefined);
      }
    });
  });

  it("rolls back handoff start, source archive, and child release together", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });
      const child = seedThread(harness.deps, {
        environmentId: source.environmentId,
        parentThreadId: source.id,
        projectId: source.projectId,
      });
      harness.db.$client.exec(`
        CREATE TRIGGER fail_handoff_child_release
        BEFORE UPDATE OF parent_thread_id ON threads
        WHEN OLD.id = '${child.id}' AND NEW.parent_thread_id IS NULL
        BEGIN
          SELECT RAISE(ABORT, 'synthetic child release failure');
        END;
      `);

      expect(() =>
        settleThreadHandoffStarted(harness.deps, replacement.id),
      ).toThrow(/synthetic child release failure/u);
      expect(
        getThreadHandoffByReplacementThreadId(harness.db, replacement.id),
      ).toMatchObject({ status: "provisioning" });
      expect(getThread(harness.db, source.id)?.archivedAt).toBeNull();
      expect(getThread(harness.db, child.id)?.parentThreadId).toBe(source.id);
    });
  });
});
