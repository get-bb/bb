import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createConnection } from "../../src/connection.js";
import { createEnvironment } from "../../src/data/environments.js";
import {
  areThreadHandoffArchiveEffectsCompleted,
  claimNextThreadHandoffArchiveEffect,
  completeClaimedThreadHandoffArchiveEffect,
  createThreadHandoffArchiveEffects,
  listThreadHandoffArchiveEffects,
  releaseClaimedThreadHandoffArchiveEffect,
} from "../../src/data/thread-handoff-archive-effects.js";
import {
  createThreadHandoff,
  getThreadHandoffByReplacementThreadId,
  getThreadHandoffBySourceAndIdempotencyKey,
  listIncompleteThreadHandoffArchiveEffects,
  listProvisioningThreadHandoffs,
  markThreadHandoffFailed,
  markThreadHandoffStarted,
  type CreateThreadHandoffInput,
} from "../../src/data/thread-handoffs.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { threadHandoffs } from "../../src/schema.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/test-project",
    },
  });
  const environment = createEnvironment(db, noopNotifier, {
    projectId: project.id,
    hostId: host.id,
    workspaceProvisionType: "unmanaged",
    status: "ready",
  });
  const threads = Array.from({ length: 6 }, () =>
    createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
      status: "idle",
    }),
  );

  return { db, environment, project, threads };
}

function handoffInput(
  setupResult: ReturnType<typeof setup>,
  overrides: Partial<CreateThreadHandoffInput> = {},
): CreateThreadHandoffInput {
  return {
    sourceThreadId: setupResult.threads[0].id,
    replacementThreadId: setupResult.threads[1].id,
    projectId: setupResult.project.id,
    environmentId: setupResult.environment.id,
    providerId: "codex",
    model: "gpt-5.6-codex",
    reasoningLevel: "high",
    serviceTier: "fast",
    permissionMode: "accept-edits",
    archiveSource: true,
    idempotencyKey: "handoff-key-0001",
    now: 100,
    ...overrides,
  };
}

