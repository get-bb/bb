import { getThread } from "@bb/db";
import { threadSchema } from "@bb/domain";
import {
  apiErrorSchema,
  threadArchiveAllResponseSchema,
  threadChildSummaryResponseSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public thread parenting routes", () => {
  it("creates a child thread under a parent", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const parentThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        inputText: "Coordinate child work",
        providerThreadId: "provider-parent-create-child",
        threadId: parentThread.id,
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "Create child work" }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
          parentThreadId: parentThread.id,
        }),
      });

      expect(response.status).toBe(201);
      const createdThread = threadSchema.parse(await readJson(response));
      expect(createdThread.parentThreadId).toBe(parentThread.id);
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "turn.submit" && command.threadId === parentThread.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    });
  });

  it("assigns a parent to an existing thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const parentThread = seedThread(harness.deps, {
        projectId: project.id,
      });
      const childThread = seedThread(harness.deps, {
        projectId: project.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${childThread.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parentThreadId: parentThread.id }),
        },
      );

      expect(response.status).toBe(200);
      const updatedThread = threadSchema.parse(await readJson(response));
      expect(updatedThread.parentThreadId).toBe(parentThread.id);
    });
  });

  it("returns child summary for a parent", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const parentThread = seedThread(harness.deps, {
        projectId: project.id,
      });
      seedThread(harness.deps, {
        parentThreadId: parentThread.id,
        projectId: project.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${parentThread.id}/child-summary`,
      );

      expect(response.status).toBe(200);
      const summary = threadChildSummaryResponseSchema.parse(
        await readJson(response),
      );
      expect(summary.nonDeletedChildCount).toBe(1);
    });
  });

  it("requires delete confirmation for a parent with children", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const parentThread = seedThread(harness.deps, {
        projectId: project.id,
      });
      seedThread(harness.deps, {
        parentThreadId: parentThread.id,
        projectId: project.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${parentThread.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ childThreadsConfirmed: false }),
        },
      );

      expect(response.status).toBe(409);
      const error = apiErrorSchema.parse(await readJson(response));
      expect(error).toMatchObject({
        code: "child_threads_confirmation_required",
      });
    });
  });

  it("archives a parent and its child threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const parentThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const childThread = seedThread(harness.deps, {
        environmentId: environment.id,
        parentThreadId: parentThread.id,
        projectId: project.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${parentThread.id}/archive-all`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      const archiveResult = threadArchiveAllResponseSchema.parse(
        await readJson(response),
      );
      expect(archiveResult.archivedThreadIds).toEqual([
        childThread.id,
        parentThread.id,
      ]);
      expect(getThread(harness.db, parentThread.id)?.archivedAt).not.toBeNull();
      const archivedChildThread = getThread(harness.db, childThread.id);
      expect(archivedChildThread?.archivedAt).not.toBeNull();
      expect(archivedChildThread?.parentThreadId).toBe(parentThread.id);
    });
  });
});
