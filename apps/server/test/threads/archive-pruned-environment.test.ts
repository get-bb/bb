import { environments, getThread } from "@bb/db";
import type { ThreadStatus } from "@bb/domain";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { requestThreadProvision } from "../../src/services/threads/thread-provisioning.js";
import { getThreadProvisionContext } from "../../src/services/threads/thread-startup-store.js";
import { textInput } from "../helpers/prompt-input.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

function seedThreadWithPrunedEnvironment(
  deps: Parameters<typeof seedThread>[0],
) {
  const { host } = seedHostSession(deps);
  const { project } = seedProjectWithSource(deps, { hostId: host.id });
  const environment = seedEnvironment(deps, {
    hostId: host.id,
    projectId: project.id,
    environmentProviderId: "personal-workspace",
    isGitRepo: false,
  });
  const thread = seedThread(deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "idle",
  });
  deps.db.delete(environments).where(eq(environments.id, environment.id)).run();

  const threadAfterPrune = getThread(deps.db, thread.id);
  expect(threadAfterPrune?.environmentId).toBeNull();
  expect(threadAfterPrune?.archivedAt).toBeNull();
  return { thread };
}

function seedPointerlessThread(
  deps: Parameters<typeof seedThread>[0],
  status: ThreadStatus,
) {
  const { host } = seedHostSession(deps);
  const { project } = seedProjectWithSource(deps, { hostId: host.id });
  const thread = seedThread(deps, { projectId: project.id, status });
  if (status === "starting") {
    requestThreadProvision(deps, {
      thread,
      environmentIntent: {
        type: "provider",
        environmentProviderId: "project-checkout",
        machine: { type: "existing", hostId: host.id },
        inputs: {},
        selectionResolved: true,
      },
      execution: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      },
      fork: null,
      input: textInput("start this workspace"),
      startedOnBehalfOf: null,
      titleProvided: true,
    });
    expect(getThreadProvisionContext(deps.db, thread.id)).not.toBeNull();
  }
  return thread;
}

describe("archive without an attached environment", () => {
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

  it.each<ThreadStatus>(["starting", "stopping"])(
    "archives and stops a %s thread that has no environment yet",
    async (status) => {
      await withTestHarness(async (harness) => {
        const thread = seedPointerlessThread(harness.deps, status);
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/archive-all`,
          { method: "POST" },
        );
        expect(response.status).toBe(200);
        expect(await readJson(response)).toEqual({
          ok: true,
          archivedThreadIds: [thread.id],
        });
        expect(getThread(harness.deps.db, thread.id)).toMatchObject({
          archivedAt: expect.any(Number),
          status: "idle",
          environmentId: null,
        });
        expect(
          getThreadProvisionContext(harness.deps.db, thread.id),
        ).toBeNull();
      });
    },
  );
});
