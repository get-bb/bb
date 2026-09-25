import {
  getEnvironment,
  getThread,
  listEvents,
  environments,
  updateHost,
} from "@bb/db";
import { apiErrorSchema, threadResponseSchema } from "@bb/server-contract";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { sweepProviderEnvironment } from "../../src/services/environments/environment-engine.js";
import { advanceThreadProvisioning } from "../../src/services/threads/thread-provisioning.js";
import { clearAllThreadProvisionSchedules } from "../../src/services/threads/thread-startup-store.js";
import { setPluginEnvironmentProviderBridge } from "../../src/services/plugins/plugin-environment-provider-registry.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const PROVIDER_ID = "test-worktree";
const BRANCH_NAME = "bb/important-work";

interface CreateCall {
  rebuild: boolean;
  previousBranchName: string | null | undefined;
  suggestedBranchName: string;
}

function registerProvider(options: { pluginId?: string } = {}) {
  const createCalls: CreateCall[] = [];
  const record = {
    pluginId: options.pluginId ?? "test",
    provider: validatePluginEnvironmentProviderDeclaration({
      id: PROVIDER_ID,
      displayName: "Worktree",
      description: "Create an isolated Git worktree for your changes.",
      icon: "Folder",
      policy: { retireGraceMs: 0, pathKeys: "per-attempt" },
      create: async (context) => {
        createCalls.push({
          rebuild: context.rebuild,
          previousBranchName: context.previous?.environment.branchName,
          suggestedBranchName: context.suggestedBranchName,
        });
        return {
          status: "created",
          path: "/tmp/restored-worktree",
          ownsPath: true,
        };
      },
      remove: async () => ({ status: "removed" }),
    }),
  };
  setPluginEnvironmentProviderBridge({
    listEnvironmentProviders: () => [record],
    getEnvironmentProvider: (id) =>
      id === record.provider.id ? record : undefined,
    invokeProvider: async (_id, _label, run) => ({
      ok: true,
      value: await run(),
    }),
    decisionTimeoutMs: 10_000,
  });
  return { createCalls, record };
}

function seedDestroyableThread(
  harness: TestAppHarness,
  options: { branchName?: string | null; ranTurn?: boolean } = {},
) {
  const { host } = seedHostSession(harness.deps, { id: "host_restore" });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/project",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/worktree",
    environmentProviderId: PROVIDER_ID,
    environmentProviderPluginId: "test",
    providerOwnsPath: true,
    branchName:
      options.branchName === undefined ? BRANCH_NAME : options.branchName,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });
  if (options.ranTurn !== false) {
    seedThreadRuntimeState(harness.deps, {
      environmentId: environment.id,
      providerThreadId: "prov-1",
      threadId: thread.id,
    });
  }
  return { environment, host, project, thread };
}

async function archiveAndDestroy(
  harness: TestAppHarness,
  args: { environmentId: string; threadId: string },
): Promise<void> {
  const archived = await harness.app.request(
    `/api/v1/threads/${args.threadId}/archive-all`,
    { method: "POST" },
  );
  expect(archived.status).toBe(200);
  await sweepProviderEnvironment(harness.deps, args.environmentId);
  expect(
    harness.db
      .select()
      .from(environments)
      .where(eq(environments.id, args.environmentId))
      .get()?.status,
  ).toBe("destroyed");
}

async function restore(
  harness: TestAppHarness,
  threadId: string,
): Promise<Response> {
  return harness.app.request(`/api/v1/threads/${threadId}/restore-environment`, {
    method: "POST",
  });
}

async function unarchive(
  harness: TestAppHarness,
  threadId: string,
): Promise<Response> {
  return harness.app.request(`/api/v1/threads/${threadId}/unarchive`, {
    method: "POST",
  });
}

afterEach(() => {
  setPluginEnvironmentProviderBridge(undefined);
});

