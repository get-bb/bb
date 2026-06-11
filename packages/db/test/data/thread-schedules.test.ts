import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import {
  advanceThreadScheduleAfterFireInTransaction,
  advanceThreadScheduleAfterSkipInTransaction,
  createThreadSchedule,
  deleteThreadSchedule,
  disableThreadSchedulesByThread,
  getThreadSchedule,
  listDueThreadSchedules,
  listThreadSchedulesByThread,
  updateThreadSchedule,
} from "../../src/data/thread-schedules.js";
import { createProject, markProjectDeleted } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { upsertHost } from "../../src/data/hosts.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
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
    status: "idle",
  });
  return { db, project, thread };
}

describe("thread schedules", () => {
  it("creates, lists, and updates schedules", () => {
    const { db, project, thread } = setup();
    const now = Date.now();

    const schedule = createThreadSchedule(db, noopNotifier, {
      projectId: project.id,
      threadId: thread.id,
      name: "deploy-check",
      cron: "0 * * * *",
      timezone: "UTC",
      prompt: "Check deployment status.",
      enabled: true,
      nextFireAt: now + 60_000,
    });

    expect(schedule.id).toMatch(/^tsched_/u);
    expect(getThreadSchedule(db, schedule.id)).toMatchObject({
      id: schedule.id,
      kind: "cron",
      name: "deploy-check",
      prompt: "Check deployment status.",
    });
    expect(listThreadSchedulesByThread(db, thread.id)).toHaveLength(1);

    const updated = updateThreadSchedule(db, noopNotifier, schedule.id, {
      cron: "0 */2 * * *",
      prompt: "Check deployment and report useful changes.",
      timezone: "America/Los_Angeles",
    });
    expect(updated).toMatchObject({
      cron: "0 */2 * * *",
      prompt: "Check deployment and report useful changes.",
      timezone: "America/Los_Angeles",
    });
  });

  it("lists due schedules and deletes them", () => {
    const { db, project, thread } = setup();
    const now = Date.now();
    const due = createThreadSchedule(db, noopNotifier, {
      projectId: project.id,
      threadId: thread.id,
      name: "now",
      cron: "0 * * * *",
      timezone: "UTC",
      prompt: "Run now.",
      enabled: true,
      nextFireAt: now - 1,
    });
    createThreadSchedule(db, noopNotifier, {
      projectId: project.id,
      threadId: thread.id,
      name: "later",
      cron: "0 * * * *",
      timezone: "UTC",
      prompt: "Run later.",
      enabled: true,
      nextFireAt: now + 60_000,
    });

    expect(
      listDueThreadSchedules(db, { now, limit: 1 }).map(
        (schedule) => schedule.id,
      ),
    ).toEqual([due.id]);
    expect(deleteThreadSchedule(db, noopNotifier, due.id)).toBe(true);
    expect(deleteThreadSchedule(db, noopNotifier, due.id)).toBe(false);
  });

  it("does not list due schedules for deleted projects", () => {
    const { db, project, thread } = setup();
    const now = Date.now();
    createThreadSchedule(db, noopNotifier, {
      projectId: project.id,
      threadId: thread.id,
      name: "deleted-project",
      cron: "0 * * * *",
      timezone: "UTC",
      prompt: "Do not run after project deletion.",
      enabled: true,
      nextFireAt: now - 1,
    });
    markProjectDeleted(db, noopNotifier, {
      projectId: project.id,
      deletedAt: now,
    });

    expect(listDueThreadSchedules(db, { now })).toEqual([]);
  });

  it("does not advance a schedule after it is disabled", () => {
    const { db, project, thread } = setup();
    const now = Date.now();
    const schedule = createThreadSchedule(db, noopNotifier, {
      projectId: project.id,
      threadId: thread.id,
      name: "disabled-before-fire",
      cron: "0 * * * *",
      timezone: "UTC",
      prompt: "Should not run.",
      enabled: true,
      nextFireAt: now - 1,
    });

    updateThreadSchedule(db, noopNotifier, schedule.id, { enabled: false });
    const advanced = db.transaction(
      (tx) =>
        advanceThreadScheduleAfterFireInTransaction(tx, {
          expectedNextFireAt: schedule.nextFireAt,
          nextFireAt: now + 60_000,
          scheduleId: schedule.id,
          now,
        }),
      { behavior: "immediate" },
    );

    expect(advanced).toBe(false);
    expect(getThreadSchedule(db, schedule.id)).toMatchObject({
      enabled: false,
      lastFiredAt: null,
      nextFireAt: schedule.nextFireAt,
    });
  });

  it("does not advance fired schedules when expected next fire time is stale", () => {
    const { db, project, thread } = setup();
    const now = Date.now();
    const schedule = createThreadSchedule(db, noopNotifier, {
      projectId: project.id,
      threadId: thread.id,
      name: "stale-fire",
      cron: "0 * * * *",
      timezone: "UTC",
      prompt: "Should not run after a race.",
      enabled: true,
      nextFireAt: now - 1,
    });

    const advanced = db.transaction(
      (tx) =>
        advanceThreadScheduleAfterFireInTransaction(tx, {
          expectedNextFireAt: schedule.nextFireAt - 1,
          nextFireAt: now + 60_000,
          scheduleId: schedule.id,
          now,
        }),
      { behavior: "immediate" },
    );

    expect(advanced).toBe(false);
    expect(getThreadSchedule(db, schedule.id)).toMatchObject({
      enabled: true,
      lastFiredAt: null,
      nextFireAt: schedule.nextFireAt,
      updatedAt: schedule.updatedAt,
    });
  });

  it("advances skipped schedules without marking them fired", () => {
    const { db, project, thread } = setup();
    const now = Date.now();
    const schedule = createThreadSchedule(db, noopNotifier, {
      projectId: project.id,
      threadId: thread.id,
      name: "skipped",
      cron: "0 * * * *",
      timezone: "UTC",
      prompt: "Should skip.",
      enabled: true,
      nextFireAt: now - 1,
    });

    const advanced = db.transaction(
      (tx) =>
        advanceThreadScheduleAfterSkipInTransaction(tx, {
          expectedNextFireAt: schedule.nextFireAt,
          nextFireAt: now + 60_000,
          scheduleId: schedule.id,
          now,
        }),
      { behavior: "immediate" },
    );

    expect(advanced).toBe(true);
    expect(getThreadSchedule(db, schedule.id)).toMatchObject({
      lastFiredAt: null,
      nextFireAt: now + 60_000,
    });
  });

  it("does not advance skipped schedules when expected next fire time is stale", () => {
    const { db, project, thread } = setup();
    const now = Date.now();
    const schedule = createThreadSchedule(db, noopNotifier, {
      projectId: project.id,
      threadId: thread.id,
      name: "stale-skip",
      cron: "0 * * * *",
      timezone: "UTC",
      prompt: "Should not skip after a race.",
      enabled: true,
      nextFireAt: now - 1,
    });

    const advanced = db.transaction(
      (tx) =>
        advanceThreadScheduleAfterSkipInTransaction(tx, {
          expectedNextFireAt: schedule.nextFireAt - 1,
          nextFireAt: now + 60_000,
          scheduleId: schedule.id,
          now,
        }),
      { behavior: "immediate" },
    );

    expect(advanced).toBe(false);
    expect(getThreadSchedule(db, schedule.id)).toMatchObject({
      enabled: true,
      lastFiredAt: null,
      nextFireAt: schedule.nextFireAt,
      updatedAt: schedule.updatedAt,
    });
  });

  it("disables enabled schedules for a thread without deleting them", () => {
    const { db, project, thread } = setup();
    const now = Date.now();
    const enabled = createThreadSchedule(db, noopNotifier, {
      projectId: project.id,
      threadId: thread.id,
      name: "enabled",
      cron: "0 * * * *",
      timezone: "UTC",
      prompt: "Disable me.",
      enabled: true,
      nextFireAt: now + 60_000,
    });
    const alreadyDisabled = createThreadSchedule(db, noopNotifier, {
      projectId: project.id,
      threadId: thread.id,
      name: "disabled",
      cron: "0 * * * *",
      timezone: "UTC",
      prompt: "Keep disabled.",
      enabled: false,
      nextFireAt: now + 60_000,
    });

    expect(
      disableThreadSchedulesByThread(db, noopNotifier, {
        now,
        projectId: project.id,
        threadId: thread.id,
      }),
    ).toBe(1);

    expect(getThreadSchedule(db, enabled.id)).toMatchObject({
      enabled: false,
      prompt: "Disable me.",
    });
    expect(getThreadSchedule(db, alreadyDisabled.id)).toMatchObject({
      enabled: false,
      prompt: "Keep disabled.",
    });
    expect(listThreadSchedulesByThread(db, thread.id)).toHaveLength(2);
  });
});
