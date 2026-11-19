import {
  environmentHookOperations,
  environments,
  getEnvironment,
  getThread,
  type EnvironmentRow,
} from "@bb/db";
import type { JsonValue } from "@bb/domain";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  refreshProviderRetirement,
  resumeEnvironmentProvisioningForReconnectedDaemon,
  sweepProviderLifecycles,
} from "../../src/services/environments/environment-engine.js";
import { invokePluginInline } from "../../src/services/plugins/plugin-hook-registry.js";
import {
  setPluginEnvironmentProviderBridge,
  type PluginEnvironmentProviderRecord,
} from "../../src/services/plugins/plugin-environment-provider-registry.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { holdEnvironmentHooks } from "../helpers/held-environment-hooks.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const POOL_PLUGIN = "held-plugin";
const POOL_PROVIDER = "held-worktree";
const CHECKOUT = "/tmp/holds-project";

interface CreateCall {
  environment: { id: string; name: string | null; projectId: string } | null;
  thread: string | null;
  suggestedBranchName: string;
  pathKey: string;
}

function installProviders(
  args: { adopt?: () => EnvironmentRow | null } = {},
) {
  const calls: CreateCall[] = [];
  const pool: PluginEnvironmentProviderRecord = {
    pluginId: POOL_PLUGIN,
    provider: validatePluginEnvironmentProviderDeclaration({
      apiVersion: 2,
      id: POOL_PROVIDER,
      displayName: "Pool worktree",
      description: "Prepare a workspace.",
      icon: "Folder",
      requires: { projectCheckout: true },
      async create(context) {
        const call: CreateCall = {
          environment: context.environment,
          thread: null,
          suggestedBranchName: await context.branchName(),
          pathKey: context.pathKey,
        };
        calls.push(call);
        const held = args.adopt?.() ?? null;
        if (held !== null) {
          try {
            await context.adopt(held.id);
          } catch (error) {
            return {
              status: "failed",
              message: error instanceof Error ? error.message : String(error),
            };
          }
        }
        return {
          status: "created",
          path: held?.path ?? `/tmp/holds/${context.pathKey}`,
          ownsPath: true,
          mergeBaseBranch: "origin/main",
          resource: { branch: call.suggestedBranchName },
        };
      },
      async remove() {
        return { status: "removed" };
      },
    }),
  };
  const legacy: PluginEnvironmentProviderRecord = {
    pluginId: "legacy-plugin",
    provider: validatePluginEnvironmentProviderDeclaration({
      id: "legacy",
      displayName: "Legacy",
      description: "Prepare a workspace.",
      icon: "Folder",
      requires: { projectCheckout: true },
      async create(context) {
        calls.push({
          environment: null,
          thread: context.thread.id,
          suggestedBranchName: context.suggestedBranchName,
          pathKey: context.pathKey,
        });
        return {
          status: "created",
          path: `/tmp/holds/${context.pathKey}`,
          ownsPath: true,
        };
      },
      async remove() {
        return { status: "removed" };
      },
    }),
  };
  const records = [pool, legacy];
  setPluginEnvironmentProviderBridge({
    listEnvironmentProviders: () => records,
    getEnvironmentProvider: (id) =>
      records.find((record) => record.provider.id === id),
    invokeProvider: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
  return { calls };
}

function seed(harness: TestAppHarness) {
  const { host, session } = seedHostSession(harness.deps, { id: "host_holds" });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: CHECKOUT,
  });
  return { host, project, session };
}

async function createHeld(
  harness: TestAppHarness,
  body: Record<string, JsonValue>,
): Promise<Response> {
  return harness.app.request("/api/v1/environments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function finishSetup(
  harness: TestAppHarness,
  environmentId: string,
): Promise<EnvironmentRow> {
  const queued = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "environment.attach" &&
      command.environmentId === environmentId,
    5_000,
  );
  if (queued.command.type !== "environment.attach")
    throw new Error("Expected an attach command");
  expect(queued.command.initiator).toBeNull();
  await reportQueuedCommandSuccess(harness, queued, {
    path: queued.command.path,
    isGitRepo: true,
    isWorktree: true,
    branchName: `bb/${environmentId}`,
    defaultBranch: "main",
    transcript: [],
  });
  await expect
    .poll(() => getEnvironment(harness.db, environmentId)?.status)
    .toBe("ready");
  return getEnvironment(harness.db, environmentId)!;
}

function setupRows(harness: TestAppHarness) {
  return harness.db
    .select()
    .from(environmentHookOperations)
    .where(eq(environmentHookOperations.kind, "setup"))
    .all();
}

