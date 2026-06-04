import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  archiveThread,
  createThread,
  createPromptHistoryEntry,
  getProjectExecutionDefaults,
  getProject,
  getThread,
  hostDaemonCommands,
  hostDaemonSessions,
  threads,
  upsertProjectExecutionDefaults,
  updateHost,
} from "@bb/db";
import { hostDaemonCommandSchema } from "@bb/host-daemon-contract";
import { projectBranchesResponseSchema } from "@bb/server-contract";
import {
  PERSONAL_PROJECT_ID,
  promptHistoryEntrySchema,
  threadListEntrySchema,
  threadSchema,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";
import { runProjectDeletionSweep } from "../../src/services/system/periodic-sweeps.js";
import {
  resolveThreadStoragePathFromRoot,
  resolveThreadStorageRootPath,
} from "../../src/services/threads/thread-storage.js";
import { resolvePersonalTargetPath } from "../../src/services/threads/worktree-paths.js";

const idOnlyResponseSchema = z.object({
  id: z.string(),
});

const projectResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  sources: z.array(
    z.object({
      id: z.string(),
      isDefault: z.boolean(),
      type: z.string(),
      hostId: z.string().nullable().optional(),
      path: z.string().nullable().optional(),
    }),
  ),
});

const projectWithThreadsResponseSchema = projectResponseSchema.extend({
  threads: z.array(threadListEntrySchema),
});

const sidebarBootstrapResponseSchema = z.object({
  projects: z.array(projectWithThreadsResponseSchema),
  personalProject: projectWithThreadsResponseSchema,
});

const attachmentResponseSchema = z.object({
  mimeType: z.string().optional(),
  name: z.string(),
  path: z.string(),
  type: z.string(),
});

const promptHistoryResponseSchema = z.array(promptHistoryEntrySchema);

const hostStatusListResponseSchema = z.array(
  z.object({
    id: z.string(),
    status: z.string(),
  }),
);

interface ReportCleanCleanupPreflightForEnvironmentArgs {
  afterCursor?: number;
  environmentId: string;
}

async function reportCleanCleanupPreflightForEnvironment(
  harness: TestAppHarness,
  args: ReportCleanCleanupPreflightForEnvironmentArgs,
) {
  const command =
    args.afterCursor === undefined
      ? await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.cleanup_preflight" &&
            command.environmentId === args.environmentId,
        )
      : await waitForQueuedCommandAfter(
          harness,
          args.afterCursor,
          ({ command }) =>
            command.type === "environment.cleanup_preflight" &&
            command.environmentId === args.environmentId,
        );
  await reportQueuedCommandSuccess(harness, command, {
    outcome: "safe_to_destroy",
  });
  return command;
}

