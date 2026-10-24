import {
  createProjectSource,
  getEnvironment,
  getThread,
  updateHost,
} from "@bb/db";
import { threadSchema, type GitSourceInspection } from "@bb/domain";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { setPluginMachineProviderBridge } from "../../src/services/plugins/plugin-machine-provider-registry.js";
import {
  getThreadProvisionContext,
  type ThreadProvisionEnvironmentIntent,
} from "../../src/services/threads/thread-startup-store.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { installMachineProvider } from "../helpers/machine-provider.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { installFakeGitWorktreeProvider } from "../helpers/environment-provider.js";

interface CreateThreadBodyOverrides {
  environment: unknown;
  origin?: string;
  originPluginId?: string;
}

async function postCreateThread(
  harness: TestAppHarness,
  projectId: string,
  overrides: CreateThreadBodyOverrides,
): Promise<Response> {
  return harness.app.request("/api/v1/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      origin: overrides.origin ?? "sdk",
      ...(overrides.originPluginId !== undefined
        ? { originPluginId: overrides.originPluginId }
        : {}),
      projectId,
      providerId: "codex",
      input: [{ type: "text", text: "Spawn a thread" }],
      environment: overrides.environment,
    }),
  });
}

async function createAndCaptureIntent(
  harness: TestAppHarness,
  args: { environment: unknown; projectId: string },
): Promise<{ intent: ThreadProvisionEnvironmentIntent; threadId: string }> {
  const response = await postCreateThread(harness, args.projectId, {
    environment: args.environment,
  });
  expect(response.status).toBe(201);
  const thread = threadSchema.parse(await readJson(response));
  const intent = getThreadProvisionContext(harness.db, thread.id)?.request
    .environmentIntent;
  if (intent === undefined) {
    throw new Error("Expected an active provisioning context");
  }
  return { intent, threadId: thread.id };
}

describe("project-default thread environment", () => {
  it("resolves project-default to the worktree provider on the source's default branch", async () => {
    await withTestHarness(async (harness) => {
      installFakeGitWorktreeProvider();
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-default",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-default-source",
      });
      const { intent, threadId } = await createAndCaptureIntent(harness, {
        projectId: project.id,
        environment: { type: "project-default" },
      });
      expect(intent).toEqual({
        type: "provider",
        environmentProviderId: "git-worktree",
        machine: { type: "existing", hostId: host.id },
        inputs: { branch: { kind: "named", name: "origin/main" } },
        selectionResolved: true,
      });
      expect(getThread(harness.db, threadId)?.originPluginId).toBeNull();
    });
  });

  it("passes an explicit managed-worktree default through to the worktree provider unresolved", async () => {
    await withTestHarness(async (harness) => {
      installFakeGitWorktreeProvider();
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-default-explicit",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-default-source",
      });
      const { intent } = await createAndCaptureIntent(harness, {
        projectId: project.id,
        environment: {
          type: "host",
          hostId: host.id,
          workspace: {
            type: "managed-worktree",
            baseBranch: { kind: "default" },
          },
        },
      });
      expect(intent).toEqual({
        type: "provider",
        environmentProviderId: "git-worktree",
        machine: { type: "existing", hostId: host.id },
        inputs: { branch: { kind: "default" } },
        selectionResolved: true,
      });
    });
  });

  it.each([
    {
      name: "a repository with no commits",
      checkout: {
        checkout: { kind: "unborn" as const, branchName: "main" },
        defaultBranch: null,
        defaultBranchRelation: null,
        isWorktree: false,
        hasUncommittedChanges: false,
        operation: { kind: "none" as const },
        originDefaultBranch: null,
      } satisfies GitSourceInspection,
    },
    {
      name: "a non-Git directory",
      checkout: {
        checkout: {
          kind: "unknown" as const,
          reason: "Path is not a git repository",
        },
        defaultBranch: null,
        defaultBranchRelation: null,
        isWorktree: false,
        hasUncommittedChanges: false,
        operation: { kind: "none" as const },
        originDefaultBranch: null,
      } satisfies GitSourceInspection,
    },
  ])(
    "dispatches a plugin thread in the project source for $name",
    async ({ checkout }) => {
      await withTestHarness(async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        seedPrimaryHost(harness.deps, host.id);
        const sourcePath = "/tmp/project-default-unmanaged-source";
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: sourcePath,
        });
        const responder = registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          restoreCommandCaptureAfterResponse: true,
          handle(request) {
            expect(request.command).toEqual({
              type: "host.inspect_git_source",
              path: sourcePath,
              remoteRefresh: "background",
            });
            return { ok: true, result: checkout };
          },
        });

        const response = await postCreateThread(harness, project.id, {
          origin: "plugin",
          originPluginId: "tasks",
          environment: { type: "project-default" },
        });

        expect(response.status).toBe(201);
        const thread = threadSchema.parse(await readJson(response));
        expect(responder.requests).toHaveLength(1);
        expect(getThread(harness.db, thread.id)?.originPluginId).toBe("tasks");
        await vi.waitFor(() => {
          const environmentId = getThread(harness.db, thread.id)?.environmentId;
          expect(environmentId).toBeTruthy();
          const environment = getEnvironment(harness.db, environmentId!);
          expect(environment).toMatchObject({
            environmentProviderId: "project-checkout",
            hostId: host.id,
            path: sourcePath,
            ownerThreadId: null,
            environmentProviderSelection: {
              machine: { type: "existing", hostId: host.id },
              inputs: { path: sourcePath },
            },
          });
          expect(
            getThreadProvisionContext(harness.db, thread.id)?.request
              .environmentIntent,
          ).toEqual({ type: "reuse", environmentId });
        });
      });
    },
  );

  it("fails with a clear ApiError when the primary host is not connected", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      const response = await postCreateThread(harness, project.id, {
        environment: { type: "project-default" },
      });
      expect(response.status).toBe(502);
      const body = (await readJson(response)) as {
        code: string;
        message: string;
      };
      expect(body.code).toBe("host_unavailable");
      expect(body.message).toBe("Host is not connected");
    });
  });
});

