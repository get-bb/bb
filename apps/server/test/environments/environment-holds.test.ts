import {
  adoptHeldEnvironment,
  environmentHookOperations,
  environments,
  events,
  threads,
  threadTurnRequests,
  getEnvironment,
  getThread,
  type EnvironmentRow,
} from "@bb/db";
import type { JsonValue } from "@bb/domain";
import type {
  PluginEnvironmentProviderCreateContext,
  PluginEnvironmentProviderCreateResult,
  PluginEnvironmentProviderRestoreContext,
} from "@get-bb/plugin-sdk/environment-provider";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  advanceEnvironmentProvisioning,
  refreshProviderRetirement,
  resumeEnvironmentProvisioningForReconnectedDaemon,
  sweepProviderEnvironment,
  sweepProviderLifecycles,
} from "../../src/services/environments/environment-engine.js";
import { invokePluginInline } from "../../src/services/plugins/plugin-hook-registry.js";
import {
  setPluginEnvironmentProviderBridge,
  type PluginEnvironmentProviderRecord,
} from "../../src/services/plugins/plugin-environment-provider-registry.js";
import { runEnvironmentProvisioningSweep } from "../../src/services/system/periodic-sweeps.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { requestThreadStopForCurrentState } from "../../src/services/threads/thread-lifecycle.js";
import {
  listQueuedCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { holdEnvironmentHooks } from "../helpers/held-environment-hooks.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import {
  installTestBuiltinPlugin,
  withTestHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

const POOL_PLUGIN = "held-plugin";
const POOL_PROVIDER = "held-worktree";
const CHECKOUT = "/tmp/holds-project";

interface CreateCall {
  environment: { id: string; name: string | null; projectId: string } | null;
  thread: string | null;
  suggestedBranchName: string;
  pathKey: string;
}

function unreplacedFolders(...paths: string[]) {
  return paths.map((path) => ({ path, replaces: null }));
}

function installProviders(
  args: {
    adopt?: () => EnvironmentRow | null;
    afterAdopt?: () => Promise<void> | undefined;
    stepAfterAdopt?: string;
    setupAfterAdopt?: true | { folders: string[] };
    setupFolders?: { folders: string[]; returned: boolean };
    createdPath?: () => string | undefined;
    additionalPaths?: (operation: {
      kind: "create" | "restore";
      adopted: boolean;
      previous: string[] | null;
    }) => string[] | undefined;
  } = {},
) {
  const calls: CreateCall[] = [];
  const removed: Array<JsonValue | null> = [];
  const produce = async (
    context:
      | PluginEnvironmentProviderCreateContext
      | PluginEnvironmentProviderRestoreContext,
    kind: "create" | "restore",
  ): Promise<PluginEnvironmentProviderCreateResult> => {
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
        await context.adopt(held.id, {
          branch: call.suggestedBranchName,
        });
      } catch (error) {
        return {
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
    if (args.setupAfterAdopt !== undefined && held?.path != null) {
      try {
        await context.setup(
          held.path,
          args.setupAfterAdopt === true ? undefined : args.setupAfterAdopt,
        );
      } catch (error) {
        return {
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
    const ownPath = `/tmp/holds/${context.pathKey}`;
    if (held === null && args.setupFolders !== undefined)
      await context.setup(ownPath, { folders: args.setupFolders.folders });
    await args.afterAdopt?.();
    if (args.stepAfterAdopt !== undefined)
      context.report.step(args.stepAfterAdopt);
    const additionalPaths = args
      .additionalPaths?.({
        kind,
        adopted: held !== null,
        previous:
          "previous" in context
            ? context.previous.environment.additionalPaths.map(
                (entry) => entry.path,
              )
            : null,
      })
      ?.map((path) => ({ path }));
    const setupFolderPaths =
      held === null && args.setupFolders?.returned === true
        ? args.setupFolders.folders.map((path) => ({ path }))
        : undefined;
    return {
      status: "created",
      path:
        args.createdPath?.() ?? held?.path ?? `/tmp/holds/${context.pathKey}`,
      ownsPath: true,
      mergeBaseBranch: "origin/main",
      resource: { branch: call.suggestedBranchName },
      ...(additionalPaths === undefined ? {} : { additionalPaths }),
      ...(setupFolderPaths === undefined
        ? {}
        : { additionalPaths: setupFolderPaths }),
    };
  };
  const pool: PluginEnvironmentProviderRecord = {
    pluginId: POOL_PLUGIN,
    provider: validatePluginEnvironmentProviderDeclaration({
      apiVersion: 2,
      id: POOL_PROVIDER,
      displayName: "Pool worktree",
      description: "Prepare a workspace.",
      icon: "Folder",
      requires: { projectCheckout: true },
      create: (context) => produce(context, "create"),
      restore: (context) => produce(context, "restore"),
      async remove(context) {
        removed.push(context.resource);
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
  return { calls, removed };
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
  initiator: "none" | "thread" = "none",
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
  if (initiator === "none") expect(queued.command.initiator).toBeNull();
  else expect(queued.command.initiator).not.toBeNull();
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

function threadStarts(harness: TestAppHarness, threadId: string) {
  return listQueuedCommands(harness, "thread.start").filter(
    (command) =>
      command.type === "thread.start" && command.threadId === threadId,
  );
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
      const held = await readyHeldEnvironment(harness, project.id, "user");
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

  it("keeps the extra folders a held environment was created with when its provider adopts it", async () => {
    await withTestHarness(async (harness) => {
      let handOff: EnvironmentRow | null = null;
      installProviders({
        adopt: () => handOff,
        additionalPaths: ({ adopted }) =>
          adopted ? undefined : ["/tmp/warm-api", "/tmp/warm-docs"],
      });
      const { host, project } = seed(harness);
      const pooled = await readyHeldEnvironment(
        harness,
        project.id,
        `plugin:${POOL_PLUGIN}`,
      );
      expect(pooled.additionalPaths).toEqual(
        unreplacedFolders("/tmp/warm-api", "/tmp/warm-docs"),
      );
      handOff = pooled;
      const thread = await providerThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      await expect
        .poll(() => getEnvironment(harness.db, pooled.id)?.heldBy)
        .toBeNull();
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(pooled.id);
      const response = await harness.app.request(
        `/api/v1/environments/${pooled.id}`,
      );
      expect(await response.json()).toMatchObject({
        id: pooled.id,
        additionalPaths: unreplacedFolders("/tmp/warm-api", "/tmp/warm-docs"),
      });
    });
  });

  it("takes the extra folders create returns after adopt", async () => {
    await withTestHarness(async (harness) => {
      let handOff: EnvironmentRow | null = null;
      installProviders({
        adopt: () => handOff,
        additionalPaths: ({ adopted }) =>
          adopted ? ["/tmp/warm-api"] : ["/tmp/warm-api", "/tmp/warm-docs"],
      });
      const { host, project } = seed(harness);
      const pooled = await readyHeldEnvironment(
        harness,
        project.id,
        `plugin:${POOL_PLUGIN}`,
      );
      handOff = pooled;
      await providerThread(harness, { hostId: host.id, projectId: project.id });
      await expect
        .poll(() => getEnvironment(harness.db, pooled.id)?.heldBy)
        .toBeNull();
      expect(getEnvironment(harness.db, pooled.id)?.additionalPaths).toEqual(
        unreplacedFolders("/tmp/warm-api"),
      );
    });
  });

  const adoptedThread = async (
    harness: TestAppHarness,
    handOff: { current: EnvironmentRow | null },
  ) => {
    const { host, project } = seed(harness);
    const pooled = await readyHeldEnvironment(
      harness,
      project.id,
      `plugin:${POOL_PLUGIN}`,
    );
    handOff.current = pooled;
    const thread = await providerThread(harness, {
      hostId: host.id,
      projectId: project.id,
    });
    await waitForQueuedCommand(
      harness,
      (command) =>
        command.command.type === "thread.start" &&
        command.command.threadId === thread.id,
      5_000,
    );
    handOff.current = null;
    harness.db
      .update(threads)
      .set({ status: "idle" })
      .where(eq(threads.id, thread.id))
      .run();
    harness.db
      .delete(threadTurnRequests)
      .where(eq(threadTurnRequests.threadId, thread.id))
      .run();
    seedThreadRuntimeState(harness.deps, {
      environmentId: pooled.id,
      providerThreadId: "prov-adopted",
      threadId: thread.id,
    });
    for (const [method, path] of [
      ["POST", `/api/v1/threads/${thread.id}/archive-all`],
      ["DELETE", `/api/v1/environments/${pooled.id}`],
    ] as const)
      expect((await harness.app.request(path, { method })).status).toBe(200);
    await sweepProviderEnvironment(harness.deps, pooled.id);
    expect(getEnvironment(harness.db, pooled.id)?.status).toBe("destroyed");
    expect(
      (
        await harness.app.request(`/api/v1/threads/${thread.id}/unarchive`, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    return { pooled, project, thread };
  };

  const restoreThread = async (
    harness: TestAppHarness,
    args: { threadId: string; destroyedId: string },
  ) => {
    const response = await harness.app.request(
      `/api/v1/threads/${args.threadId}/restore-environment`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    await expect
      .poll(() => getThread(harness.db, args.threadId)?.environmentId)
      .not.toBe(args.destroyedId);
    const restoredId = getThread(harness.db, args.threadId)!.environmentId!;
    await expect
      .poll(() => getEnvironment(harness.db, restoredId)?.createPending)
      .toBe(false);
    return getEnvironment(harness.db, restoredId)!;
  };

  it("tells a restore which extra folders the adopted environment had", async () => {
    await withTestHarness(async (harness) => {
      const handOff = { current: null as EnvironmentRow | null };
      const previousPaths: Array<string[] | null> = [];
      installProviders({
        adopt: () => handOff.current,
        additionalPaths: ({ kind, adopted, previous }) => {
          if (kind === "restore") {
            previousPaths.push(previous);
            return previous ?? undefined;
          }
          return adopted ? undefined : ["/tmp/warm-api"];
        },
      });
      const { pooled, thread } = await adoptedThread(harness, handOff);

      const restored = await restoreThread(harness, {
        threadId: thread.id,
        destroyedId: pooled.id,
      });

      expect(previousPaths).toEqual([["/tmp/warm-api"]]);
      expect(restored.additionalPaths).toEqual(
        unreplacedFolders("/tmp/warm-api"),
      );
    });
  });

  it("keeps the extra folders of a held environment a restore adopts", async () => {
    await withTestHarness(async (harness) => {
      const handOff = { current: null as EnvironmentRow | null };
      installProviders({
        adopt: () => handOff.current,
        additionalPaths: ({ adopted }) =>
          adopted ? undefined : ["/tmp/warm-api"],
      });
      const { pooled, project, thread } = await adoptedThread(harness, handOff);
      const warm = await readyHeldEnvironment(
        harness,
        project.id,
        `plugin:${POOL_PLUGIN}`,
      );
      handOff.current = warm;

      const restored = await restoreThread(harness, {
        threadId: thread.id,
        destroyedId: pooled.id,
      });

      expect(restored).toMatchObject({
        id: warm.id,
        heldBy: null,
        additionalPaths: unreplacedFolders("/tmp/warm-api"),
      });
    });
  });

  it("runs setup again, before the thread starts, when the provider calls setup after adopt", async () => {
    await withTestHarness(async (harness) => {
      let handOff: EnvironmentRow | null = null;
      installProviders({ adopt: () => handOff, setupAfterAdopt: true });
      const { host, project } = seed(harness);
      const pooled = await readyHeldEnvironment(
        harness,
        project.id,
        `plugin:${POOL_PLUGIN}`,
      );
      const [setupBefore] = setupRows(harness);
      handOff = pooled;
      const thread = await providerThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      await expect
        .poll(() => getEnvironment(harness.db, pooled.id)?.status)
        .toBe("provisioning");
      expect(threadStarts(harness, thread.id)).toEqual([]);
      await finishSetup(harness, pooled.id, "thread");
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
        5_000,
      );
      const setupAfter = setupRows(harness);
      expect(setupAfter).toHaveLength(1);
      expect(setupAfter[0]?.id).toBe(setupBefore?.id);
      expect(setupAfter[0]?.startedAt).toBeGreaterThan(
        setupBefore?.finishedAt ?? Number.POSITIVE_INFINITY,
      );
      expect(getEnvironment(harness.db, pooled.id)).toMatchObject({
        heldBy: null,
        status: "ready",
        createPending: false,
        resource: { branch: `bb/warm-start-${thread.id}` },
      });
    });
  });

  it("runs each folder's setup once, in order, before the environment's, and their teardowns after it in reverse", async () => {
    await withTestHarness(async (harness) => {
      installProviders({
        setupFolders: { folders: ["/tmp/api", "/tmp/docs"], returned: true },
      });
      const { host, project, session } = seed(harness);
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
      for (let run = 1; run <= 3; run += 1) {
        await expect.poll(() => hooks.runs.length).toBe(run);
        hooks.finish();
      }
      const ready = await finishSetup(harness, id);
      expect(hooks.runs.map((command) => [command.kind, command.path])).toEqual(
        [
          ["setup", "/tmp/api"],
          ["setup", "/tmp/docs"],
          ["setup", ready.path],
        ],
      );

      expect(
        (
          await harness.app.request(`/api/v1/environments/${id}`, {
            method: "DELETE",
          })
        ).status,
      ).toBe(200);
      const swept = sweepProviderEnvironment(harness.deps, id);
      for (let run = 4; run <= 6; run += 1) {
        await expect.poll(() => hooks.runs.length).toBe(run);
        hooks.finish();
      }
      await swept;
      expect(
        hooks.runs.slice(3).map((command) => [command.kind, command.path]),
      ).toEqual([
        ["teardown", ready.path],
        ["teardown", "/tmp/docs"],
        ["teardown", "/tmp/api"],
      ]);
    });
  });

  it("runs only the environment's own setup again when the provider calls setup after adopt", async () => {
    await withTestHarness(async (harness) => {
      let handOff: EnvironmentRow | null = null;
      installProviders({
        adopt: () => handOff,
        setupAfterAdopt: true,
        setupFolders: { folders: ["/tmp/api"], returned: true },
      });
      const { host, project } = seed(harness);
      const pooled = await readyHeldEnvironment(
        harness,
        project.id,
        `plugin:${POOL_PLUGIN}`,
      );
      const before = setupRows(harness);
      expect(before.map((row) => row.path).sort()).toEqual(
        ["/tmp/api", pooled.path].sort(),
      );
      handOff = pooled;
      const thread = await providerThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      await finishSetup(harness, pooled.id, "thread");
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
        5_000,
      );
      const after = new Map(
        setupRows(harness).map((row) => [row.path, row.startedAt]),
      );
      const startedBefore = new Map(
        before.map((row) => [row.path, row.startedAt]),
      );
      expect(after.get("/tmp/api")).toBe(startedBefore.get("/tmp/api"));
      expect(after.get(pooled.path!)).toBeGreaterThan(
        startedBefore.get(pooled.path!) ?? Number.POSITIVE_INFINITY,
      );
      expect(getEnvironment(harness.db, pooled.id)).toMatchObject({
        status: "ready",
        additionalPaths: unreplacedFolders("/tmp/api"),
      });
    });
  });

  it("runs a folder's setup again, then the environment's, when the provider names it after adopt", async () => {
    await withTestHarness(async (harness) => {
      let handOff: EnvironmentRow | null = null;
      installProviders({
        adopt: () => handOff,
        setupAfterAdopt: { folders: ["/tmp/docs"] },
        setupFolders: { folders: ["/tmp/api", "/tmp/docs"], returned: true },
      });
      const { host, project } = seed(harness);
      const pooled = await readyHeldEnvironment(
        harness,
        project.id,
        `plugin:${POOL_PLUGIN}`,
      );
      const startedBefore = new Map(
        setupRows(harness).map((row) => [row.path, row.startedAt]),
      );
      handOff = pooled;
      const thread = await providerThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      await finishSetup(harness, pooled.id, "thread");
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
        5_000,
      );
      const after = new Map(
        setupRows(harness).map((row) => [row.path, row.startedAt]),
      );
      expect(after.get("/tmp/api")).toBe(startedBefore.get("/tmp/api"));
      expect(after.get("/tmp/docs")).toBeGreaterThan(
        startedBefore.get("/tmp/docs") ?? Number.POSITIVE_INFINITY,
      );
      expect(after.get(pooled.path!)).toBeGreaterThanOrEqual(
        after.get("/tmp/docs")!,
      );
    });
  });

  it("refuses a setup after adopt in a folder the adopted environment did not set up", async () => {
    await withTestHarness(async (harness) => {
      let handOff: EnvironmentRow | null = null;
      installProviders({
        adopt: () => handOff,
        setupAfterAdopt: { folders: ["/tmp/other"] },
        setupFolders: { folders: ["/tmp/api"], returned: true },
      });
      const { host, project } = seed(harness);
      const pooled = await readyHeldEnvironment(
        harness,
        project.id,
        `plugin:${POOL_PLUGIN}`,
      );
      const before = setupRows(harness);
      handOff = pooled;
      await providerThread(harness, { hostId: host.id, projectId: project.id });
      await expect
        .poll(() => getEnvironment(harness.db, pooled.id)?.statusMessage ?? "")
        .toContain("the adopted environment did not set it up");
      expect(setupRows(harness)).toEqual(before);
    });
  });

  it("fails a create that sets up a folder it does not return", async () => {
    await withTestHarness(async (harness) => {
      installProviders({
        setupFolders: { folders: ["/tmp/api"], returned: false },
      });
      const { project } = seed(harness);
      const response = await createHeld(harness, {
        projectId: project.id,
        provider: { id: POOL_PROVIDER },
        heldBy: "user",
      });
      const { id } = (await response.json()) as { id: string };
      await expect
        .poll(() => getEnvironment(harness.db, id)?.statusMessage ?? "")
        .toContain("set up /tmp/api but did not return it in additionalPaths");
    });
  });

  it("shows a step the provider reports after adopt on the thread and the environment", async () => {
    await withTestHarness(async (harness) => {
      let handOff: EnvironmentRow | null = null;
      const step = "Using a warm worktree at origin/main (abc1234)";
      installProviders({ adopt: () => handOff, stepAfterAdopt: step });
      const { host, project } = seed(harness);
      handOff = await readyHeldEnvironment(
        harness,
        project.id,
        `plugin:${POOL_PLUGIN}`,
      );
      harness.db
        .update(environments)
        .set({ pendingLog: "output from before the thread existed" })
        .where(eq(environments.id, handOff.id))
        .run();
      const thread = await providerThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      await expect
        .poll(() => getThread(harness.db, thread.id)?.environmentId)
        .toBe(handOff.id);
      expect(getEnvironment(harness.db, handOff.id)?.statusMessage).toBe(step);
      const provisioningSteps = harness.db
        .select({ data: events.data })
        .from(events)
        .where(
          and(
            eq(events.threadId, thread.id),
            eq(events.type, "system/thread-provisioning"),
          ),
        )
        .all()
        .flatMap(
          (row) =>
            (JSON.parse(row.data) as { entries?: { text?: string }[] })
              .entries ?? [],
        )
        .map((entry) => entry.text);
      expect(provisioningSteps).toContain(step);
      expect(provisioningSteps).not.toContain(
        "output from before the thread existed",
      );
    });
  });

  it("releases a plugin's holds when the plugin is disabled, so its environments retire", async () => {
    await withTestHarness(async (harness) => {
      installProviders();
      await installTestBuiltinPlugin(harness, "keep-awake");
      const { project } = seed(harness);
      const held = await readyHeldEnvironment(
        harness,
        project.id,
        "plugin:keep-awake",
      );
      const kept = await readyHeldEnvironment(
        harness,
        project.id,
        `plugin:${POOL_PLUGIN}`,
      );
      await harness.pluginService.setEnabled("keep-awake", false);
      expect(getEnvironment(harness.db, held.id)).toMatchObject({
        heldBy: null,
        retireAt: expect.any(Number),
      });
      expect(getEnvironment(harness.db, kept.id)).toMatchObject({
        heldBy: `plugin:${POOL_PLUGIN}`,
        retireAt: null,
      });
    });
  });

  it("fails the thread, without starting it, when create does not return the path it adopted", async () => {
    await withTestHarness(async (harness) => {
      let handOff: EnvironmentRow | null = null;
      let release: () => void = () => {};
      let paused: Promise<void> | undefined;
      const { removed } = installProviders({
        adopt: () => handOff,
        afterAdopt: () => paused,
        createdPath: () =>
          paused === undefined ? undefined : "/tmp/holds/elsewhere",
      });
      const { host, project } = seed(harness);
      const pooled = await readyHeldEnvironment(
        harness,
        project.id,
        `plugin:${POOL_PLUGIN}`,
      );
      handOff = pooled;
      paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      const thread = await providerThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      await expect
        .poll(() => getEnvironment(harness.db, pooled.id)?.ownerThreadId)
        .toBe(thread.id);
      await advanceEnvironmentProvisioning(harness.deps, {
        environmentId: pooled.id,
      });
      expect(threadStarts(harness, thread.id)).toEqual([]);
      release();
      await expect
        .poll(() => getThread(harness.db, thread.id)?.status)
        .toBe("error");
      expect(getEnvironment(harness.db, pooled.id)).toMatchObject({
        createPending: false,
        heldBy: null,
        statusMessage: expect.stringContaining(
          `adopted ${pooled.id} but created /tmp/holds/elsewhere`,
        ),
      });
      await expect
        .poll(() => removed)
        .toEqual([{ branch: `bb/warm-start-${thread.id}` }]);
      expect(threadStarts(harness, thread.id)).toEqual([]);
    });
  });

  it("discards a handed-over environment and gives the thread a new one after a restart before create returned", async () => {
    await withTestHarness(async (harness) => {
      let paused: Promise<void> | undefined;
      const { removed } = installProviders({ afterAdopt: () => paused });
      const { host, project } = seed(harness);
      const pooled = await readyHeldEnvironment(
        harness,
        project.id,
        `plugin:${POOL_PLUGIN}`,
      );
      paused = new Promise<void>(() => {});
      const thread = await providerThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      await expect
        .poll(() =>
          harness.db
            .select()
            .from(environments)
            .where(eq(environments.ownerThreadId, thread.id))
            .get(),
        )
        .toBeDefined();
      const reservation = harness.db
        .select()
        .from(environments)
        .where(eq(environments.ownerThreadId, thread.id))
        .get()!;
      const placeholder = { branch: `bb/${pooled.id}` };
      adoptHeldEnvironment(
        harness.db,
        reservation,
        pooled.id,
        `plugin:${POOL_PLUGIN}`,
        placeholder,
      );
      expect(getEnvironment(harness.db, pooled.id)).toMatchObject({
        heldBy: `plugin:${POOL_PLUGIN}`,
        ownerThreadId: thread.id,
        createPending: true,
      });
      paused = undefined;
      await runEnvironmentProvisioningSweep(harness.deps);
      await expect.poll(() => removed).toEqual([placeholder]);
      expect(getEnvironment(harness.db, pooled.id)).toMatchObject({
        heldBy: null,
        ownerThreadId: null,
        teardownStatus: "removed",
      });
      await expect
        .poll(() => getThread(harness.db, thread.id)?.environmentId)
        .not.toBeNull();
      const replacement = getThread(harness.db, thread.id)!.environmentId!;
      expect(replacement).not.toBe(pooled.id);
      await finishSetup(harness, replacement, "thread");
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
        5_000,
      );
    });
  });

  it("keeps the plugin's hold until create returns, so other threads cannot join a handover", async () => {
    await withTestHarness(async (harness) => {
      let handOff: EnvironmentRow | null = null;
      let release: () => void = () => {};
      let paused: Promise<void> | undefined;
      installProviders({ adopt: () => handOff, afterAdopt: () => paused });
      const { host, project } = seed(harness);
      const pooled = await readyHeldEnvironment(
        harness,
        project.id,
        `plugin:${POOL_PLUGIN}`,
      );
      handOff = pooled;
      paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      const thread = await providerThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      await expect
        .poll(() => getEnvironment(harness.db, pooled.id)?.ownerThreadId)
        .toBe(thread.id);
      expect(getEnvironment(harness.db, pooled.id)?.heldBy).toBe(
        `plugin:${POOL_PLUGIN}`,
      );
      const refusal = await createThreadFromRequest(harness.deps, {
        startedOnBehalfOf: null,
        environment: { type: "reuse", environmentId: pooled.id },
        input: textInput("join the handover"),
        origin: "cli",
        projectId: project.id,
        providerId: "codex",
      }).catch((error: unknown) => error);
      expect(refusal).toMatchObject({ status: 409 });
      release();
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
        5_000,
      );
      expect(getEnvironment(harness.db, pooled.id)?.heldBy).toBeNull();
    });
  });

  it("discards a handed-over environment when its thread is stopped before create returns", async () => {
    await withTestHarness(async (harness) => {
      let handOff: EnvironmentRow | null = null;
      let paused: Promise<void> | undefined;
      let release: () => void = () => {};
      const { removed } = installProviders({
        adopt: () => handOff,
        setupAfterAdopt: true,
        afterAdopt: () => paused,
      });
      const { host, project } = seed(harness);
      const pooled = await readyHeldEnvironment(
        harness,
        project.id,
        `plugin:${POOL_PLUGIN}`,
      );
      handOff = pooled;
      paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      const thread = await providerThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      await expect
        .poll(() => getThread(harness.db, thread.id)?.environmentId)
        .toBe(pooled.id);
      requestThreadStopForCurrentState(
        harness.deps,
        getThread(harness.db, thread.id)!,
      );
      release();
      await expect
        .poll(() => getEnvironment(harness.db, pooled.id)?.teardownStatus)
        .toBe("removed");
      expect(getEnvironment(harness.db, pooled.id)?.heldBy).toBeNull();
      expect(removed).toEqual([{ branch: `bb/warm-start-${thread.id}` }]);
      expect(threadStarts(harness, thread.id)).toEqual([]);
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
