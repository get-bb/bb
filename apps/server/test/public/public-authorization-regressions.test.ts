import { eq } from "drizzle-orm";
import {
  createProject,
  environments,
  getQueuedThreadMessage,
  projectSources,
  threads,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedQueuedMessage,
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public authorization regressions", () => {
  it("does not delete a project source through another project route", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-source-delete",
      });
      const { project: projectA } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/source-delete-a",
      });
      const { project: projectB, source: sourceB } = seedProjectWithSource(
        harness.deps,
        {
          hostId: host.id,
          path: "/tmp/source-delete-b",
        },
      );

      const response = await harness.app.request(
        `/api/v1/projects/${projectA.id}/sources/${sourceB.id}`,
        {
          method: "DELETE",
        },
      );

      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(
        harness.db
          .select()
          .from(projectSources)
          .where(eq(projectSources.id, sourceB.id))
          .get(),
      ).toMatchObject({
        id: sourceB.id,
        projectId: projectB.id,
        path: "/tmp/source-delete-b",
      });
    });
  });

  it("does not update a project source through another project route", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-source-update",
      });
      const { project: projectA } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/source-update-a",
      });
      const { source: sourceB } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/original",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${projectA.id}/sources/${sourceB.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "local_path", path: "/hacked" }),
        },
      );

      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(
        harness.db
          .select()
          .from(projectSources)
          .where(eq(projectSources.id, sourceB.id))
          .get()?.path,
      ).toBe("/original");
    });
  });

  it("validates managed workspace requirements before inserting environment or thread rows", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-managed-check",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { host: sourceHost } = seedHostSession(harness.deps, {
        id: "host-managed-check-source",
      });
      const { project } = createProject(harness.db, harness.hub, {
        name: "Project Without Matching Host Source",
        source: {
          type: "local_path",
          hostId: sourceHost.id,
          path: "/tmp/managed-check-source",
        },
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "Create the child thread" }],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "managed-worktree",
              baseBranch: { kind: "default" },
            },
          },
        }),
      });

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(
        harness.db
          .select()
          .from(environments)
          .where(eq(environments.projectId, project.id))
          .all(),
      ).toHaveLength(0);
      expect(
        harness.db
          .select()
          .from(threads)
          .where(eq(threads.projectId, project.id))
          .all(),
      ).toHaveLength(0);
    });
  });

  it("does not delete a queued message through another thread route", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-queued-message-delete",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const threadA = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const threadB = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      seedQueuedMessage(harness.deps, {
        threadId: threadA.id,
        content: textInput("Queued message A"),
      });
      const queuedMessageB = seedQueuedMessage(harness.deps, {
        threadId: threadB.id,
        content: textInput("Queued message B"),
      });

      const response = await harness.app.request(
        `/api/v1/threads/${threadA.id}/queued-messages/${queuedMessageB.id}`,
        {
          method: "DELETE",
        },
      );

      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(
        getQueuedThreadMessage(harness.db, queuedMessageB.id),
      ).toMatchObject({
        id: queuedMessageB.id,
        threadId: threadB.id,
      });
    });
  });
});
