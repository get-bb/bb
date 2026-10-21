import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createConnection,
  events,
  pendingInteractions,
  projects,
  queuedThreadMessages,
  threads,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { systemLapsedResumeResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";
import {
  getSystemLapsedResume,
  openSystemLapsedResume,
} from "../../src/services/system/lapsed-resume.js";

const DAY = 24 * 60 * 60 * 1_000;
const NOW = 2_000_000_000_000;
const connections: DbConnection[] = [];

afterEach(() => {
  for (const db of connections.splice(0)) db.$client.close();
});

function setup() {
  const db = createMigratedConnection();
  connections.push(db);
  db.insert(projects)
    .values({
      id: "project",
      name: "Project",
      createdAt: NOW - 30 * DAY,
      updatedAt: NOW - 30 * DAY,
    })
    .run();
  return db;
}

function addThread(db: DbConnection, id = "thread", at = NOW - 20 * DAY) {
  db.insert(threads)
    .values({
      id,
      projectId: "project",
      providerId: "codex",
      title: id,
      status: "idle",
      createdAt: at,
      updatedAt: at,
      lastReadAt: at,
      latestAttentionAt: at,
    })
    .run();
}

function addTurn(
  db: DbConnection,
  threadId = "thread",
  startedAt = NOW - 20 * DAY,
  completedAt = startedAt,
) {
  db.insert(events)
    .values([
      {
        id: `${threadId}-request`,
        threadId,
        sequence: 1,
        scopeKind: "thread",
        type: "client/turn/requested",
        data: JSON.stringify({ initiator: "user" }),
        createdAt: startedAt,
      },
      {
        id: `${threadId}-start`,
        threadId,
        sequence: 2,
        scopeKind: "turn",
        turnId: "turn",
        type: "turn/started",
        createdAt: startedAt,
      },
      {
        id: `${threadId}-finish`,
        threadId,
        sequence: 3,
        scopeKind: "turn",
        turnId: "turn",
        type: "turn/completed",
        createdAt: completedAt,
      },
    ])
    .run();
}

function addWaiting(db: DbConnection, threadId: string, at = NOW - 20 * DAY) {
  db.insert(pendingInteractions)
    .values({
      id: `${threadId}-interaction`,
      threadId,
      status: "pending",
      payload: "{}",
      createdAt: at,
      updatedAt: at,
    })
    .run();
}

describe("lapsed resume", () => {
  it("does not treat an install without thread history as lapsed", () => {
    const db = setup();
    expect(openSystemLapsedResume(db, NOW)).toEqual({
      lapsed: false,
      lastActivityAt: null,
      target: null,
      threads: [],
      suggestionAnalyticsId: null,
    });
    expect(openSystemLapsedResume(db, NOW + 30 * DAY).lapsed).toBe(false);
  });

  it("includes exactly fourteen days and lets reads inspect without claiming", () => {
    const db = setup();
    addThread(db, "thread", NOW - 14 * DAY);
    addTurn(db, "thread", NOW - 14 * DAY);
    expect(getSystemLapsedResume(db, NOW - 1).lapsed).toBe(false);
    const state = getSystemLapsedResume(db, NOW);
    expect(state.lapsed).toBe(true);
    expect(state.lastActivityAt).toBe(NOW - 14 * DAY);
    expect(state.target).toEqual({ threadId: "thread", projectId: "project" });
    expect(state.suggestionAnalyticsId).toBeNull();
    expect(getSystemLapsedResume(db, NOW)).toEqual(state);
  });

  it("claims once across repeated opens and a server restart, allowing a later lapse", () => {
    const db = setup();
    addThread(db);
    addTurn(db);
    const first = openSystemLapsedResume(db, NOW);
    expect(first.lapsed).toBe(true);
    expect(first.suggestionAnalyticsId).toEqual(expect.any(String));
    expect(openSystemLapsedResume(db, NOW).lapsed).toBe(false);
    const restarted = createConnection(db.$client.serialize());
    connections.push(restarted);
    expect(openSystemLapsedResume(restarted, NOW + DAY).lapsed).toBe(false);
    const next = openSystemLapsedResume(restarted, NOW + 15 * DAY);
    expect(next.lapsed).toBe(true);
    expect(next.suggestionAnalyticsId).not.toBe(first.suggestionAnalyticsId);
  });

  it("counts recent reads, thread changes, agent events and pending responses as activity", () => {
    for (const activity of [
      "read",
      "thread",
      "event",
      "interaction",
    ] as const) {
      const db = setup();
      addThread(db);
      addTurn(db);
      if (activity === "read") {
        db.update(threads)
          .set({ lastReadAt: NOW - DAY })
          .run();
      } else if (activity === "thread") {
        db.update(threads)
          .set({ updatedAt: NOW - DAY })
          .run();
      } else if (activity === "event") {
        db.update(events)
          .set({ createdAt: NOW - DAY })
          .where(eq(events.id, "thread-finish"))
          .run();
      } else {
        addWaiting(db, "thread", NOW - DAY);
      }
      expect(getSystemLapsedResume(db, NOW).lapsed, activity).toBe(false);
    }
  });

  it("counts recent activity in hidden or deleted work without selecting it", () => {
    const db = setup();
    addThread(db);
    addTurn(db);
    addThread(db, "hidden", NOW - DAY);
    db.update(threads)
      .set({ visibility: "hidden", deletedAt: NOW - DAY })
      .where(eq(threads.id, "hidden"))
      .run();
    expect(getSystemLapsedResume(db, NOW).lapsed).toBe(false);
  });

  it("chooses the most recently used unfinished thread, including a pending interaction", () => {
    const db = setup();
    addThread(db, "older", NOW - 25 * DAY);
    addTurn(db, "older", NOW - 25 * DAY, NOW - 15 * DAY);
    addThread(db, "waiting", NOW - 20 * DAY);
    addWaiting(db, "waiting");
    db.update(threads)
      .set({ status: "active" })
      .where(eq(threads.id, "waiting"))
      .run();
    expect(getSystemLapsedResume(db, NOW).target?.threadId).toBe("waiting");
  });

  it.each(["archived", "deleted", "hidden", "deleted-project"])(
    "excludes %s threads from both target and sidebar",
    (filter) => {
      const db = setup();
      addThread(db);
      addWaiting(db, "thread");
      if (filter === "archived") {
        db.update(threads)
          .set({ archivedAt: NOW - 19 * DAY })
          .run();
      } else if (filter === "deleted") {
        db.update(threads)
          .set({ deletedAt: NOW - 19 * DAY })
          .run();
      } else if (filter === "hidden") {
        db.update(threads).set({ visibility: "hidden" }).run();
      } else {
        db.update(projects)
          .set({ deletedAt: NOW - 19 * DAY })
          .run();
      }
      const state = openSystemLapsedResume(db, NOW);
      expect(state.lapsed).toBe(true);
      expect(state.target).toBeNull();
      expect(state.threads).toEqual([]);
      expect(state.suggestionAnalyticsId).toBeNull();
      expect(openSystemLapsedResume(db, NOW).lapsed).toBe(false);
    },
  );

  it("keeps home when old threads have no completed turn or pending interaction", () => {
    const db = setup();
    addThread(db);
    const state = openSystemLapsedResume(db, NOW);
    expect(state.lapsed).toBe(true);
    expect(state.target).toBeNull();
    expect(state.suggestionAnalyticsId).toBeNull();
  });

  it("does not resume a completed turn after a later reply or a new active turn", () => {
    for (const type of ["client/turn/requested", "turn/started"] as const) {
      const db = setup();
      addThread(db);
      addTurn(db);
      db.insert(events)
        .values({
          id: "new-turn",
          threadId: "thread",
          sequence: 4,
          scopeKind: type === "turn/started" ? "turn" : "thread",
          turnId: type === "turn/started" ? "new-turn" : null,
          type,
          createdAt: NOW - 18 * DAY,
        })
        .run();
      expect(getSystemLapsedResume(db, NOW).target, type).toBeNull();
    }
  });

  it("does not mistake a completed child turn for a finished root turn", () => {
    const db = setup();
    addThread(db);
    addTurn(db);
    db.update(events)
      .set({ parentToolCallId: "parent-tool" })
      .where(eq(events.id, "thread-start"))
      .run();
    expect(getSystemLapsedResume(db, NOW).target).toBeNull();
  });

  it("counts a queued reply as activity and does not select its completed turn", () => {
    const db = setup();
    addThread(db);
    addTurn(db);
    db.insert(queuedThreadMessages)
      .values({
        id: "queued",
        threadId: "thread",
        content: "Continue",
        model: "model",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
        state: "queued",
        sortKey: "V",
        createdAt: NOW - DAY,
        updatedAt: NOW - DAY,
      })
      .run();
    expect(getSystemLapsedResume(db, NOW).lapsed).toBe(false);
    const later = getSystemLapsedResume(db, NOW + 14 * DAY);
    expect(later.lapsed).toBe(true);
    expect(later.target).toBeNull();
  });

  it("lists pending requests and results finished after presence, capped at eight", () => {
    const db = setup();
    addThread(db, "old-result", NOW - 25 * DAY);
    addTurn(db, "old-result", NOW - 25 * DAY);
    addThread(db, "new-result", NOW - 20 * DAY);
    addTurn(db, "new-result", NOW - 20 * DAY, NOW - 15 * DAY);
    addThread(db, "waiting");
    addWaiting(db, "waiting");
    expect(getSystemLapsedResume(db, NOW).threads).toEqual([
      {
        threadId: "waiting",
        projectId: "project",
        title: "waiting",
        status: "idle",
        reason: "waiting",
      },
      {
        threadId: "new-result",
        projectId: "project",
        title: "new-result",
        status: "idle",
        reason: "finished",
      },
    ]);
    for (let index = 0; index < 10; index += 1) {
      const id = `waiting-${index}`;
      addThread(db, id);
      addWaiting(db, id);
    }
    expect(getSystemLapsedResume(db, NOW).threads).toHaveLength(8);
  });

  it("ignores an expired pending interaction", () => {
    const db = setup();
    addThread(db);
    addWaiting(db, "thread");
    db.update(pendingInteractions)
      .set({ expiresAt: NOW - DAY })
      .run();
    expect(getSystemLapsedResume(db, NOW).target).toBeNull();
    expect(getSystemLapsedResume(db, NOW).threads).toEqual([]);
  });

  it("serves uncached inspection and gives simultaneous app opens one claim", async () => {
    await withTestHarness(async (harness) => {
      const at = Date.now() - 20 * DAY;
      harness.db
        .insert(projects)
        .values({
          id: "project",
          name: "Project",
          createdAt: at,
          updatedAt: at,
        })
        .run();
      addThread(harness.db, "thread", at);
      addTurn(harness.db, "thread", at);
      const read = await harness.app.request("/api/v1/system/lapsed-resume");
      expect(read.status).toBe(200);
      expect(read.headers.get("cache-control")).toBe("no-store");
      expect(
        systemLapsedResumeResponseSchema.parse(await readJson(read)).lapsed,
      ).toBe(true);
      const responses = await Promise.all([
        harness.app.request("/api/v1/system/lapsed-resume/open", {
          method: "POST",
        }),
        harness.app.request("/api/v1/system/lapsed-resume/open", {
          method: "POST",
        }),
      ]);
      const states = await Promise.all(
        responses.map(async (response) => {
          expect(response.status).toBe(200);
          expect(response.headers.get("cache-control")).toBe("no-store");
          return systemLapsedResumeResponseSchema.parse(
            await readJson(response),
          );
        }),
      );
      expect(states.filter((state) => state.lapsed)).toHaveLength(1);
      expect(
        states.filter((state) => state.suggestionAnalyticsId !== null),
      ).toHaveLength(1);
    });
  });
});