async function readyHeldEnvironment(
  harness: TestAppHarness,
  projectId: string,
  heldBy: string,
): Promise<EnvironmentRow> {
  const response = await createHeld(harness, {
    projectId,
    provider: { id: POOL_PROVIDER },
    heldBy,
  });
  expect(response.status).toBe(201);
  const created = (await response.json()) as { id: string; heldBy: string };
  expect(created.heldBy).toBe(heldBy);
  return finishSetup(harness, created.id);
}

describe("environments created before threads", () => {
  it("runs the provider and setup from the environment's own intent, without a thread", async () => {
    await withTestHarness(async (harness) => {
      const { calls } = installProviders();
      const { project } = seed(harness);
      const response = await createHeld(harness, {
        projectId: project.id,
        provider: { id: POOL_PROVIDER },
        name: "Review sandbox",
        heldBy: "user",
      });
      expect(response.status).toBe(201);
      const created = (await response.json()) as { id: string };
      const ready = await finishSetup(harness, created.id);
      expect(calls).toEqual([
        {
          environment: {
            id: created.id,
            name: "Review sandbox",
            projectId: project.id,
          },
          thread: null,
          suggestedBranchName: `bb/review-sandbox-${created.id}`,
          pathKey: created.id,
        },
      ]);
      expect(ready).toMatchObject({
        heldBy: "user",
        ownerThreadId: null,
        claimPath: null,
        path: `/tmp/holds/${created.id}`,
        resource: { branch: `bb/review-sandbox-${created.id}` },
      });
      expect(setupRows(harness)).toEqual([
        expect.objectContaining({
          id: `environment:${created.id}:${created.id}:setup`,
          finishedAt: expect.any(Number),
          error: null,
        }),
      ]);
    });
  });

  it("refuses a version-1 provider before a thread exists", async () => {
    await withTestHarness(async (harness) => {
      const { calls } = installProviders();
      const { project } = seed(harness);
      const response = await createHeld(harness, {
        projectId: project.id,
        provider: { id: "legacy" },
        heldBy: "user",
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        message: "Legacy can't create an environment before a thread exists",
      });
      expect(calls).toEqual([]);
      expect(harness.db.select().from(environments).all()).toEqual([]);
    });
  });

  it("keeps a held environment with no threads past the retirement grace", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { project } = seed(harness);
      const held = await readyHeldEnvironment(
        harness,
        project.id,
        "user",
      );
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        refreshProviderRetirement(harness.deps, held.id);
        vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
        await sweepProviderLifecycles(harness.deps);
        expect(getEnvironment(harness.db, held.id)).toMatchObject({
          status: "ready",
          retireAt: null,
          teardownStatus: null,
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("lets threads join a user-held environment, which stays held", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { project } = seed(harness);
      const userHeld = await readyHeldEnvironment(harness, project.id, "user");
      const thread = await createThreadFromRequest(harness.deps, {
        startedOnBehalfOf: null,
        environment: { type: "reuse", environmentId: userHeld.id },
        input: textInput("join"),
        origin: "cli",
        projectId: project.id,
        providerId: "codex",
      });
      expect(thread.environmentId).toBe(userHeld.id);
      expect(getEnvironment(harness.db, userHeld.id)?.heldBy).toBe("user");
    });
  });

  it("starts a thread that joined a user-held environment while its setup was running", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { project, host, session } = seed(harness);
      const hooks = holdEnvironmentHooks(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const response = await createHeld(harness, {
        projectId: project.id,
        provider: { id: POOL_PROVIDER },
        heldBy: "user",
      });
      const { id } = (await response.json()) as { id: string };
      await expect.poll(() => hooks.runs.length).toBe(1);
      const thread = await createThreadFromRequest(harness.deps, {
        startedOnBehalfOf: null,
        environment: { type: "reuse", environmentId: id },
        input: textInput("join while it sets up"),
        origin: "cli",
        projectId: project.id,
        providerId: "codex",
      });
      expect(getThread(harness.db, thread.id)?.status).toBe("starting");
      hooks.finish();
      const attach = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.attach" && command.environmentId === id,
        5_000,
      );
      if (attach.command.type !== "environment.attach")
        throw new Error("Expected an attach command");
      await reportQueuedCommandSuccess(harness, attach, {
        path: attach.command.path,
        isGitRepo: true,
        isWorktree: true,
        branchName: `bb/${id}`,
        defaultBranch: "main",
        transcript: [],
      });
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
        5_000,
      );
    });
  });
});