describe("project-default machine", () => {
  function worktreeIntentOn(hostId: string) {
    return {
      type: "provider",
      environmentProviderId: "git-worktree",
      machine: { type: "existing", hostId },
      inputs: { branch: { kind: "named", name: "origin/main" } },
      selectionResolved: true,
    };
  }

  it("runs on the project's machine when the primary host has no source", async () => {
    await withTestHarness(async (harness) => {
      installFakeGitWorktreeProvider();
      const { host: primary } = seedHostSession(harness.deps, {
        id: "host-primary",
      });
      seedPrimaryHost(harness.deps, primary.id);
      const { host: laptop } = seedHostSession(harness.deps, {
        id: "host-laptop",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: laptop.id,
        path: "/tmp/laptop-only-project",
      });

      const { intent } = await createAndCaptureIntent(harness, {
        projectId: project.id,
        environment: { type: "project-default" },
      });

      expect(intent).toEqual(worktreeIntentOn(laptop.id));
    });
  });

  it("keeps the primary host when it has a source, even if the default source is elsewhere", async () => {
    await withTestHarness(async (harness) => {
      installFakeGitWorktreeProvider();
      const { host: primary } = seedHostSession(harness.deps, {
        id: "host-primary",
      });
      seedPrimaryHost(harness.deps, primary.id);
      const { host: laptop } = seedHostSession(harness.deps, {
        id: "host-laptop",
      });
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: laptop.id,
        path: "/tmp/laptop-project",
      });
      expect(source.isDefault).toBe(true);
      createProjectSource(harness.db, harness.hub, {
        projectId: project.id,
        type: "local_path",
        hostId: primary.id,
        path: "/tmp/primary-project",
      });

      const { intent } = await createAndCaptureIntent(harness, {
        projectId: project.id,
        environment: { type: "project-default" },
      });

      expect(intent).toEqual(worktreeIntentOn(primary.id));
    });
  });

  it("skips a source on a temporary machine", async () => {
    await withTestHarness(async (harness) => {
      installFakeGitWorktreeProvider();
      const { host: primary } = seedHostSession(harness.deps, {
        id: "host-primary",
      });
      seedPrimaryHost(harness.deps, primary.id);
      const { host: sandbox } = seedHostSession(harness.deps, {
        id: "host-sandbox",
      });
      updateHost(harness.db, harness.hub, sandbox.id, { type: "ephemeral" });
      const { host: laptop } = seedHostSession(harness.deps, {
        id: "host-laptop",
      });
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: sandbox.id,
        path: "/tmp/sandbox-project",
      });
      expect(source.isDefault).toBe(true);
      createProjectSource(harness.db, harness.hub, {
        projectId: project.id,
        type: "local_path",
        hostId: laptop.id,
        path: "/tmp/laptop-project",
      });

      const { intent } = await createAndCaptureIntent(harness, {
        projectId: project.id,
        environment: { type: "project-default" },
      });

      expect(intent).toEqual(worktreeIntentOn(laptop.id));
    });
  });

  it("fails instead of moving the thread when the project's machine is offline", async () => {
    await withTestHarness(async (harness) => {
      installFakeGitWorktreeProvider();
      const { host: primary } = seedHostSession(harness.deps, {
        id: "host-primary",
      });
      seedPrimaryHost(harness.deps, primary.id);
      const laptop = seedHost(harness.deps, { id: "host-laptop" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: laptop.id,
        path: "/tmp/laptop-only-project",
      });

      const response = await postCreateThread(harness, project.id, {
        environment: { type: "project-default" },
      });

      expect(response.status).toBe(502);
      expect(await readJson(response)).toMatchObject({
        code: "host_unavailable",
        message: "Host is not connected",
      });
    });
  });

  it("wakes the project's suspended machine instead of failing", async () => {
    await withTestHarness(async (harness) => {
      installFakeGitWorktreeProvider();
      const resume = vi.fn(async () => ({ resource: { id: "restored" } }));
      installMachineProvider({
        resume,
        suspend: async () => ({ resource: { id: "saved" } }),
      });
      onTestFinished(() => setPluginMachineProviderBridge(undefined));
      const { host: primary } = seedHostSession(harness.deps, {
        id: "host-primary",
      });
      seedPrimaryHost(harness.deps, primary.id);
      const { host: laptop } = seedHostSession(harness.deps, {
        id: "host-laptop",
      });
      updateHost(harness.db, harness.hub, laptop.id, {
        machineProviderId: "test-machine",
        phase: "suspended",
        resource: { id: "saved" },
        suspendedAt: 1,
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: laptop.id,
        path: "/tmp/laptop-only-project",
      });

      const { intent } = await createAndCaptureIntent(harness, {
        projectId: project.id,
        environment: { type: "project-default" },
      });

      expect(resume).toHaveBeenCalledOnce();
      expect(intent).toEqual(worktreeIntentOn(laptop.id));
    });
  });

  it("keeps the missing-source error when only a temporary machine has a source", async () => {
    await withTestHarness(async (harness) => {
      installFakeGitWorktreeProvider();
      const { host: primary } = seedHostSession(harness.deps, {
        id: "host-primary",
      });
      seedPrimaryHost(harness.deps, primary.id);
      const { host: sandbox } = seedHostSession(harness.deps, {
        id: "host-sandbox",
      });
      updateHost(harness.db, harness.hub, sandbox.id, { type: "ephemeral" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: sandbox.id,
        path: "/tmp/sandbox-project",
      });

      const response = await postCreateThread(harness, project.id, {
        environment: { type: "project-default" },
      });

      expect(response.status).toBe(404);
      expect(await readJson(response)).toMatchObject({
        message: "Project has no local-path source for host",
      });
    });
  });
});

