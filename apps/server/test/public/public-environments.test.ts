import { describe, expect, it } from "vitest";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public environments", () => {
  it("renames an environment through the public update route", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        workspaceProvisionType: "managed-worktree",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "  Review workspace  " }),
        },
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        id: environment.id,
        name: "Review workspace",
      });
    });
  });

  it("rejects empty environment updates", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/environments/env_missing",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("lists workspace paths via host.list_paths for a personal-workspace environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-paths",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      // A "personal" workspace is exactly what a projectless thread runs in.
      // The project-scoped /projects/:id/paths route would reject it; the
      // environment-scoped route serves it because it never consults the project.
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/personal-workspace",
        workspaceProvisionType: "personal",
      });

      const pathsPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/paths?query=app&includeFiles=true&includeDirectories=false`,
      );
      const pathsCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === "/tmp/personal-workspace",
      );
      expect(pathsCommand.command).toMatchObject({
        path: "/tmp/personal-workspace",
        query: "app",
        includeFiles: true,
        includeDirectories: false,
      });
      await reportQueuedCommandSuccess(harness, pathsCommand, {
        paths: [
          {
            kind: "file",
            path: "src/app.ts",
            name: "app.ts",
            score: 80,
            positions: [0, 1, 2],
          },
        ],
        truncated: false,
      });

      const pathsResponse = await pathsPromise;
      expect(pathsResponse.status).toBe(200);
      await expect(readJson(pathsResponse)).resolves.toEqual({
        paths: [
          {
            kind: "file",
            path: "src/app.ts",
            name: "app.ts",
            score: 80,
            positions: [0, 1, 2],
          },
        ],
        truncated: false,
      });
    });
  });

  it("returns not-ready for workspace path search on an unprovisioned environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-paths-pending",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        status: "provisioning",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/paths?query=app&includeFiles=true&includeDirectories=false`,
      );

      expect(response.status).toBe(409);
    });
  });
});
