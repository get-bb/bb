import {
  events,
  nextSteps,
  projects,
  threads,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import {
  nextStepInputSchema,
  type NextStep,
  type NextStepEvidence,
} from "@bb/domain";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isNextStepRepositoryReference } from "./next-step-evidence.js";
import {
  acceptNextStep,
  completeNextStepTurn,
  dismissNextStep,
  getNextStep,
  nextStepDeliveryAt,
  linkNextStepResult,
  noteNextStepUserMessage,
  showNextStep,
  undoNextStep,
} from "./next-step.js";

const now = Date.UTC(2040, 0, 1, 18);
let db: DbConnection;

beforeEach(() => {
  db = createMigratedConnection();
  db.insert(projects)
    .values({ id: "project", name: "Project", createdAt: now, updatedAt: now })
    .run();
});
afterEach(() => db.$client.close());

function seedSuggestion(
  threadId: string,
  kind: "task" | "automation" = "task",
  source: NextStepEvidence["source"] = "conversation",
): NextStep {
  db.insert(threads)
    .values({
      id: threadId,
      projectId: "project",
      providerId: "fake",
      status: "idle",
      latestAttentionAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(events)
    .values({
      id: `${threadId}-started`,
      threadId,
      turnId: `${threadId}-turn`,
      scopeKind: "turn",
      sequence: 1,
      type: "turn/started",
      data: "{}",
      createdAt: now,
    })
    .run();
  const suggestion: NextStep = {
    id: `next-${threadId}`,
    analyticsId: randomUUID(),
    threadId,
    turnId: `${threadId}-turn`,
    status: "pending",
    title: "Triage the failing checks",
    why: "The checks failed in today's work",
    evidence: [{ source, ref: "evidence" }],
    action:
      kind === "task"
        ? { kind, task: { prompt: "Triage the failures", parallel: true } }
        : {
            kind,
            automation: {
              prompt: "Triage overnight failures",
              schedule: { runAt: Date.UTC(2040, 0, 2, 9), timezone: "UTC" },
            },
          },
    createdAt: now,
    shownAt: null,
    result: null,
  };
  db.insert(nextSteps)
    .values({
      threadId,
      turnId: suggestion.turnId,
      status: "pending",
      kind,
      suggestion,
    })
    .run();
  return suggestion;
}

function finish(
  suggestion: NextStep,
  successful = true,
  completedAt = now,
): void {
  completeNextStepTurn(db, {
    threadId: suggestion.threadId,
    turnId: suggestion.turnId,
    successful,
    completedAt,
  });
}

describe("Next step lifecycle", () => {
  it("keeps the parent proposal valid after a nested turn and expires it after a newer root turn", () => {
    const suggestion = seedSuggestion("parent");
    db.insert(events)
      .values({
        id: "nested-started",
        threadId: suggestion.threadId,
        turnId: "nested-turn",
        scopeKind: "turn",
        sequence: 2,
        type: "turn/started",
        parentToolCallId: "delegation-tool-call",
        data: JSON.stringify({ parentToolCallId: "delegation-tool-call" }),
        createdAt: now + 1,
      })
      .run();
    finish(suggestion, true, now + 2);
    expect(getNextStep(db, suggestion.threadId, now + 3)?.status).toBe(
      "proposed",
    );
    db.insert(events)
      .values({
        id: "new-root-started",
        threadId: suggestion.threadId,
        turnId: "new-root-turn",
        scopeKind: "turn",
        sequence: 3,
        type: "turn/started",
        data: "{}",
        createdAt: now + 4,
      })
      .run();
    expect(getNextStep(db, suggestion.threadId, now + 5)?.status).toBe(
      "expired",
    );
  });

  it("waits for a successful turn and records an actual display only once", () => {
    const suggestion = seedSuggestion("first");
    expect(showNextStep(db, { threadId: "first", now }).newlyShown).toBe(false);
    finish(suggestion);
    expect(getNextStep(db, "first", now)).toMatchObject({
      status: "proposed",
      shownAt: null,
    });
    expect(showNextStep(db, { threadId: "first", now }).newlyShown).toBe(true);
    expect(showNextStep(db, { threadId: "first", now }).newlyShown).toBe(false);
    const failed = seedSuggestion("failed");
    finish(failed, false);
    expect(
      showNextStep(db, { threadId: "failed", now }).suggestion?.status,
    ).toBe("expired");
  });

  it("holds the overnight proposal for thirty idle minutes and offers it once per install", () => {
    const first = seedSuggestion("first", "automation");
    finish(first);
    expect(getNextStep(db, "first", now + 30 * 60_000 - 1)?.status).toBe(
      "pending",
    );
    expect(getNextStep(db, "first", now + 30 * 60_000)?.status).toBe(
      "proposed",
    );
    const second = seedSuggestion("second", "automation");
    finish(second, true, now + 60_000);
    expect(getNextStep(db, "second", now + 31 * 60_000)?.status).toBe(
      "expired",
    );
  });

  it("expires an overnight offer after a message in another thread or a later successful turn", () => {
    const first = seedSuggestion("first", "automation");
    finish(first);
    noteNextStepUserMessage(db, { threadId: "other", now: now + 1 });
    expect(getNextStep(db, "first", now + 30 * 60_000)?.status).toBe("expired");
    const second = seedSuggestion("second", "automation");
    finish(second, true, now + 2);
    const third = seedSuggestion("third");
    finish(third, true, now + 3);
    expect(getNextStep(db, "second", now + 31 * 60_000)?.status).toBe(
      "expired",
    );
  });

  it("suppresses a dismissed kind across threads until a different evidence source appears", () => {
    const first = seedSuggestion("first");
    finish(first);
    showNextStep(db, { threadId: "first", now });
    expect(dismissNextStep(db, "first").newlyDismissed).toBe(true);
    expect(dismissNextStep(db, "first").newlyDismissed).toBe(false);
    const same = seedSuggestion("same");
    finish(same);
    expect(getNextStep(db, "same", now)?.status).toBe("expired");
    const different = seedSuggestion("different", "task", "file");
    finish(different);
    expect(getNextStep(db, "different", now)?.status).toBe("proposed");
  });

  it("rejects concurrent accept clicks and does not create work again on retry", async () => {
    const suggestion = seedSuggestion("first");
    finish(suggestion);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const execute = async () => {
      calls += 1;
      await gate;
      return { kind: "task" as const, threadIds: ["child"] };
    };
    const first = acceptNextStep(db, { threadId: "first", execute });
    await expect(
      acceptNextStep(db, { threadId: "first", execute }),
    ).rejects.toMatchObject({ status: 409 });
    release();
    expect((await first).newlyAccepted).toBe(true);
    expect(
      (await acceptNextStep(db, { threadId: "first", execute })).newlyAccepted,
    ).toBe(false);
    expect(calls).toBe(1);
    expect(getNextStep(db, "first")?.shownAt).toBeNull();
    noteNextStepUserMessage(db, { threadId: "first" });
    expect(getNextStep(db, "first")?.status).toBe("accepted");
  });

  it("never retries ambiguous execution failures and preserves an already linked result", async () => {
    const failed = seedSuggestion("failed");
    finish(failed);
    await expect(
      acceptNextStep(db, {
        threadId: "failed",
        execute: async () => {
          throw new Error("connection lost");
        },
      }),
    ).rejects.toThrow("connection lost");
    expect(getNextStep(db, "failed")?.status).toBe("expired");
    const linked = seedSuggestion("linked");
    finish(linked);
    const accepted = await acceptNextStep(db, {
      threadId: "linked",
      execute: async () => {
        linkNextStepResult(db, {
          threadId: "linked",
          result: { kind: "task", threadIds: ["created"] },
        });
        throw new Error("follow-up failed");
      },
    });
    expect(accepted.suggestion).toMatchObject({
      status: "accepted",
      result: { threadIds: ["created"] },
    });
  });

  it("undoes only accepted schedules and makes repeat undo harmless", async () => {
    const suggestion = seedSuggestion("first", "automation");
    finish(suggestion);
    getNextStep(db, "first", now + 30 * 60_000);
    await acceptNextStep(db, {
      threadId: "first",
      execute: async () => ({ kind: "automation", automationId: "once" }),
    });
    const removed: string[] = [];
    const undo = async (id: string) => {
      removed.push(id);
    };
    expect((await undoNextStep(db, { threadId: "first", undo })).status).toBe(
      "undone",
    );
    await undoNextStep(db, { threadId: "first", undo });
    expect(removed).toEqual(["once"]);
  });

  it("expires proposals when another turn starts or the source thread is archived", () => {
    const suggestion = seedSuggestion("first");
    finish(suggestion);
    db.insert(events)
      .values({
        id: "later",
        threadId: "first",
        turnId: "later",
        scopeKind: "turn",
        type: "turn/started",
        sequence: 2,
        data: "{}",
        createdAt: now + 1,
      })
      .run();
    expect(getNextStep(db, "first", now)?.status).toBe("expired");
    const archived = seedSuggestion("archived");
    finish(archived);
    db.update(threads)
      .set({ archivedAt: now })
      .where(eq(threads.id, "archived"))
      .run();
    expect(getNextStep(db, "archived", now)?.status).toBe("expired");
  });
});

describe("Next step boundaries", () => {
  it.each([
    ["2026-10-22T18:00:00Z", "UTC", "2026-10-23T09:00:00Z"],
    ["2026-10-23T08:00:00Z", "UTC", "2026-10-26T09:00:00Z"],
    ["2026-10-24T18:00:00Z", "UTC", "2026-10-26T09:00:00Z"],
    ["2026-10-25T18:00:00Z", "UTC", "2026-10-26T09:00:00Z"],
    [
      "2026-03-06T18:00:00-05:00",
      "America/New_York",
      "2026-03-09T09:00:00-04:00",
    ],
    [
      "2026-10-30T18:00:00-04:00",
      "America/New_York",
      "2026-11-02T09:00:00-05:00",
    ],
    [
      "2026-10-02T18:00:00+10:30",
      "Australia/Lord_Howe",
      "2026-10-05T09:00:00+11:00",
    ],
    [
      "2026-10-23T00:30:00Z",
      "America/Los_Angeles",
      "2026-10-23T09:00:00-07:00",
    ],
  ])(
    "delivers after %s on the next weekday at 09:00 in %s",
    (acceptedAt, timezone, expected) => {
      expect(nextStepDeliveryAt(Date.parse(acceptedAt), timezone)).toBe(
        Date.parse(expected),
      );
    },
  );

  it("rejects off-project, credential-bearing and mismatched evidence URLs", () => {
    const remote = "git@github.com:owner/repo.git";
    expect(
      isNextStepRepositoryReference(remote, {
        source: "pull_request",
        ref: "https://github.com/owner/repo/pull/12",
      }),
    ).toBe(true);
    for (const ref of [
      "https://github.com/owner/repo-other/pull/12",
      "https://github.com/other/repo/pull/12",
      "https://github.com.evil.test/owner/repo/pull/12",
      "https://secret@github.com/owner/repo/pull/12",
      "https://github.com/owner/repo/issues/12",
    ]) {
      expect(
        isNextStepRepositoryReference(remote, { source: "pull_request", ref }),
      ).toBe(false);
    }
  });

  it("rejects absent evidence, mixed action payloads, invalid timezones, and reserved kinds", () => {
    const input = {
      title: "Do work",
      why: "Observed failure",
      evidence: [{ source: "conversation", ref: "message" }],
      action: { kind: "task", task: { prompt: "Do work", parallel: true } },
    };
    expect(
      nextStepInputSchema.safeParse({ ...input, evidence: [] }).success,
    ).toBe(false);
    expect(
      nextStepInputSchema.safeParse({
        ...input,
        action: { ...input.action, automation: {} },
      }).success,
    ).toBe(false);
    expect(
      nextStepInputSchema.safeParse({
        ...input,
        action: { kind: "plugin", plugin: {} },
      }).success,
    ).toBe(false);
    expect(
      nextStepInputSchema.safeParse({
        ...input,
        action: {
          kind: "automation",
          automation: {
            prompt: "Do work",
            schedule: { runAt: now, timezone: "Mars/Space" },
          },
        },
      }).success,
    ).toBe(false);
  });
});