describe("plugin thread attribution", () => {
  it("persists and surfaces originPluginId for plugin-origin threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/plugin-attribution",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/plugin-attribution",
      });

      const response = await postCreateThread(harness, project.id, {
        origin: "plugin",
        originPluginId: "linear",
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: null },
        },
      });
      expect(response.status).toBe(201);
      const created = threadSchema.parse(await readJson(response));
      expect(created.originPluginId).toBe("linear");
      expect(getThread(harness.db, created.id)?.originPluginId).toBe("linear");

      const getResponse = await harness.app.request(
        `/api/v1/threads/${created.id}`,
      );
      expect(getResponse.status).toBe(200);
      const fetched = threadSchema.parse(await readJson(getResponse));
      expect(fetched.originPluginId).toBe("linear");
    });
  });

  it("rejects origin plugin without originPluginId, and originPluginId without origin plugin", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = {
        type: "host",
        hostId: host.id,
        workspace: { type: "unmanaged", path: null },
      };

      const missingPluginId = await postCreateThread(harness, project.id, {
        origin: "plugin",
        environment,
      });
      expect(missingPluginId.status).toBe(400);

      const strayPluginId = await postCreateThread(harness, project.id, {
        origin: "sdk",
        originPluginId: "linear",
        environment,
      });
      expect(strayPluginId.status).toBe(400);
    });
  });
});