describe("plugin holds", () => {
  const providerThread = (
    harness: TestAppHarness,
    args: { hostId: string; projectId: string },
  ) =>
    createThreadFromRequest(harness.deps, {
      startedOnBehalfOf: null,
      environment: {
        type: "provider",
        environmentProviderId: POOL_PROVIDER,
        machine: { type: "existing", hostId: args.hostId },
        inputs: null,
      },
      input: textInput("take the held one"),
      origin: "cli",
      projectId: args.projectId,
      providerId: "codex",
      title: "Warm start",
    });

  it("refuses threads joining an environment a plugin holds", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      const { project } = seed(harness);
      const pooled = await readyHeldEnvironment(
        harness,
        project.id,
        `plugin:${POOL_PLUGIN}`,
      );
      const refusal = await createThreadFromRequest(harness.deps, {
        startedOnBehalfOf: null,
        environment: { type: "reuse", environmentId: pooled.id },
        input: textInput("join"),
        origin: "cli",
        projectId: project.id,
        providerId: "codex",
      }).catch((error: unknown) => error);
      expect(refusal).toMatchObject({
        status: 409,
        body: {
          code: "environment_held",
          message: `Environment ${pooled.id} is held by ${POOL_PLUGIN}`,
        },
      });
    });
  });

  it("hands a held environment to a thread when its plugin's provider adopts it", async () => {
    await withTestHarness(async (harness) => {
      let handOff: EnvironmentRow | null = null;
      installProviders({ adopt: () => handOff });
      const { host, project } = seed(harness);
      const pooled = await readyHeldEnvironment(
        harness,
        project.id,
        `plugin:${POOL_PLUGIN}`,
      );
      const setupBefore = setupRows(harness);
      handOff = pooled;
      const thread = await providerThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      await expect
        .poll(() => getThread(harness.db, thread.id)?.environmentId)
        .toBe(pooled.id);
      const branch = `bb/warm-start-${thread.id}`;
      expect(getEnvironment(harness.db, pooled.id)).toMatchObject({
        heldBy: null,
        status: "ready",
        createPending: false,
        resource: { branch },
        mergeBaseBranch: "origin/main",
      });
      expect(setupRows(harness)).toEqual(setupBefore);
    });
  });

  it("keeps another plugin's hold when a provider tries to adopt it", async () => {
    await withTestHarness(async (harness) => {
      let handOff: EnvironmentRow | null = null;
      installProviders({ adopt: () => handOff });
      const { host, project } = seed(harness);
      const foreign = await readyHeldEnvironment(
        harness,
        project.id,
        "plugin:other-plugin",
      );
      handOff = foreign;
      const thread = await providerThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      await expect
        .poll(() => getThread(harness.db, thread.id)?.status)
        .toBe("error");
      expect(getEnvironment(harness.db, foreign.id)).toMatchObject({
        heldBy: "plugin:other-plugin",
        ownerThreadId: null,
        status: "ready",
      });
    });
  });
});

describe("restarts and path admission", () => {
  it.each([
    ["user", "ready"],
    [null, "error"],
  ] as const)(
    "after a restart, resumes an interrupted thread-less setup held by %s on the same operation row (ends %s)",
    async (heldBy, outcome) => {
      await withTestHarness(async (harness) => {
        installProviders();
        const { host, project } = seed(harness);
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: "/tmp/holds/interrupted",
          status: "provisioning",
          environmentProviderId: POOL_PROVIDER,
          environmentProviderPluginId: POOL_PLUGIN,
          environmentProviderInstanceKey: "interrupted",
          providerOwnsPath: true,
        });
        harness.db
          .update(environments)
          .set({ heldBy })
          .where(eq(environments.id, environment.id))
          .run();
        const operation = `environment:${environment.id}:interrupted:setup`;
        harness.db
          .insert(environmentHookOperations)
          .values({
            id: operation,
            operationId: operation,
            hostId: host.id,
            path: "/tmp/holds/interrupted",
            kind: "setup",
            startedAt: 1,
          })
          .run();
        void resumeEnvironmentProvisioningForReconnectedDaemon(harness.deps, {
          hostId: host.id,
        });
        if (heldBy !== null) {
          const resumed = await waitForQueuedCommand(
            harness,
            ({ command }) =>
              command.type === "environment.attach" &&
              command.environmentId === environment.id,
            5_000,
          );
          if (resumed.command.type !== "environment.attach")
            throw new Error("Expected an attach command");
          expect(resumed.command.initiator).toBeNull();
          await reportQueuedCommandSuccess(harness, resumed, {
            path: resumed.command.path,
            isGitRepo: true,
            isWorktree: true,
            branchName: "bb/interrupted",
            defaultBranch: "main",
            transcript: [],
          });
        }
        await expect
          .poll(() => getEnvironment(harness.db, environment.id)?.status)
          .toBe(outcome);
        expect(setupRows(harness)).toEqual([
          expect.objectContaining({
            id: operation,
            operationId: operation,
            finishedAt: heldBy === null ? null : expect.any(Number),
          }),
        ]);
      });
    },
  );

});
