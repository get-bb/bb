// Regression for get-bb/bb#1924: archiving a thread must succeed after
// pruneDestroyedEnvironments removed its environment row. threads.environment_id
// is ON DELETE SET NULL, so the live thread keeps no environment pointer.
import { environments, getThread, pruneDestroyedEnvironments } from "@bb/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const EIGHT_DAYS_MS = 8 * 24 * 60 * 60_000;

function seedThreadWithPrunedEnvironment(
  deps: Parameters<typeof seedThread>[0],
) {
  const { host } = seedHostSession(deps);
  const { project } = seedProjectWithSource(deps, { hostId: host.id });
  const environment = seedEnvironment(deps, {
    hostId: host.id,
    projectId: project.id,
    managed: true,
    workspaceProvisionType: "managed-worktree",
  });
  const thread = seedThread(deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "idle",
  });
  // The environment was destroyed while the thread stayed unarchived, and the
  // 7-day prune TTL elapsed.
  deps.db
    .update(environments)
    .set({ status: "destroyed", updatedAt: Date.now() - EIGHT_DAYS_MS })
    .where(eq(environments.id, environment.id))
    .run();
  expect(pruneDestroyedEnvironments(deps.db, deps.hub).deleted).toBe(1);

  const threadAfterPrune = getThread(deps.db, thread.id);
  expect(threadAfterPrune?.environmentId).toBeNull();
  expect(threadAfterPrune?.archivedAt).toBeNull();
  return { thread };
}

describe("archive after environment prune", () => {
  it("POST /threads/:id/archive succeeds for a thread whose environment was pruned", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadWithPrunedEnvironment(harness.deps);
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        { method: "POST" },
      );
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({ ok: true });
      expect(getThread(harness.deps.db, thread.id)?.archivedAt).not.toBeNull();
    });
  });

  it("POST /threads/:id/archive-all succeeds for a thread whose environment was pruned", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadWithPrunedEnvironment(harness.deps);
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive-all`,
        { method: "POST" },
      );
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        ok: true,
        archivedThreadIds: [thread.id],
      });
      expect(getThread(harness.deps.db, thread.id)?.archivedAt).not.toBeNull();
    });
  });
});
