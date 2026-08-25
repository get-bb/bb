import { describe, expect, it } from "vitest";
import type { DispatchHoldPayload } from "@bb/domain";
import { noopNotifier } from "../../src/notifier.js";
import {
  createDispatchHold,
  getDispatchHold,
  listDispatchHolds,
  listDueDispatchHolds,
  listStaleDispatchHolds,
  releaseDispatchHold,
  updateDispatchHoldPayload,
  updateDispatchHoldReport,
  type CreateDispatchHoldInput,
} from "../../src/data/dispatch-holds.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

function inlinePayload(text: string): DispatchHoldPayload {
  return {
    kind: "inline",
    input: [{ type: "text", text, mentions: [] }],
    execution: {
      model: "gpt-5",
      serviceTier: "default",
      reasoningLevel: "medium",
      permissionMode: "full",
      source: "client/turn/requested",
    },
    pluginInputs: {},
  };
}

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });

  function hold(
    overrides: Partial<CreateDispatchHoldInput> = {},
  ): ReturnType<typeof createDispatchHold> {
    return createDispatchHold(db, {
      kind: "turn",
      threadId: thread.id,
      payload: inlinePayload("hello"),
      holder: "user",
      userReleasable: true,
      reason: "Scheduled",
      resumeAt: null,
      amend: null,
      originalRequest: null,
      effectiveRequest: null,
      expectedReleaseAt: null,
      staleAfterMs: null,
      ...overrides,
    });
  }

  return { db, project, thread, hold };
}

describe("dispatch holds", () => {
  it("releases exactly once when a timer and a user race", () => {
    const { db, hold } = setup();
    const row = hold({ resumeAt: 1_000 });

    const timerWon = releaseDispatchHold(db, {
      id: row.id,
      releaseKind: "timer",
      releasedAt: 1_000,
    });
    const userWon = releaseDispatchHold(db, {
      id: row.id,
      releaseKind: "user",
      releasedAt: 1_050,
    });

    expect(timerWon).toBe(true);
    expect(userWon).toBe(false);
    const released = getDispatchHold(db, row.id);
    expect(released?.releaseKind).toBe("timer");
    expect(released?.releasedAt).toBe(1_000);
  });

  it("treats a resumeAt of exactly now as due and skips released holds", () => {
    const { db, hold } = setup();
    const due = hold({ resumeAt: 5_000 });
    const notYet = hold({ resumeAt: 5_001 });
    const alreadyReleased = hold({ resumeAt: 4_000 });
    const noTimer = hold({ resumeAt: null });
    releaseDispatchHold(db, {
      id: alreadyReleased.id,
      releaseKind: "owner",
      releasedAt: 4_500,
    });

    const dueIds = listDueDispatchHolds(db, 5_000).map((row) => row.id);

    expect(dueIds).toEqual([due.id]);
    expect(dueIds).not.toContain(notYet.id);
    expect(dueIds).not.toContain(noTimer.id);
  });

  it("filters by thread, holder and liveness", () => {
    const { db, project, hold } = setup();
    const otherThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const live = hold({ holder: "plugin:concurrency-limit" });
    const releasedRow = hold({ holder: "plugin:concurrency-limit" });
    const otherHolder = hold({ holder: "core:reprovision" });
    const otherThreadHold = hold({
      threadId: otherThread.id,
      holder: "plugin:concurrency-limit",
    });
    releaseDispatchHold(db, {
      id: releasedRow.id,
      releaseKind: "owner",
      releasedAt: 10,
    });

    // Holds created in the same millisecond tie on `createdAt` and break the
    // tie on a random id, so compare membership rather than order here.
    const allForThread = new Set(
      listDispatchHolds(db, { threadId: live.threadId }).map((row) => row.id),
    );
    const liveForHolder = new Set(
      listDispatchHolds(db, {
        holder: "plugin:concurrency-limit",
        liveOnly: true,
      }).map((row) => row.id),
    );

    expect(allForThread).toEqual(
      new Set([live.id, releasedRow.id, otherHolder.id]),
    );
    expect(liveForHolder).toEqual(new Set([live.id, otherThreadHold.id]));
  });

  it("refuses payload edits and reports once the hold is released", () => {
    const { db, hold } = setup();
    const row = hold({ staleAfterMs: 60_000 });
    releaseDispatchHold(db, {
      id: row.id,
      releaseKind: "user",
      releasedAt: 20,
    });

    const edited = updateDispatchHoldPayload(db, {
      id: row.id,
      payload: inlinePayload("edited"),
    });
    const reported = updateDispatchHoldReport(db, {
      id: row.id,
      reportedAt: 30,
      reason: "still working",
    });

    expect(edited).toBe(false);
    expect(reported).toBe(false);
    const stored = getDispatchHold(db, row.id);
    expect(stored?.payload).toBe(JSON.stringify(inlinePayload("hello")));
    expect(stored?.reason).toBe("Scheduled");
    expect(stored?.lastReportAt).toBeNull();
  });

  it("edits a live hold's payload and heartbeats a bare report", () => {
    const { db, hold } = setup();
    const row = hold();

    expect(
      updateDispatchHoldPayload(db, {
        id: row.id,
        payload: inlinePayload("edited"),
      }),
    ).toBe(true);
    expect(updateDispatchHoldReport(db, { id: row.id, reportedAt: 40 })).toBe(
      true,
    );

    const stored = getDispatchHold(db, row.id);
    expect(stored?.payload).toBe(JSON.stringify(inlinePayload("edited")));
    expect(stored?.lastReportAt).toBe(40);
    // A bare heartbeat must not clear the fields it did not mention.
    expect(stored?.reason).toBe("Scheduled");
  });

  it("measures staleness from the last report, or from creation before any", () => {
    const { db, hold } = setup();
    const neverReported = hold({ staleAfterMs: 1 });
    const reported = hold({ staleAfterMs: 60_000 });
    const noStaleWindow = hold({ staleAfterMs: null });
    updateDispatchHoldReport(db, {
      id: reported.id,
      reportedAt: Date.now(),
    });

    const staleIds = listStaleDispatchHolds(db, Date.now() + 1_000).map(
      (row) => row.id,
    );

    expect(staleIds).toContain(neverReported.id);
    expect(staleIds).not.toContain(reported.id);
    expect(staleIds).not.toContain(noStaleWindow.id);
  });
});