describe("public project and host routes", () => {
  it("supports project CRUD", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-projects" });

      const createResponse = await harness.app.request("/api/v1/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Project One",
          source: {
            type: "local_path",
            hostId: host.id,
            path: "/tmp/project-one",
          },
        }),
      });
      expect(createResponse.status).toBe(201);
      const createdProject = projectResponseSchema.parse(
        await readJson(createResponse),
      );
      expect(createdProject.name).toBe("Project One");
      expect(createdProject.sources).toHaveLength(1);
      expect(createdProject.sources[0]?.isDefault).toBe(true);

      const listResponse = await harness.app.request("/api/v1/projects");
      expect(listResponse.status).toBe(200);
      await expect(readJson(listResponse)).resolves.toEqual([
        expect.objectContaining({
          id: createdProject.id,
          name: "Project One",
        }),
      ]);

      const updateResponse = await harness.app.request(
        `/api/v1/projects/${createdProject.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Project Renamed",
          }),
        },
      );
      expect(updateResponse.status).toBe(200);
      await expect(readJson(updateResponse)).resolves.toMatchObject({
        id: createdProject.id,
        name: "Project Renamed",
      });

      const deleteResponse = await harness.app.request(
        `/api/v1/projects/${createdProject.id}`,
        {
          method: "DELETE",
        },
      );
      expect(deleteResponse.status).toBe(200);
      await expect(readJson(deleteResponse)).resolves.toEqual({ ok: true });

      const finalListResponse = await harness.app.request("/api/v1/projects");
      await expect(readJson(finalListResponse)).resolves.toEqual([]);
    });
  });

  it("rejects personal project ids on standard-project mutation routes", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-personal-standard-route-guard",
      });

      const renameResponse = await harness.app.request(
        `/api/v1/projects/${PERSONAL_PROJECT_ID}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Renamed Personal" }),
        },
      );
      expect(renameResponse.status).toBe(404);

      const sourceResponse = await harness.app.request(
        `/api/v1/projects/${PERSONAL_PROJECT_ID}/sources`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "local_path",
            hostId: host.id,
            path: "/tmp/personal-source",
          }),
        },
      );
      expect(sourceResponse.status).toBe(404);

      const branchesResponse = await harness.app.request(
        `/api/v1/projects/${PERSONAL_PROJECT_ID}/branches?hostId=${host.id}`,
      );
      expect(branchesResponse.status).toBe(404);
    });
  });

  it("returns personal project default execution options", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        `/api/v1/projects/${PERSONAL_PROJECT_ID}/default-execution-options?threadType=manager`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        providerId: "codex",
        model: "gpt-5.5",
        reasoningLevel: "xhigh",
        permissionMode: "full",
        serviceTier: "default",
      });
    });
  });

  it("returns personal project prompt history", async () => {
    await withTestHarness(async (harness) => {
      const personalThread = seedThread(harness.deps, {
        projectId: PERSONAL_PROJECT_ID,
        title: "Loose Thread",
      });
      createPromptHistoryEntry(harness.db, {
        projectId: PERSONAL_PROJECT_ID,
        threadId: personalThread.id,
        scope: "project",
        requestSequence: 1,
        createdAt: 123,
        input: [{ type: "text", text: "Start projectless work" }],
      });

      const response = await harness.app.request(
        `/api/v1/projects/${PERSONAL_PROJECT_ID}/prompt-history`,
      );
      expect(response.status).toBe(200);
      const history = promptHistoryResponseSchema.parse(
        await readJson(response),
      );
      expect(history).toEqual([
        {
          id: expect.stringMatching(/^phist_/u),
          createdAt: 123,
          input: [{ type: "text", text: "Start projectless work" }],
        },
      ]);
    });
  });

  it("reorders projects by neighboring project ids", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-order",
      });
      const { project: firstProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "First Project",
      });
      const { project: secondProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Second Project",
      });
      const { project: thirdProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Third Project",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${thirdProject.id}/order`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            previousProjectId: firstProject.id,
            nextProjectId: secondProject.id,
          }),
        },
      );

      expect(response.status).toBe(200);
      const responseJson = await readJson(response);
      expect(JSON.stringify(responseJson)).not.toContain("sortKey");
      const orderedProjects = z
        .array(projectResponseSchema)
        .parse(responseJson);
      expect(orderedProjects.map((project) => project.id)).toEqual([
        firstProject.id,
        thirdProject.id,
        secondProject.id,
      ]);
    });
  });

  it("reorders project manager threads by neighboring thread ids", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-manager-order",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const firstManager = createThread(harness.db, harness.deps.hub, {
        projectId: project.id,
        providerId: "codex",
        type: "manager",
      });
      const secondManager = createThread(harness.db, harness.deps.hub, {
        projectId: project.id,
        providerId: "codex",
        type: "manager",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/managers/${firstManager.id}/order`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            previousThreadId: null,
            nextThreadId: secondManager.id,
          }),
        },
      );

      expect(response.status).toBe(200);
      const responseJson = await readJson(response);
      expect(JSON.stringify(responseJson)).not.toContain("sortKey");
      const threadsResponse = z
        .array(threadListEntrySchema)
        .parse(responseJson);
      expect(threadsResponse.map((thread) => thread.id)).toEqual([
        firstManager.id,
        secondManager.id,
      ]);
    });
  });

  it("embeds unarchived sidebar threads when requested", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-thread-include",
      });
      const { project: firstProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "First Project",
      });
      const { project: secondProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Second Project",
      });
      const firstEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-thread-include-first",
        projectId: firstProject.id,
      });
      const secondEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-thread-include-second",
        projectId: secondProject.id,
      });
      const olderThread = seedThread(harness.deps, {
        environmentId: firstEnvironment.id,
        projectId: firstProject.id,
        title: "Older Thread",
      });
      const newerThread = seedThread(harness.deps, {
        environmentId: firstEnvironment.id,
        projectId: firstProject.id,
        title: "Newer Thread",
      });
      const archivedThread = seedThread(harness.deps, {
        environmentId: firstEnvironment.id,
        projectId: firstProject.id,
        title: "Archived Thread",
      });
      const secondProjectThread = seedThread(harness.deps, {
        environmentId: secondEnvironment.id,
        projectId: secondProject.id,
        title: "Second Project Thread",
      });
      archiveThread(harness.deps.db, harness.deps.hub, archivedThread.id);
      harness.deps.db
        .update(threads)
        .set({ createdAt: 100, updatedAt: 100 })
        .where(eq(threads.id, olderThread.id))
        .run();
      harness.deps.db
        .update(threads)
        .set({ createdAt: 200, updatedAt: 200 })
        .where(eq(threads.id, newerThread.id))
        .run();
      harness.deps.db
        .update(threads)
        .set({ createdAt: 150, updatedAt: 150 })
        .where(eq(threads.id, secondProjectThread.id))
        .run();

      const leanResponse = await harness.app.request("/api/v1/projects");
      expect(leanResponse.status).toBe(200);
      const leanPayload = await leanResponse.text();
      expect(leanPayload).not.toContain('"threads"');
      expect(
        z.array(projectResponseSchema).parse(JSON.parse(leanPayload)),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: firstProject.id }),
          expect.objectContaining({ id: secondProject.id }),
        ]),
      );

      const response = await harness.app.request(
        "/api/v1/projects?include=threads",
      );
      expect(response.status).toBe(200);
      const projects = z
        .array(projectWithThreadsResponseSchema)
        .parse(await readJson(response));
      const firstProjectResponse = projects.find(
        (project) => project.id === firstProject.id,
      );
      const secondProjectResponse = projects.find(
        (project) => project.id === secondProject.id,
      );

      expect(firstProjectResponse?.threads.map((thread) => thread.id)).toEqual([
        newerThread.id,
        olderThread.id,
      ]);
      expect(
        firstProjectResponse?.threads.some(
          (thread) => thread.id === archivedThread.id,
        ),
      ).toBe(false);
      expect(secondProjectResponse?.threads.map((thread) => thread.id)).toEqual(
        [secondProjectThread.id],
      );
    });
  });

  it("keeps the personal project out of project lists and returns it in sidebar bootstrap", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-sidebar-bootstrap",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Standard Project",
      });
      const standardThread = seedThread(harness.deps, {
        projectId: project.id,
        title: "Standard Thread",
      });
      const personalThread = seedThread(harness.deps, {
        projectId: PERSONAL_PROJECT_ID,
        title: "Loose Thread",
      });

      const listResponse = await harness.app.request(
        "/api/v1/projects?include=threads",
      );
      expect(listResponse.status).toBe(200);
      const listedProjects = z
        .array(projectWithThreadsResponseSchema)
        .parse(await readJson(listResponse));
      expect(listedProjects.map((listed) => listed.id)).toEqual([project.id]);
      expect(listedProjects[0]?.threads.map((thread) => thread.id)).toEqual([
        standardThread.id,
      ]);

      const bootstrapResponse = await harness.app.request(
        "/api/v1/sidebar-bootstrap",
      );
      expect(bootstrapResponse.status).toBe(200);
      const bootstrap = sidebarBootstrapResponseSchema.parse(
        await readJson(bootstrapResponse),
      );
      expect(bootstrap.projects.map((listed) => listed.id)).toEqual([
        project.id,
      ]);
      expect(bootstrap.personalProject.id).toBe(PERSONAL_PROJECT_ID);
      expect(
        bootstrap.personalProject.threads.map((thread) => thread.id),
      ).toEqual([personalThread.id]);
    });
  });

  it("rejects invalid project list include values", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/projects?include=threads,invalid",
      );
      expect(response.status).toBe(400);
    });
  });

  it("rejects unsupported local project paths at the API boundary", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-path-validation",
      });
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-path-validation",
      });

      const createResponse = await harness.app.request("/api/v1/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Relative Path Project",
          source: {
            type: "local_path",
            hostId: host.id,
            path: "relative/project",
          },
        }),
      });
      expect(createResponse.status).toBe(400);
      await expect(readJson(createResponse)).resolves.toMatchObject({
        code: "invalid_request",
        message: expect.stringContaining(
          "Project path must be an absolute path",
        ),
      });

      const updateResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/sources/${source.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            type: "local_path",
            path: "relative/path",
          }),
        },
      );
      expect(updateResponse.status).toBe(400);
      await expect(readJson(updateResponse)).resolves.toMatchObject({
        code: "invalid_request",
        message: expect.stringContaining(
          "Project path must be an absolute path",
        ),
      });

      const nativeWindowsCreateResponse = await harness.app.request(
        "/api/v1/projects",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Windows Path Project",
            source: {
              type: "local_path",
              hostId: host.id,
              path: "C:\\Users\\michael\\bb",
            },
          }),
        },
      );
      expect(nativeWindowsCreateResponse.status).toBe(400);
      await expect(
        readJson(nativeWindowsCreateResponse),
      ).resolves.toMatchObject({
        code: "invalid_request",
        message: expect.stringContaining(
          "Native Windows paths are not supported",
        ),
      });

      const nativeWindowsUpdateResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/sources/${source.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            type: "local_path",
            path: "\\\\server\\share\\bb",
          }),
        },
      );
      expect(nativeWindowsUpdateResponse.status).toBe(400);
      await expect(
        readJson(nativeWindowsUpdateResponse),
      ).resolves.toMatchObject({
        code: "invalid_request",
        message: expect.stringContaining(
          "Native Windows paths are not supported",
        ),
      });

      const rootPathCreateResponse = await harness.app.request(
        "/api/v1/projects",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Root Path Project",
            source: { type: "local_path", hostId: host.id, path: "/" },
          }),
        },
      );
      expect(rootPathCreateResponse.status).toBe(400);
      await expect(readJson(rootPathCreateResponse)).resolves.toMatchObject({
        code: "invalid_request",
        message: expect.stringContaining("filesystem root"),
      });
    });
  });

  it("returns the server standard defaults when a project has no remembered standard defaults", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-standard-defaults-none",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-standard-defaults-none",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/default-execution-options?threadType=standard`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        providerId: "codex",
        model: "gpt-5.5",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
      });
    });
  });

  it("returns the server manager defaults when a project has no remembered manager defaults", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-manager-defaults-none",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-manager-defaults-none",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/default-execution-options?threadType=manager`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        providerId: "codex",
        model: "gpt-5.5",
        reasoningLevel: "xhigh",
        permissionMode: "full",
        serviceTier: "default",
      });
    });
  });

  it("returns the remembered provider and execution options for a project thread type", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-defaults",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-defaults",
      });

      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "codex",
        threadType: "standard",
        model: "gpt-5",
        reasoningLevel: "high",
        permissionMode: "workspace-write",
        serviceTier: "fast",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/default-execution-options?threadType=standard`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "high",
        permissionMode: "workspace-write",
        serviceTier: "fast",
      });
    });
  });

  it("returns thread-type-matched stored default execution options for a project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-manager-defaults",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-manager-defaults",
      });

      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "codex",
        threadType: "standard",
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
      });
      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "codex",
        threadType: "manager",
        model: "gpt-5-mini",
        reasoningLevel: "high",
        permissionMode: "workspace-write",
        serviceTier: "fast",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/default-execution-options?threadType=manager`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        providerId: "codex",
        model: "gpt-5-mini",
        reasoningLevel: "high",
        permissionMode: "workspace-write",
        serviceTier: "fast",
      });
    });
  });

  it("stores server-owned manager defaults separately from standard thread defaults when hiring a manager from the app", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-manager-defaults",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/manager-defaults",
      });

      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "codex",
        threadType: "standard",
        model: "gpt-5-mini",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/managers`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            origin: "app",
            environment: { type: "host", hostId: host.id },
          }),
        },
      );

      expect(response.status).toBe(201);
      expect(
        getProjectExecutionDefaults(harness.db, {
          projectId: project.id,
          threadType: "standard",
        }),
      ).toEqual({
        providerId: "codex",
        model: "gpt-5-mini",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
      });
      expect(
        getProjectExecutionDefaults(harness.db, {
          projectId: project.id,
          threadType: "manager",
        }),
      ).toEqual({
        providerId: "codex",
        model: "gpt-5.5",
        reasoningLevel: "xhigh",
        permissionMode: "full",
        serviceTier: "default",
      });
    });
  });

  it("creates personal project managers with a personal environment", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-personal-manager",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${PERSONAL_PROJECT_ID}/managers`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            origin: "app",
            environment: { type: "host", hostId: host.id },
          }),
        },
      );

      expect(response.status).toBe(201);
      const managerThread = threadSchema.parse(await readJson(response));
      expect(managerThread.projectId).toBe(PERSONAL_PROJECT_ID);
      expect(managerThread.type).toBe("manager");
      expect(managerThread.environmentId).not.toBeNull();
      const environmentId = managerThread.environmentId;
      if (environmentId === null) {
        throw new Error("Expected a personal environment");
      }
      const personalWorkspacePath = resolvePersonalTargetPath({
        dataDir: session.dataDir,
        environmentId,
      });
      expect(getThread(harness.db, managerThread.id)?.environmentId).toBe(
        environmentId,
      );

      const provisionCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === environmentId,
      );
      expect(provisionCommand.command).toMatchObject({
        environmentId,
        targetPath: personalWorkspacePath,
        workspaceProvisionType: "personal",
      });
      const provisionResponse = await reportQueuedCommandSuccess(
        harness,
        provisionCommand,
        {
          branchName: null,
          defaultBranch: null,
          isGitRepo: false,
          isWorktree: false,
          path: personalWorkspacePath,
          transcript: [],
        },
      );
      expect(provisionResponse.status).toBe(200);

      const startCommand = await waitForQueuedCommandAfter(
        harness,
        provisionCommand.row.cursor,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === managerThread.id,
      );
      if (startCommand.command.type !== "thread.start") {
        throw new Error("Expected thread.start command");
      }
      const expectedThreadStoragePath = resolveThreadStoragePathFromRoot({
        threadId: managerThread.id,
        threadStorageRootPath: resolveThreadStorageRootPath({
          dataDir: session.dataDir,
          env: {},
        }),
      });
      expect(startCommand.command.environmentId).toBe(environmentId);
      expect(startCommand.command.workspaceContext).toEqual({
        workspacePath: personalWorkspacePath,
        workspaceProvisionType: "personal",
      });
      expect(startCommand.command.threadStoragePath).toBe(
        expectedThreadStoragePath,
      );
    });
  });

  it("inherits remembered manager defaults for CLI-origin manager creation without overwriting them", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-manager-defaults-cli",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/manager-defaults-cli",
      });

      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "codex",
        threadType: "manager",
        model: "gpt-5",
        reasoningLevel: "high",
        permissionMode: "workspace-write",
        serviceTier: "fast",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/managers`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            origin: "cli",
            environment: { type: "host", hostId: host.id },
          }),
        },
      );

      expect(response.status).toBe(201);
      expect(
        getProjectExecutionDefaults(harness.db, {
          projectId: project.id,
          threadType: "manager",
        }),
      ).toEqual({
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "high",
        permissionMode: "workspace-write",
        serviceTier: "fast",
      });
    });
  });

  it("uses the server-owned manager defaults when the CLI omits provider and model with no stored manager defaults", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-manager-defaults-cli-fallback",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/manager-defaults-cli-fallback",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/managers`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            origin: "cli",
            environment: { type: "host", hostId: host.id },
          }),
        },
      );

      expect(response.status).toBe(201);
      await expect(readJson(response)).resolves.toMatchObject({
        providerId: "codex",
        type: "manager",
      });
      expect(
        getProjectExecutionDefaults(harness.db, {
          projectId: project.id,
          threadType: "manager",
        }),
      ).toBeNull();
    });
  });

  it("rejects manager creation without an origin at the public API boundary", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-manager-missing-origin",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/manager-missing-origin",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/managers`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            environment: { type: "host", hostId: host.id },
          }),
        },
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
        message: expect.stringContaining('expected one of "app"|"cli"'),
      });
    });
  });

  it("keeps created threads pending deletion until queued thread.start work is stopped", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-delete-created-start",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-delete-created-start",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/project-delete-created-start",
      });

      const createThreadResponse = await harness.app.request(
        "/api/v1/threads",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Create before project delete" }],
            environment: {
              type: "reuse",
              environmentId: environment.id,
            },
          }),
        },
      );

      expect(createThreadResponse.status).toBe(201);
      const createdThread = threadSchema.parse(
        await readJson(createThreadResponse),
      );
      expect(createdThread.status).toBe("provisioning");

      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === createdThread.id,
      );

      const deleteProjectResponse = await harness.app.request(
        `/api/v1/projects/${project.id}`,
        {
          method: "DELETE",
        },
      );

      expect(deleteProjectResponse.status).toBe(200);
      expect(getProject(harness.db, project.id)).not.toBeNull();
      expect(getThread(harness.db, createdThread.id)).toMatchObject({
        deletedAt: expect.any(Number),
        stopRequestedAt: expect.any(Number),
        status: "provisioning",
      });
      await expect(readJson(deleteProjectResponse)).resolves.toEqual({
        ok: true,
      });

      const threadsResponse = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}`,
      );
      expect(threadsResponse.status).toBe(404);

      const threadResponse = await harness.app.request(
        `/api/v1/threads/${createdThread.id}`,
      );
      expect(threadResponse.status).toBe(404);

      const queuedStop = await waitForQueuedCommandAfter(
        harness,
        queuedStart.row.cursor,
        ({ command }) =>
          command.type === "thread.stop" &&
          command.threadId === createdThread.id,
      );
      expect(queuedStop.command).toMatchObject({
        environmentId: environment.id,
        threadId: createdThread.id,
      });

      const projectsResponse = await harness.app.request("/api/v1/projects");
      expect(projectsResponse.status).toBe(200);
      await expect(readJson(projectsResponse)).resolves.toEqual([]);
    });
  });

  it("hides live threads that appear after project deletion begins", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-delete-live-thread",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-delete-live-thread",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        projectId: project.id,
        path: "/tmp/project-delete-live-thread-managed",
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });

      const deleteProjectResponse = await harness.app.request(
        `/api/v1/projects/${project.id}`,
        { method: "DELETE" },
      );
      expect(deleteProjectResponse.status).toBe(200);
      expect(getProject(harness.db, project.id)).not.toBeNull();

      const liveThread = createThread(harness.db, harness.hub, {
        projectId: project.id,
        providerId: "codex",
        status: "created",
      });
      expect(getThread(harness.db, liveThread.id)).toMatchObject({
        deletedAt: null,
        projectId: project.id,
      });

      const threadsResponse = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}`,
      );
      expect(threadsResponse.status).toBe(404);

      const threadResponse = await harness.app.request(
        `/api/v1/threads/${liveThread.id}`,
      );
      expect(threadResponse.status).toBe(404);
    });
  });

  it("supports project source CRUD and reassigns the default source on delete", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-source-1" });
      const secondaryHost = seedHost(harness.deps, { id: "host-source-2" });

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
      expect(createSourceResponse.status).toBe(201);
      const secondSource = idOnlyResponseSchema.parse(
        await readJson(createSourceResponse),
      );

      const missingTypeResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/sources`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            hostId: secondaryHost.id,
            path: "/tmp/project-sources-missing-type",
          }),
        },
      );
      expect(missingTypeResponse.status).toBe(400);

      const updateSourceResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/sources/${secondSource.id}`,
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
        id: secondSource.id,
        path: "/tmp/project-sources-renamed",
      });

      const deleteSourceResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/sources/${defaultSourceId}`,
        {
          method: "DELETE",
        },
      );
      expect(deleteSourceResponse.status).toBe(200);

      const projectAfterDeleteResponse = await harness.app.request(
        `/api/v1/projects/${project.id}`,
      );
      const projectAfterDelete = projectResponseSchema.parse(
        await readJson(projectAfterDeleteResponse),
      );
      expect(projectAfterDelete.sources).toEqual([
        expect.objectContaining({
          id: secondSource.id,
          isDefault: true,
        }),
      ]);
    });
  });

  it("derives host connection status from active sessions with valid leases", async () => {
    await withTestHarness(async (harness) => {
      const connected = seedHostSession(harness.deps, { id: "host-connected" });
      const disconnected = seedHost(harness.deps, { id: "host-disconnected" });
      const expired = seedHostSession(harness.deps, { id: "host-expired" });
      const destroyed = seedHostSession(harness.deps, { id: "host-destroyed" });

      harness.db
        .update(hostDaemonSessions)
        .set({
          leaseExpiresAt: Date.now() - 1,
        })
        .where(eq(hostDaemonSessions.id, expired.session.id))
        .run();
      updateHost(harness.db, harness.hub, destroyed.host.id, {
        destroyedAt: Date.now(),
      });

      const listResponse = await harness.app.request("/api/v1/hosts");
      expect(listResponse.status).toBe(200);
      const hosts = hostStatusListResponseSchema.parse(
        await readJson(listResponse),
      );
      expect(hosts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: connected.host.id,
            status: "connected",
          }),
          expect.objectContaining({
            id: disconnected.id,
            status: "disconnected",
          }),
          expect.objectContaining({
            id: expired.host.id,
            status: "disconnected",
          }),
        ]),
      );
      expect(hosts).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: destroyed.host.id }),
        ]),
      );

      const getResponse = await harness.app.request(
        `/api/v1/hosts/${connected.host.id}`,
      );
      expect(getResponse.status).toBe(200);
      await expect(readJson(getResponse)).resolves.toMatchObject({
        id: connected.host.id,
        status: "connected",
      });

      const destroyedResponse = await harness.app.request(
        `/api/v1/hosts/${destroyed.host.id}`,
      );
      expect(destroyedResponse.status).toBe(404);
      await expect(readJson(destroyedResponse)).resolves.toMatchObject({
        code: "host_unavailable",
        details: {
          reason: "destroyed",
          hostStatus: null,
          suspendedAt: null,
        },
      });
    });
  });

  it("rejects destroyed hosts for project sources", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-destroyed-source" });
      updateHost(harness.db, harness.hub, host.id, {
        destroyedAt: Date.now(),
      });

      const response = await harness.app.request("/api/v1/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Destroyed Host Project",
          source: {
            type: "local_path",
            hostId: host.id,
            path: "/tmp/destroyed-host-project",
          },
        }),
      });

      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "host_unavailable",
        details: {
          reason: "destroyed",
          hostStatus: null,
          suspendedAt: null,
        },
      });
    });
  });

  it("queues host.list_files for the default project source", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-files",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-files",
      });

      const responsePromise = harness.app.request(
        `/api/v1/projects/${project.id}/files?query=src&limit=1&environmentId=`,
      );
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_files" &&
          command.path === "/tmp/project-files",
      );
      expect(queued.command).toMatchObject({
        path: "/tmp/project-files",
        query: "src",
        limit: 1,
      });
      await reportQueuedCommandSuccess(harness, queued, {
        files: [{ path: "src/index.ts", name: "index.ts" }],
        truncated: true,
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        files: [{ path: "src/index.ts", name: "index.ts" }],
        truncated: true,
      });
    });
  });

  it("queues host.list_paths for project paths with directories included", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-paths",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-paths",
      });

      const responsePromise = harness.app.request(
        `/api/v1/projects/${project.id}/paths?query=src&limit=2&environmentId=&includeFiles=true&includeDirectories=true`,
      );
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === "/tmp/project-paths",
      );
      expect(queued.command).toMatchObject({
        path: "/tmp/project-paths",
        query: "src",
        limit: 2,
        includeFiles: true,
        includeDirectories: true,
      });
      await reportQueuedCommandSuccess(harness, queued, {
        paths: [
          {
            kind: "directory",
            path: "src",
            name: "src",
            score: 100,
            positions: [0, 1, 2],
          },
          {
            kind: "file",
            path: "src/index.ts",
            name: "index.ts",
            score: 75,
            positions: [0, 1, 2],
          },
        ],
        truncated: false,
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        paths: [
          {
            kind: "directory",
            path: "src",
            name: "src",
            score: 100,
            positions: [0, 1, 2],
          },
          {
            kind: "file",
            path: "src/index.ts",
            name: "index.ts",
            score: 75,
            positions: [0, 1, 2],
          },
        ],
        truncated: false,
      });
    });
  });

  it("queues host.list_branches for the default project source", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-branches",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-branches",
      });

      const responsePromise = harness.app.request(
        `/api/v1/projects/${project.id}/branches?hostId=${host.id}&selectedBranch=upstream%2Fmain`,
      );
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_branches" &&
          command.path === "/tmp/project-branches",
      );
      expect(queued.command).toMatchObject({
        path: "/tmp/project-branches",
        limit: 50,
        selectedBranch: "upstream/main",
      });
      await reportQueuedCommandSuccess(harness, queued, {
        branches: ["main", "feature/test"],
        branchesTruncated: false,
        remoteBranches: ["origin/main", "upstream/main"],
        remoteBranchesTruncated: false,
        checkout: {
          kind: "branch",
          branchName: "feature/test",
          headSha: "abc123",
        },
        defaultBranch: "main",
        hasUncommittedChanges: false,
        operation: { kind: "none" },
        selectedBranch: { name: "upstream/main", kind: "remote" },
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(
        projectBranchesResponseSchema.parse(await readJson(response)),
      ).toEqual({
        branches: ["main", "feature/test"],
        branchesTruncated: false,
        remoteBranches: ["origin/main", "upstream/main"],
        remoteBranchesTruncated: false,
        checkout: {
          kind: "branch",
          branchName: "feature/test",
          headSha: "abc123",
        },
        defaultBranch: "main",
        hasUncommittedChanges: false,
        operation: { kind: "none" },
        selectedBranch: { name: "upstream/main", kind: "remote" },
      });
    });
  });

  it("returns 404 for branch listing on a missing project", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/projects/proj_missing/branches?hostId=host_missing",
      );

      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "project_not_found",
      });
    });
  });

  it("scopes host.list_files to a worktree environment when provided", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-files-worktree",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-files-primary",
      });
      const worktree = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/project-files-worktree",
        managed: true,
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });

      const responsePromise = harness.app.request(
        `/api/v1/projects/${project.id}/files?query=src&limit=1&environmentId=${worktree.id}`,
      );
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_files" &&
          command.path === "/tmp/project-files-worktree",
      );
      expect(queued.command).toMatchObject({
        path: "/tmp/project-files-worktree",
        query: "src",
        limit: 1,
      });
      await reportQueuedCommandSuccess(harness, queued, {
        files: [{ path: "src/new-file.ts", name: "new-file.ts" }],
        truncated: false,
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        files: [{ path: "src/new-file.ts", name: "new-file.ts" }],
        truncated: false,
      });
    });
  });

  it("rejects an environmentId that belongs to a different project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-files-cross",
      });
      const { project: projectA } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-files-a",
      });
      const { project: projectB } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-files-b",
      });
      const otherEnv = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: projectB.id,
        path: "/tmp/project-files-b",
        managed: true,
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${projectA.id}/files?query=src&environmentId=${otherEnv.id}`,
      );
      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "environment_not_found",
      });
    });
  });

  it("rejects a non-ready environmentId on the project files route", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-files-not-ready",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-files-not-ready",
      });
      const provisioning = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/project-files-not-ready-worktree",
        managed: true,
        status: "provisioning",
        workspaceProvisionType: "managed-worktree",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/files?query=src&environmentId=${provisioning.id}`,
      );
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "environment_not_ready",
        details: {
          environmentStatus: "provisioning",
          hasPath: true,
          cleanupRequestedAt: null,
        },
      });
    });
  });

  it("stores project attachments and serves their content", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-attachments",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-attachments",
      });

      const formData = new FormData();
      formData.set(
        "file",
        new File(["attachment body"], "notes.txt", {
          type: "text/plain",
        }),
        "notes.txt",
      );

      const uploadResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/attachments`,
        {
          method: "POST",
          body: formData,
        },
      );
      expect(uploadResponse.status).toBe(201);
      const uploaded = attachmentResponseSchema.parse(
        await readJson(uploadResponse),
      );
      expect(uploaded).toMatchObject({
        type: "localFile",
        name: "notes.txt",
        mimeType: "text/plain",
      });
      expect(uploaded.path).toBeTruthy();

      const contentResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/attachments/content?path=${encodeURIComponent(uploaded.path)}`,
      );
      expect(contentResponse.status).toBe(200);
      expect(
        Buffer.from(await contentResponse.arrayBuffer()).toString("utf8"),
      ).toBe("attachment body");
    });
  });

  it("stores personal project attachments and serves their content", async () => {
    await withTestHarness(async (harness) => {
      const formData = new FormData();
      formData.set(
        "file",
        new File(["projectless attachment body"], "loose-notes.txt", {
          type: "text/plain",
        }),
        "loose-notes.txt",
      );

      const uploadResponse = await harness.app.request(
        `/api/v1/projects/${PERSONAL_PROJECT_ID}/attachments`,
        {
          method: "POST",
          body: formData,
        },
      );
      expect(uploadResponse.status).toBe(201);
      const uploaded = attachmentResponseSchema.parse(
        await readJson(uploadResponse),
      );
      expect(uploaded).toMatchObject({
        type: "localFile",
        name: "loose-notes.txt",
        mimeType: "text/plain",
      });

      const contentResponse = await harness.app.request(
        `/api/v1/projects/${PERSONAL_PROJECT_ID}/attachments/content?path=${encodeURIComponent(uploaded.path)}`,
      );
      expect(contentResponse.status).toBe(200);
      expect(
        Buffer.from(await contentResponse.arrayBuffer()).toString("utf8"),
      ).toBe("projectless attachment body");
    });
  });

  it("queues environment.destroy commands for managed environments when deleting a project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-delete-env" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-delete-env",
      });

      // Managed environment that should be destroyed.
      const managed = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/managed-worktree",
        managed: true,
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });

      // Already-destroyed managed environment — should NOT get another command.
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/already-destroyed",
        managed: true,
        status: "destroyed",
        workspaceProvisionType: "managed-worktree",
      });

      // Unmanaged environment — should NOT get a destroy command.
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/unmanaged",
        managed: false,
        status: "ready",
        workspaceProvisionType: "unmanaged",
      });

      const deletePromise = harness.app.request(
        `/api/v1/projects/${project.id}`,
        { method: "DELETE" },
      );
      await reportCleanCleanupPreflightForEnvironment(harness, {
        environmentId: managed.id,
      });
      const deleteResponse = await deletePromise;
      expect(deleteResponse.status).toBe(200);
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === managed.id,
      );

      const commands = harness.db
        .select()
        .from(hostDaemonCommands)
        .all()
        .map((row) => hostDaemonCommandSchema.parse(JSON.parse(row.payload)));

      const destroyCommands = commands.filter(
        (c) => c.type === "environment.destroy",
      );
      expect(destroyCommands).toHaveLength(1);
      expect(destroyCommands[0]).toMatchObject({
        type: "environment.destroy",
        environmentId: managed.id,
        workspaceContext: {
          workspacePath: "/tmp/managed-worktree",
          workspaceProvisionType: "managed-worktree",
        },
      });

      // Project is hidden from public reads immediately, but remains internally
      // until managed teardown completes.
      const listResponse = await harness.app.request("/api/v1/projects");
      expect(listResponse.status).toBe(200);
      await expect(readJson(listResponse)).resolves.toEqual([]);
      expect(getProject(harness.db, project.id)).not.toBeNull();
    });
  });

  it("renames a host via PATCH", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-rename" });

      const patchResponse = await harness.app.request(
        `/api/v1/hosts/${host.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Renamed Host" }),
        },
      );
      expect(patchResponse.status).toBe(200);
      await expect(readJson(patchResponse)).resolves.toMatchObject({
        id: host.id,
        name: "Renamed Host",
      });

      const getResponse = await harness.app.request(`/api/v1/hosts/${host.id}`);
      expect(getResponse.status).toBe(200);
      await expect(readJson(getResponse)).resolves.toMatchObject({
        id: host.id,
        name: "Renamed Host",
      });
    });
  });

  it("returns 404 when renaming a destroyed host via PATCH", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-rename-destroyed" });
      updateHost(harness.db, harness.hub, host.id, {
        destroyedAt: Date.now(),
      });

      const patchResponse = await harness.app.request(
        `/api/v1/hosts/${host.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Renamed Host" }),
        },
      );

      expect(patchResponse.status).toBe(404);
      await expect(readJson(patchResponse)).resolves.toMatchObject({
        code: "host_unavailable",
        details: {
          reason: "destroyed",
          hostStatus: null,
          suspendedAt: null,
        },
      });
    });
  });

  it("deletes a host via DELETE", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-delete" });

      const deleteResponse = await harness.app.request(
        `/api/v1/hosts/${host.id}`,
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(200);
      await expect(readJson(deleteResponse)).resolves.toEqual({ ok: true });

      const getResponse = await harness.app.request(`/api/v1/hosts/${host.id}`);
      expect(getResponse.status).toBe(404);
    });
  });

  it("returns 404 when deleting a destroyed host via DELETE", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-delete-destroyed" });
      updateHost(harness.db, harness.hub, host.id, {
        destroyedAt: Date.now(),
      });

      const deleteResponse = await harness.app.request(
        `/api/v1/hosts/${host.id}`,
        { method: "DELETE" },
      );

      expect(deleteResponse.status).toBe(404);
      await expect(readJson(deleteResponse)).resolves.toMatchObject({
        code: "host_unavailable",
        details: {
          reason: "destroyed",
          hostStatus: null,
          suspendedAt: null,
        },
      });
    });
  });

  it("deletes a host that has pending commands", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-delete-cmds",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/host-delete-cmds",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/host-delete-cmds",
      });

      // Create a thread to generate queued commands for this host
      const createThreadResponse = await harness.app.request(
        "/api/v1/threads",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "test" }],
            environment: { type: "reuse", environmentId: environment.id },
          }),
        },
      );
      expect(createThreadResponse.status).toBe(201);

      // Wait for the command to be queued
      await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.start",
      );

      const deleteResponse = await harness.app.request(
        `/api/v1/hosts/${host.id}`,
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(200);
      await expect(readJson(deleteResponse)).resolves.toEqual({ ok: true });

      const getResponse = await harness.app.request(`/api/v1/hosts/${host.id}`);
      expect(getResponse.status).toBe(404);
    });
  });

  it("returns 404 when deleting a nonexistent host", async () => {
    await withTestHarness(async (harness) => {
      const deleteResponse = await harness.app.request(
        `/api/v1/hosts/host-nonexistent`,
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(404);
    });
  });

  it("retries managed project teardown after a partial destroy failure", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-delete-project-retry",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-delete-retry",
      });
      const firstEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        path: "/tmp/project-delete-retry/one",
        projectId: project.id,
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });
      const secondEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        path: "/tmp/project-delete-retry/two",
        projectId: project.id,
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });

      const deletePromise = harness.app.request(
        `/api/v1/projects/${project.id}`,
        { method: "DELETE" },
      );
      const firstStatus = await reportCleanCleanupPreflightForEnvironment(
        harness,
        { environmentId: firstEnvironment.id },
      );
      await reportCleanCleanupPreflightForEnvironment(harness, {
        afterCursor: firstStatus.row.cursor,
        environmentId: secondEnvironment.id,
      });
      const deleteResponse = await deletePromise;
      expect(deleteResponse.status).toBe(200);
      await expect(readJson(deleteResponse)).resolves.toEqual({ ok: true });

      const firstDestroy = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === firstEnvironment.id,
      );
      const secondDestroy = await waitForQueuedCommandAfter(
        harness,
        firstDestroy.row.cursor,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === secondEnvironment.id,
      );

      await reportQueuedCommandSuccess(harness, firstDestroy, {});
      await reportQueuedCommandError(harness, secondDestroy, {
        errorCode: "provider_error",
        errorMessage: "Destroy failed",
      });

      expect(getProject(harness.db, project.id)).not.toBeNull();

      const retrySweepPromise = runProjectDeletionSweep(harness.deps);
      const retriedPreflight = await reportCleanCleanupPreflightForEnvironment(
        harness,
        {
          afterCursor: secondDestroy.row.cursor,
          environmentId: secondEnvironment.id,
        },
      );
      await retrySweepPromise;
      const retriedDestroy = await waitForQueuedCommandAfter(
        harness,
        retriedPreflight.row.cursor,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === secondEnvironment.id,
      );
      await reportQueuedCommandSuccess(harness, retriedDestroy, {});

      await runProjectDeletionSweep(harness.deps);

      expect(getProject(harness.db, project.id)).toBeNull();
      const listResponse = await harness.app.request("/api/v1/projects");
      expect(listResponse.status).toBe(200);
      await expect(readJson(listResponse)).resolves.toEqual([]);
    });
  });
});