describe("thread handoffs", () => {
  it("inserts and reads the exact requested handoff", () => {
    const fixture = setup();
    const input = handoffInput(fixture);

    const created = createThreadHandoff(fixture.db, input);

    expect(created.created).toBe(true);
    expect(created.handoff).toMatchObject({
      sourceThreadId: input.sourceThreadId,
      replacementThreadId: input.replacementThreadId,
      projectId: input.projectId,
      environmentId: input.environmentId,
      providerId: "codex",
      model: "gpt-5.6-codex",
      reasoningLevel: "high",
      serviceTier: "fast",
      permissionMode: "accept-edits",
      archiveSource: true,
      idempotencyKey: "handoff-key-0001",
      status: "provisioning",
      failureCode: null,
      failureMessage: null,
      createdAt: 100,
      updatedAt: 100,
      settledAt: null,
    });
    expect(created.handoff.id).toMatch(/^thd_/u);
    expect(
      getThreadHandoffByReplacementThreadId(
        fixture.db,
        input.replacementThreadId,
      ),
    ).toEqual(created.handoff);
  });

  it("returns the existing record for repeated idempotent creation", () => {
    const fixture = setup();
    const input = handoffInput(fixture);
    const first = createThreadHandoff(fixture.db, input);

    const second = createThreadHandoff(fixture.db, {
      ...input,
      replacementThreadId: fixture.threads[2].id,
      model: "gpt-5.6-terra",
      now: 200,
    });

    expect(second).toEqual({ created: false, handoff: first.handoff });
    expect(
      getThreadHandoffBySourceAndIdempotencyKey(fixture.db, {
        sourceThreadId: input.sourceThreadId,
        idempotencyKey: input.idempotencyKey,
      }),
    ).toEqual(first.handoff);
  });

  it("rejects reusing one replacement thread for another handoff", () => {
    const fixture = setup();
    const firstInput = handoffInput(fixture);
    createThreadHandoff(fixture.db, firstInput);

    expect(() =>
      createThreadHandoff(fixture.db, {
        ...firstInput,
        sourceThreadId: fixture.threads[2].id,
        idempotencyKey: "handoff-key-0002",
      }),
    ).toThrow();
  });

  it("compare-and-sets a provisioning handoff to started", () => {
    const fixture = setup();
    const input = handoffInput(fixture);
    createThreadHandoff(fixture.db, input);

    const outcome = markThreadHandoffStarted(fixture.db, {
      replacementThreadId: input.replacementThreadId,
      settledAt: 200,
    });

    expect(outcome.applied).toBe(true);
    if (!outcome.applied) {
      throw new Error("expected started transition to apply");
    }
    expect(outcome.handoff).toMatchObject({
      status: "started",
      failureCode: null,
      failureMessage: null,
      updatedAt: 200,
      settledAt: 200,
    });
  });

  it("compare-and-sets a provisioning handoff to failed", () => {
    const fixture = setup();
    const input = handoffInput(fixture);
    createThreadHandoff(fixture.db, input);

    const outcome = markThreadHandoffFailed(fixture.db, {
      replacementThreadId: input.replacementThreadId,
      failure: {
        code: "provider_start_failed",
        message: "Provider process exited before the root turn started",
      },
      settledAt: 250,
    });

    expect(outcome.applied).toBe(true);
    if (!outcome.applied) {
      throw new Error("expected failed transition to apply");
    }
    expect(outcome.handoff).toMatchObject({
      status: "failed",
      failureCode: "provider_start_failed",
      failureMessage: "Provider process exited before the root turn started",
      updatedAt: 250,
      settledAt: 250,
    });
  });

  it.each([
    { failureCode: null, failureMessage: "message", label: "null code" },
    { failureCode: "code", failureMessage: null, label: "null message" },
    { failureCode: "", failureMessage: "message", label: "empty code" },
    { failureCode: "code", failureMessage: "", label: "empty message" },
  ])("rejects a failed row with $label", ({ failureCode, failureMessage }) => {
    const fixture = setup();
    const input = handoffInput(fixture);
    const handoff = createThreadHandoff(fixture.db, input).handoff;

    expect(() =>
      fixture.db
        .update(threadHandoffs)
        .set({
          status: "failed",
          failureCode,
          failureMessage,
          settledAt: 200,
          updatedAt: 200,
        })
        .where(eq(threadHandoffs.id, handoff.id))
        .run(),
    ).toThrow(/thread_handoffs_settlement_shape_check/u);
  });

  it("does not overwrite either kind of settled handoff", () => {
    const fixture = setup();
    const startedInput = handoffInput(fixture);
    const failedInput = handoffInput(fixture, {
      sourceThreadId: fixture.threads[2].id,
      replacementThreadId: fixture.threads[3].id,
      idempotencyKey: "handoff-key-0002",
    });
    createThreadHandoff(fixture.db, startedInput);
    createThreadHandoff(fixture.db, failedInput);
    markThreadHandoffStarted(fixture.db, {
      replacementThreadId: startedInput.replacementThreadId,
      settledAt: 200,
    });
    markThreadHandoffFailed(fixture.db, {
      replacementThreadId: failedInput.replacementThreadId,
      failure: { code: "failed", message: "failed first" },
      settledAt: 200,
    });

    expect(
      markThreadHandoffFailed(fixture.db, {
        replacementThreadId: startedInput.replacementThreadId,
        failure: { code: "late_failure", message: "must not win" },
        settledAt: 300,
      }),
    ).toMatchObject({
      applied: false,
      reason: "already-settled",
      handoff: { status: "started", settledAt: 200 },
    });
    expect(
      markThreadHandoffStarted(fixture.db, {
        replacementThreadId: failedInput.replacementThreadId,
        settledAt: 300,
      }),
    ).toMatchObject({
      applied: false,
      reason: "already-settled",
      handoff: {
        status: "failed",
        failureCode: "failed",
        settledAt: 200,
      },
    });
  });

  it("pages only provisioning handoffs with a stable cursor", () => {
    const fixture = setup();
    const firstInput = handoffInput(fixture, { now: 100 });
    const settledInput = handoffInput(fixture, {
      sourceThreadId: fixture.threads[2].id,
      replacementThreadId: fixture.threads[3].id,
      idempotencyKey: "handoff-key-0002",
      now: 200,
    });
    const lastInput = handoffInput(fixture, {
      sourceThreadId: fixture.threads[4].id,
      replacementThreadId: fixture.threads[5].id,
      idempotencyKey: "handoff-key-0003",
      now: 300,
    });
    const first = createThreadHandoff(fixture.db, firstInput).handoff;
    createThreadHandoff(fixture.db, settledInput);
    const last = createThreadHandoff(fixture.db, lastInput).handoff;
    markThreadHandoffStarted(fixture.db, {
      replacementThreadId: settledInput.replacementThreadId,
      settledAt: 250,
    });

    const firstPage = listProvisioningThreadHandoffs(fixture.db, { limit: 1 });
    expect(firstPage.handoffs).toEqual([first]);
    expect(firstPage.nextCursor).toEqual({ createdAt: 100, id: first.id });

    const secondPage = listProvisioningThreadHandoffs(fixture.db, {
      after: firstPage.nextCursor ?? undefined,
      limit: 1,
    });
    expect(secondPage).toEqual({ handoffs: [last], nextCursor: null });
  });

  it("pages only started archive handoffs with incomplete durable effects", () => {
    const fixture = setup();
    const firstInput = handoffInput(fixture, { now: 100 });
    const noArchiveInput = handoffInput(fixture, {
      archiveSource: false,
      sourceThreadId: fixture.threads[2].id,
      replacementThreadId: fixture.threads[3].id,
      idempotencyKey: "handoff-key-0002",
      now: 200,
    });
    const lastInput = handoffInput(fixture, {
      sourceThreadId: fixture.threads[4].id,
      replacementThreadId: fixture.threads[5].id,
      idempotencyKey: "handoff-key-0003",
      now: 300,
    });
    const first = createThreadHandoff(fixture.db, firstInput).handoff;
    createThreadHandoff(fixture.db, noArchiveInput);
    const last = createThreadHandoff(fixture.db, lastInput).handoff;
    for (const input of [firstInput, noArchiveInput, lastInput]) {
      const outcome = markThreadHandoffStarted(fixture.db, {
        replacementThreadId: input.replacementThreadId,
      });
      if (outcome.applied && input.archiveSource) {
        createThreadHandoffArchiveEffects(fixture.db, {
          handoffId: outcome.handoff.id,
          effects: [
            {
              effectKey: "notification:000000",
              effectType: "notification",
              payload: "{}",
            },
          ],
        });
      }
    }

    const firstPage = listIncompleteThreadHandoffArchiveEffects(fixture.db, {
      limit: 1,
    });
    expect(firstPage.handoffs).toEqual([
      expect.objectContaining({ id: first.id }),
    ]);
    expect(firstPage.nextCursor).toEqual({ createdAt: 100, id: first.id });
    const secondPage = listIncompleteThreadHandoffArchiveEffects(fixture.db, {
      after: firstPage.nextCursor ?? undefined,
      limit: 1,
    });
    expect(secondPage.handoffs).toEqual([
      expect.objectContaining({ id: last.id }),
    ]);

    const claimed = claimNextThreadHandoffArchiveEffect(fixture.db, {
      handoffId: first.id,
      leaseMs: 1_000,
      now: 400,
    });
    expect(claimed).toMatchObject({ effectKey: "notification:000000" });
    if (!claimed?.claimToken) throw new Error("expected claimed effect");
    expect(
      completeClaimedThreadHandoffArchiveEffect(fixture.db, {
        claimToken: claimed.claimToken,
        effectKey: claimed.effectKey,
        handoffId: claimed.handoffId,
        completedAt: 500,
      }),
    ).toBe(true);
    expect(areThreadHandoffArchiveEffectsCompleted(fixture.db, first.id)).toBe(
      true,
    );
    expect(
      listIncompleteThreadHandoffArchiveEffects(fixture.db, { limit: 10 })
        .handoffs,
    ).toEqual([
      expect.objectContaining({ id: last.id }),
    ]);
  });

  it("claims each archive effect once, releases failures, and preserves individual completion", () => {
    const fixture = setup();
    const handoff = createThreadHandoff(fixture.db, handoffInput(fixture)).handoff;
    createThreadHandoffArchiveEffects(fixture.db, {
      handoffId: handoff.id,
      now: 100,
      effects: [
        { effectKey: "a", effectType: "notification", payload: '{"a":1}' },
        { effectKey: "b", effectType: "close-terminals", payload: '{"b":2}' },
      ],
    });

    const first = claimNextThreadHandoffArchiveEffect(fixture.db, {
      handoffId: handoff.id,
      leaseMs: 1_000,
      now: 200,
    });
    expect(first).toMatchObject({ effectKey: "a" });
    expect(
      claimNextThreadHandoffArchiveEffect(fixture.db, {
        handoffId: handoff.id,
        leaseMs: 1_000,
        now: 200,
      }),
    ).toMatchObject({ effectKey: "b" });
    if (!first?.claimToken) throw new Error("expected first claim");
    expect(
      releaseClaimedThreadHandoffArchiveEffect(fixture.db, {
        claimToken: first.claimToken,
        effectKey: first.effectKey,
        handoffId: first.handoffId,
        now: 201,
      }),
    ).toBe(true);
    const retried = claimNextThreadHandoffArchiveEffect(fixture.db, {
      handoffId: handoff.id,
      leaseMs: 1_000,
      now: 202,
    });
    expect(retried).toMatchObject({ effectKey: "a" });
    expect(listThreadHandoffArchiveEffects(fixture.db, handoff.id)).toHaveLength(
      2,
    );
  });
});
