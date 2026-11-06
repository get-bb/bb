import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getThread, listSweepItemFailures } from "@bb/db";
import { threadScope } from "@bb/domain";
import { threadPurgeSweep } from "../../src/services/threads/thread-purge.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedStoredEvent,
  seedThread,
} from "../helpers/seed.js";
import { type TestAppHarness, withTestHarness } from "../helpers/test-app.js";

const API = "/api/v1";

function seedThreadWithEvents(harness: TestAppHarness, count: number) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const thread = seedThread(harness.deps, { projectId: project.id });
  for (let sequence = 1; sequence <= count; sequence++) {
    seedStoredEvent(harness.deps, {
      data: { text: `event ${sequence}` },
      scope: threadScope(),
      sequence,
      threadId: thread.id,
      type: "thread/identity",
    });
  }
  return thread;
}

function countEvents(harness: TestAppHarness, threadId: string): number {
  return (
    harness.db.get<{ count: number }>(
      sql`SELECT count(*) AS count FROM events WHERE thread_id = ${threadId}`,
    )?.count ?? 0
  );
}

function deleteThreadRequest(harness: TestAppHarness, threadId: string) {
  return harness.app.request(`${API}/threads/${threadId}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ childThreadsConfirmed: false }),
  });
}

describe("paced thread deletion", () => {
  it("keeps a deleted thread hidden until the purge sweep deletes its rows", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedThreadWithEvents(harness, 200);

      expect((await deleteThreadRequest(harness, thread.id)).status).toBe(200);
      expect(getThread(harness.db, thread.id)?.deletedAt).toEqual(
        expect.any(Number),
      );
      expect(countEvents(harness, thread.id)).toBe(200);
      expect(
        (await harness.app.request(`${API}/threads/${thread.id}`)).status,
      ).toBe(404);

      await threadPurgeSweep(harness.deps).run(harness.deps, Date.now());
      expect(getThread(harness.db, thread.id)).toBeNull();
      expect(countEvents(harness, thread.id)).toBe(0);
    });
  });

  it("moves past a thread whose purge fails and retries it after the runner's backoff", async () => {
    await withTestHarness(async (harness) => {
      const failing = seedThreadWithEvents(harness, 3);
      const next = seedThreadWithEvents(harness, 3);
      harness.db.run(
        sql.raw(
          `CREATE TEMP TRIGGER fail_purge BEFORE DELETE ON events WHEN old.thread_id = '${failing.id}' BEGIN SELECT RAISE(ABORT, 'simulated purge failure'); END`,
        ),
      );
      expect((await deleteThreadRequest(harness, failing.id)).status).toBe(200);
      expect((await deleteThreadRequest(harness, next.id)).status).toBe(200);
      const now = Date.now();

      await threadPurgeSweep(harness.deps).run(harness.deps, now);
      expect(getThread(harness.db, next.id)).toBeNull();
      expect(countEvents(harness, failing.id)).toBe(3);
      expect(listSweepItemFailures(harness.db, "thread-purge")).toMatchObject([
        {
          attempts: 1,
          itemKey: failing.id,
          lastError: expect.stringContaining("simulated purge failure"),
          retryAt: now + 60_000,
        },
      ]);

      harness.db.run(sql`DROP TRIGGER fail_purge`);
      await threadPurgeSweep(harness.deps).run(harness.deps, now + 59_999);
      expect(countEvents(harness, failing.id)).toBe(3);
      await threadPurgeSweep(harness.deps).run(harness.deps, now + 60_000);
      expect(getThread(harness.db, failing.id)).toBeNull();
      expect(listSweepItemFailures(harness.db, "thread-purge")).toEqual([]);
    });
  });
});
