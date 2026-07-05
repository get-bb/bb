import { z } from "zod";
import { describe, expect, it } from "vitest";
import { setExperiments } from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedHost,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const projectResponseSchema = z.object({
  id: z.string(),
  sources: z.array(
    z.object({
      id: z.string(),
      path: z.string().nullable().optional(),
    }),
  ),
});

describe("public project local host routes", () => {
  it("supports local project source updates and allows secondary host sources", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-source-1" });
      seedPrimaryHost(harness.deps, host.id);
      const secondaryHost = seedHost(harness.deps, { id: "host-source-2" });
      // Targeting a non-primary host requires the multi-machine experiment.
      setExperiments(harness.db, { ...defaultExperiments, multiMachine: true });

      const projectResponse = await harness.app.request("/api/v1/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Project Sources",
          source: {
            type: "local_path",
            hostId: host.id,
            path: "/tmp/project-sources",
          },
        }),
      });
      const project = projectResponseSchema.parse(
        await readJson(projectResponse),
      );
      const defaultSourceId = project.sources[0]?.id;
      expect(defaultSourceId).toBeTruthy();

      const createSourceResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/sources`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            hostId: secondaryHost.id,
            path: "/tmp/project-sources-2",
            type: "local_path",
          }),
        },
      );
      // Multi-host: a project may register a source on any known host, not just
      // the primary. Connectivity is enforced later at dispatch, not here.
      expect(createSourceResponse.status).toBe(201);
      await expect(readJson(createSourceResponse)).resolves.toMatchObject({
        hostId: secondaryHost.id,
        path: "/tmp/project-sources-2",
        type: "local_path",
      });

      const updateSourceResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/sources/${defaultSourceId}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            type: "local_path",
            path: "/tmp/project-sources-renamed",
          }),
        },
      );
      expect(updateSourceResponse.status).toBe(200);
      await expect(readJson(updateSourceResponse)).resolves.toMatchObject({
        id: defaultSourceId,
        path: "/tmp/project-sources-renamed",
      });

      // With the secondary-host source added above the project now has two
      // sources, so deleting one succeeds (the last-source guard no longer
      // applies).
      const deleteSourceResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/sources/${defaultSourceId}`,
        {
          method: "DELETE",
        },
      );
      expect(deleteSourceResponse.status).toBe(200);
    });
  });

  it("serves project source file content from the local primary source", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-file-content",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-file-content",
      });

      const filePromise = harness.app.request(
        `/api/v1/projects/${project.id}/files/content?path=${encodeURIComponent("src/app.ts")}`,
      );
      const fileCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.read_file" &&
          command.path === "/tmp/project-file-content/src/app.ts",
      );
      expect(fileCommand.command).toMatchObject({
        path: "/tmp/project-file-content/src/app.ts",
        rootPath: "/tmp/project-file-content",
      });
      await reportQueuedCommandSuccess(harness, fileCommand, {
        path: "/tmp/project-file-content/src/app.ts",
        content: "console.log('ok');",
        contentEncoding: "utf8",
        mimeType: "application/typescript",
        sizeBytes: 18,
        sha256: "0".repeat(64),
      });

      const fileResponse = await filePromise;
      expect(fileResponse.status).toBe(200);
      expect(fileResponse.headers.get("content-type")).toContain(
        "application/typescript",
      );
      await expect(fileResponse.text()).resolves.toBe("console.log('ok');");
    });
  });
});