describe("POST /threads/:id/restore-environment (#1710)", () => {
  it("rebuilds the workspace on the branch the destroyed environment held", async () => {
    await withTestHarness(async (harness) => {
      const { createCalls } = registerProvider();
      const { environment, thread } = seedDestroyableThread(harness);
      await archiveAndDestroy(harness, {
        environmentId: environment.id,
        threadId: thread.id,
      });
      expect((await unarchive(harness, thread.id)).status).toBe(200);

      const countTurnRequests = () =>
        listEvents(harness.db, { threadId: thread.id }).filter(
          (event) => event.type === "client/turn/requested",
        ).length;
      const turnRequestsBefore = countTurnRequests();
      const response = await restore(harness, thread.id);
      expect(response.status, await response.clone().text()).toBe(200);
      const body = threadResponseSchema.parse(await readJson(response));
      expect(body.status).toBe("starting");

      await expect.poll(() => createCalls.length).toBe(1);
      expect(createCalls[0]).toMatchObject({
        rebuild: true,
        previousBranchName: BRANCH_NAME,
      });

      const restored = getThread(harness.db, thread.id);
      expect(restored?.environmentId).not.toBe(environment.id);
      expect(
        getEnvironment(harness.db, restored?.environmentId ?? ""),
      ).toMatchObject({
        environmentProviderId: PROVIDER_ID,
        hostId: environment.hostId,
        statusMessage: "Restoring Worktree…",
      });
      expect(countTurnRequests()).toBe(turnRequestsBefore);

      clearAllThreadProvisionSchedules();
      harness.db
        .update(environments)
        .set({ status: "ready" })
        .where(eq(environments.id, restored?.environmentId ?? ""))
        .run();
      await advanceThreadProvisioning(harness.deps, { threadId: thread.id });

      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      const provisioning = listEvents(harness.db, {
        threadId: thread.id,
      }).filter((event) => event.type === "system/thread-provisioning");
      expect(JSON.parse(provisioning.at(-1)?.data ?? "null")).toMatchObject({
        status: "completed",
      });
      expect(countTurnRequests()).toBe(turnRequestsBefore);
    });
  });

  it("restores a thread whose turn settings no longer resolve", async () => {
    await withTestHarness(async (harness) => {
      const { createCalls } = registerProvider();
      const { environment, thread } = seedDestroyableThread(harness, {
        ranTurn: false,
      });
      await archiveAndDestroy(harness, {
        environmentId: environment.id,
        threadId: thread.id,
      });
      await unarchive(harness, thread.id);

      const response = await restore(harness, thread.id);
      expect(response.status, await response.clone().text()).toBe(200);
      await expect.poll(() => createCalls.length).toBe(1);
    });
  });

  it("refuses a workspace whose branch is unknown, such as a detached HEAD", async () => {
    await withTestHarness(async (harness) => {
      const { createCalls } = registerProvider();
      const { environment, thread } = seedDestroyableThread(harness, {
        branchName: null,
      });
      await archiveAndDestroy(harness, {
        environmentId: environment.id,
        threadId: thread.id,
      });
      await unarchive(harness, thread.id);

      expect(
        threadResponseSchema.parse(
          await readJson(
            await harness.app.request(`/api/v1/threads/${thread.id}`),
          ),
        ).canRestoreEnvironment,
      ).toBe(false);
      const response = await restore(harness, thread.id);
      expect(response.status).toBe(409);
      expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
        code: "thread_environment_unavailable",
      });
      expect(createCalls).toHaveLength(0);
    });
  });

  it("reports the thread as restorable only once it is unarchived", async () => {
    await withTestHarness(async (harness) => {
      registerProvider();
      const { environment, thread } = seedDestroyableThread(harness);
      expect(
        threadResponseSchema.parse(
          await readJson(
            await harness.app.request(`/api/v1/threads/${thread.id}`),
          ),
        ).canRestoreEnvironment,
      ).toBe(false);

      await archiveAndDestroy(harness, {
        environmentId: environment.id,
        threadId: thread.id,
      });
      expect(
        threadResponseSchema.parse(
          await readJson(
            await harness.app.request(`/api/v1/threads/${thread.id}`),
          ),
        ).canRestoreEnvironment,
      ).toBe(false);

      await unarchive(harness, thread.id);
      expect(
        threadResponseSchema.parse(
          await readJson(
            await harness.app.request(`/api/v1/threads/${thread.id}`),
          ),
        ).canRestoreEnvironment,
      ).toBe(true);
    });
  });

  it("refuses an archived thread, which must be unarchived first", async () => {
    await withTestHarness(async (harness) => {
      const { createCalls } = registerProvider();
      const { environment, thread } = seedDestroyableThread(harness);
      await archiveAndDestroy(harness, {
        environmentId: environment.id,
        threadId: thread.id,
      });

      const response = await restore(harness, thread.id);
      expect(response.status).toBe(409);
      expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
        code: "thread_not_writable",
        details: { reason: "archived" },
      });
      expect(createCalls).toHaveLength(0);
    });
  });

  it("refuses a thread whose workspace is still there", async () => {
    await withTestHarness(async (harness) => {
      registerProvider();
      const { thread } = seedDestroyableThread(harness);

      const response = await restore(harness, thread.id);
      expect(response.status).toBe(409);
      expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("refuses when the environment provider that built the workspace is gone", async () => {
    await withTestHarness(async (harness) => {
      registerProvider();
      const { environment, thread } = seedDestroyableThread(harness);
      await archiveAndDestroy(harness, {
        environmentId: environment.id,
        threadId: thread.id,
      });
      await unarchive(harness, thread.id);
      setPluginEnvironmentProviderBridge(undefined);

      expect(
        threadResponseSchema.parse(
          await readJson(
            await harness.app.request(`/api/v1/threads/${thread.id}`),
          ),
        ).canRestoreEnvironment,
      ).toBe(false);
      const response = await restore(harness, thread.id);
      expect(response.status).toBe(409);
      expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
        code: "thread_environment_unavailable",
        details: { reason: "destroyed" },
      });
    });
  });

  it.each<[string, Parameters<typeof updateHost>[3]]>([
    ["being removed", { phase: "removing" }],
    ["removed", { phase: "destroyed" }],
    ["deleted", { destroyedAt: 1 }],
  ])(
    "refuses when the machine the workspace stood on is %s",
    async (_label, hostUpdate) => {
      await withTestHarness(async (harness) => {
        registerProvider();
        const { environment, thread } = seedDestroyableThread(harness);
        await archiveAndDestroy(harness, {
          environmentId: environment.id,
          threadId: thread.id,
        });
        await unarchive(harness, thread.id);
        updateHost(harness.db, harness.hub, environment.hostId, hostUpdate);

        expect(
          threadResponseSchema.parse(
            await readJson(
              await harness.app.request(`/api/v1/threads/${thread.id}`),
            ),
          ).canRestoreEnvironment,
        ).toBe(false);
        const response = await restore(harness, thread.id);
        expect(response.status).toBe(409);
        expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
          code: "thread_environment_unavailable",
        });
      });
    },
  );
});
