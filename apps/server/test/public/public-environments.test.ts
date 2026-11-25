import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createProjectSourceFolder,
  getEnvironment,
  setEnvironmentColumns,
  threads,
} from "@bb/db";
import {
  registerTestHostRpcCapture,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
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
        environmentProviderId: "git-worktree",
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
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/personal-workspace",
        environmentProviderId: "personal-workspace",
        isGitRepo: false,
      });

      const pathsPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/paths?query=app&includeFiles=true&includeDirectories=false`,
      );
      const pathsCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.rootPaths[0] === "/tmp/personal-workspace",
      );
      expect(pathsCommand.command).toMatchObject({
        rootPaths: ["/tmp/personal-workspace"],
        followRootSymlink: true,
        query: "app",
        includeFiles: true,
        includeDirectories: false,
        includeHidden: true,
        respectGitIgnore: true,
        excludeNames: [
          "node_modules",
          ".pnpm-store",
          ".claude/worktrees",
          ".venv",
          "venv",
          ".turbo",
          ".next",
          ".cache",
          "__pycache__",
          ".DS_Store",
        ],
      });
      await reportQueuedCommandSuccess(harness, pathsCommand, {
        paths: [
          {
            kind: "file",
            path: "src/app.ts",
            name: "app.ts",
            score: 80,
            positions: [0, 1, 2],
            rootPath: "/tmp/personal-workspace",
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
            folderPath: null,
          },
        ],
        truncated: false,
      });
    });
  });

  it("searches the project's and the environment's folders in one host search and says which folder each result is from", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-environment-paths-folders",
      });
      const searched: string[][] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          if (command.type !== "host.list_paths") {
            throw new Error(`Unexpected RPC ${command.type}`);
          }
          searched.push(command.rootPaths);
          return {
            ok: true,
            result: {
              paths: command.rootPaths.map((rootPath) => ({
                kind: "file" as const,
                path: "src/app.ts",
                name: "app.ts",
                score: 50,
                positions: [],
                rootPath,
              })),
              truncated: true,
            },
          };
        },
      });
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/work/app",
      });
      createProjectSourceFolder(harness.db, harness.hub, {
        projectId: project.id,
        projectSourceId: source.id,
        path: "/work/api",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/work/app",
      });
      setEnvironmentColumns(harness.db, environment.id, {
        additionalPaths: [{ path: "/work/extra", replaces: null }],
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/paths?query=app&includeFiles=true&includeDirectories=false`,
      );

      expect(response.status).toBe(200);
      expect(searched).toEqual([["/work/app", "/work/api", "/work/extra"]]);
      await expect(readJson(response)).resolves.toEqual({
        paths: [
          expect.objectContaining({ path: "src/app.ts", folderPath: null }),
          expect.objectContaining({
            path: "src/app.ts",
            folderPath: "/work/api",
          }),
          expect.objectContaining({
            path: "src/app.ts",
            folderPath: "/work/extra",
          }),
        ],
        truncated: true,
      });

      for (const [folders, expected] of [
        ["main", ["/work/app"]],
        ["extra", ["/work/api", "/work/extra"]],
      ] as const) {
        searched.length = 0;
        const scoped = await harness.app.request(
          `/api/v1/environments/${environment.id}/paths?query=app&includeFiles=true&includeDirectories=false&folders=${folders}`,
        );
        expect(scoped.status).toBe(200);
        expect(searched).toEqual([expected]);
      }
    });
  });

  it("answers an extra-folders search with no extra folders without calling the host", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-environment-paths-no-extra",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          throw new Error(`Unexpected RPC ${command.type}`);
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/work/app",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/work/app",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/paths?query=app&includeFiles=true&includeDirectories=false&folders=extra`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        paths: [],
        truncated: false,
      });
    });
  });

  it("searches the project's folders for the chosen machine before a thread has an environment", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-project-paths-folders",
      });
      const searched: string[][] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          if (command.type !== "host.list_paths") {
            throw new Error(`Unexpected RPC ${command.type}`);
          }
          searched.push(command.rootPaths);
          return {
            ok: true,
            result: {
              paths: command.rootPaths.map((rootPath) => ({
                kind: "file" as const,
                path: "README.md",
                name: "README.md",
                score: 50,
                positions: [],
                rootPath,
              })),
              truncated: false,
            },
          };
        },
      });
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/work/app",
      });
      createProjectSourceFolder(harness.db, harness.hub, {
        projectId: project.id,
        projectSourceId: source.id,
        path: "/work/docs",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/paths?hostId=${host.id}&query=readme&includeFiles=true&includeDirectories=true`,
      );

      expect(response.status).toBe(200);
      expect(searched).toEqual([["/work/app", "/work/docs"]]);
      await expect(readJson(response)).resolves.toMatchObject({
        paths: [
          { path: "README.md", folderPath: null },
          { path: "README.md", folderPath: "/work/docs" },
        ],
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

describe("environment list and delete", () => {
  it("lists non-destroyed environments, scoped to a project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-env-list" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const { project: other } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/env-list-other",
      });
      const mine = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/env-list-a",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: other.id,
        path: "/tmp/env-list-b",
      });

      const scoped = (await readJson(
        await harness.app.request(
          `/api/v1/environments?projectId=${project.id}`,
        ),
      )) as Array<{ id: string }>;
      expect(scoped.map((environment) => environment.id)).toEqual([mine.id]);

      const everything = (await readJson(
        await harness.app.request("/api/v1/environments"),
      )) as Array<{ id: string }>;
      expect(everything.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("pages the list with limit and offset", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-env-page" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const ids = ["a", "b", "c"].map(
        (suffix) =>
          seedEnvironment(harness.deps, {
            hostId: host.id,
            projectId: project.id,
            path: `/tmp/env-page-${suffix}`,
          }).id,
      );

      const firstPage = (await readJson(
        await harness.app.request(
          `/api/v1/environments?projectId=${project.id}&limit=2`,
        ),
      )) as Array<{ id: string }>;
      expect(firstPage).toHaveLength(2);

      const secondPage = (await readJson(
        await harness.app.request(
          `/api/v1/environments?projectId=${project.id}&limit=2&offset=2`,
        ),
      )) as Array<{ id: string }>;
      expect(secondPage).toHaveLength(1);
      expect([...firstPage, ...secondPage].map((row) => row.id).sort()).toEqual(
        [...ids].sort(),
      );

      const rejected = await harness.app.request(
        `/api/v1/environments?projectId=${project.id}&limit=0`,
      );
      expect(rejected.status).toBe(400);
    });
  });

  it("narrows the list by provider, machine and status in one query", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-env-filter" });
      const { host: otherHost } = seedHostSession(harness.deps, {
        id: "host-env-filter-other",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const worktree = seedEnvironment(harness.deps, {
        environmentProviderId: "git-worktree",
        hostId: host.id,
        path: "/tmp/env-filter-worktree",
        projectId: project.id,
      });
      seedEnvironment(harness.deps, {
        environmentProviderId: "git-worktree",
        hostId: otherHost.id,
        path: "/tmp/env-filter-elsewhere",
        projectId: project.id,
      });
      seedEnvironment(harness.deps, {
        environmentProviderId: "personal-workspace",
        hostId: host.id,
        path: "/tmp/env-filter-personal",
        projectId: project.id,
      });
      const broken = seedEnvironment(harness.deps, {
        environmentProviderId: "git-worktree",
        hostId: host.id,
        path: "/tmp/env-filter-broken",
        projectId: project.id,
        status: "error",
      });

      const byProviderAndHost = (await readJson(
        await harness.app.request(
          `/api/v1/environments?environmentProviderId=git-worktree&hostId=${host.id}`,
        ),
      )) as Array<{ id: string }>;
      expect(
        byProviderAndHost.map((environment) => environment.id).sort(),
      ).toEqual([broken.id, worktree.id].sort());

      const byStatus = (await readJson(
        await harness.app.request(
          `/api/v1/environments?environmentProviderId=git-worktree&status=error`,
        ),
      )) as Array<{ id: string }>;
      expect(byStatus.map((environment) => environment.id)).toEqual([
        broken.id,
      ]);
    });
  });

  it("returns destroyed rows only when the caller names that status", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-env-destroyed",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const gone = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: null,
        projectId: project.id,
        status: "destroyed",
      });

      expect(
        (await readJson(
          await harness.app.request(
            `/api/v1/environments?projectId=${project.id}`,
          ),
        )) as unknown[],
      ).toEqual([]);
      const destroyed = (await readJson(
        await harness.app.request(
          `/api/v1/environments?projectId=${project.id}&status=destroyed`,
        ),
      )) as Array<{ id: string }>;
      expect(destroyed.map((environment) => environment.id)).toEqual([gone.id]);
    });
  });

  it("records a deleted environment as destroyed and hides it from the list", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-env-del" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/env-delete",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}`,
        { method: "DELETE" },
      );
      expect(response.status).toBe(200);
      const after = getEnvironment(harness.db, environment.id);
      expect(after?.status).toBe("destroyed");
      expect(after?.path).toBeNull();

      const listed = (await readJson(
        await harness.app.request(
          `/api/v1/environments?projectId=${project.id}`,
        ),
      )) as Array<{ id: string }>;
      expect(listed).toEqual([]);
    });
  });

  it("returns the declared 404 response when deleting a missing environment", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/environments/env_missing",
        { method: "DELETE" },
      );

      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "environment_not_found",
      });
    });
  });

  it("requests provider teardown without a machine round trip", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-env-release",
      });
      registerTestHostRpcCapture(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/env-release",
        environmentProviderId: "git-worktree",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}`,
        { method: "DELETE" },
      );
      expect(response.status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "ready",
        path: environment.path,
        teardownStatus: "running",
        teardownAttempt: 0,
      });
    });
  });

  it.each([
    { method: "DELETE", path: "" },
    { method: "POST", path: "/cleanup" },
    { method: "POST", path: "/cleanup?recover=true" },
  ])(
    "reports live threads for $method $path while an archived thread still runs",
    async ({ method, path }) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, {
          id: "host-env-archived-running",
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: "/tmp/env-archived-running",
          environmentProviderId: "git-worktree",
          providerOwnsPath: true,
        });
        const thread = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
          status: "active",
        });
        harness.db
          .update(threads)
          .set({ archivedAt: Date.now() })
          .where(eq(threads.id, thread.id))
          .run();

        const response = await harness.app.request(
          `/api/v1/environments/${environment.id}${path}`,
          { method },
        );

        expect(response.status).toBe(409);
        await expect(readJson(response)).resolves.toMatchObject({
          message: "Environment still has live threads",
        });
        expect(getEnvironment(harness.db, environment.id)).toMatchObject({
          status: "ready",
          teardownStatus: null,
          retireAt: null,
        });
      });
    },
  );

  it("refuses to delete an environment with live threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-env-live" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/env-delete-live",
      });
      seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}`,
        { method: "DELETE" },
      );
      expect(response.status).toBe(409);
      expect(getEnvironment(harness.db, environment.id)?.status).not.toBe(
        "destroyed",
      );
    });
  });
});
